// Posta motoru Camel'dir ve yalnızca *_async çağrılarıyla, ana iş parçacığından
// kullanılır. Camel bu çağrıları kendi iş parçacığı havuzunda yürütür ve
// CamelSession sanal yöntemlerini (get_password, authenticate_sync,
// trust_prompt, get_oauth2_access_token_sync) oradan çağırır. GJS 1.82 bir JS
// sanal yöntemi başka iş parçacığından çağrılınca çöküyor (gdb: havuz
// iş parçacığında JS::RuntimeHeapState içinde SIGSEGV). Bu yüzden oturum hiçbir
// sanal yöntemi geçersiz kılmaz:
//   - Sertifika kararı Camel'in kendi sertifika veritabanından okunur. Kullanıcı
//     onaylayınca kaydın güven düzeyi FULLY yapılır; Camel sonraki bağlantılarda
//     soru sormadan kabul eder.
//   - Varsayılan authenticate_sync reddedilen parolayla sonsuza dek yeniden
//     dener. Parola Camel'e verilmeden önce wire.js ile tek denemede doğrulanır;
//     her işlem ayrıca zaman aşımıyla iptal edilir, döngü bununla sınırlanır.
//   - OAuth2 (Gmail/Outlook GOA hesapları) Camel'de yalnızca o sanal yöntemle
//     çalışır; v0.1 bu hesapları gösterir ama açmaz.
import Camel from 'gi://Camel';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {parseAddressList, sanitizeFilename} from './mail-format.js';
import {AuthError, CertificateError, camelFingerprint, listMailboxes, searchText, verifyLogin} from './wire.js';

for (const [klass, method] of [
    [Camel.Service, 'connect'], [Camel.Service, 'disconnect'], [Camel.OfflineStore, 'set_online'],
    [Camel.Store, 'get_folder_info'], [Camel.Store, 'get_folder'], [Camel.Folder, 'refresh_info'],
    [Camel.Folder, 'get_message'], [Camel.Folder, 'transfer_messages_to'], [Camel.Folder, 'append_message'],
    [Camel.Folder, 'synchronize'], [Camel.Transport, 'send_to'],
])
    Gio._promisify(klass.prototype, method);
Gio._promisify(Gio.File.prototype, 'load_contents_async');

const LOGIN_TIMEOUT_MS = 30_000;
const OPERATION_TIMEOUT_MS = 60_000;
// İlk açılışta binlerce iletinin başlıkları iner; bu, tek bir isteğin değil
// bütün klasörün süresidir.
const REFRESH_TIMEOUT_MS = 300_000;
const SUMMARY_BATCH = 500;
const ROLE_ORDER = ['inbox', 'drafts', 'sent', 'archive', 'junk', 'trash'];
const FALLBACK_ROLE_NAMES = {
    trash: ['trash', 'çöp', 'deleted items', 'deleted messages', 'silinmiş öğeler'],
    sent: ['sent', 'sent items', 'sent messages', 'gönderilmiş', 'gönderilenler', 'gönderilmiş öğeler'],
    drafts: ['drafts', 'taslaklar'],
};

export class UserError extends Error {}
export class TimeoutError extends Error {}

const PostaSession = GObject.registerClass({GTypeName: 'VatanPostaSession'},
class PostaSession extends Camel.Session {});

const NETWORK_IO_ERRORS = [
    Gio.IOErrorEnum.CONNECTION_REFUSED, Gio.IOErrorEnum.HOST_UNREACHABLE, Gio.IOErrorEnum.NETWORK_UNREACHABLE,
    Gio.IOErrorEnum.TIMED_OUT, Gio.IOErrorEnum.CONNECTION_CLOSED, Gio.IOErrorEnum.NOT_CONNECTED,
    Gio.IOErrorEnum.BROKEN_PIPE,
];

function isNetworkError(e) {
    if (!(e instanceof GLib.Error))
        return false;
    return e.domain === Gio.resolver_error_quark() || NETWORK_IO_ERRORS.some(code => e.matches(Gio.IOErrorEnum, code));
}

export function isOfflineError(e) {
    return e instanceof TimeoutError || isNetworkError(e);
}

export function userMessage(e) {
    if (e instanceof UserError)
        return e.message;
    if (e instanceof AuthError)
        return 'Kullanıcı adı ya da parola yanlış';
    if (e instanceof CertificateError)
        return 'Sunucunun sertifikası doğrulanamadı';
    if (e instanceof TimeoutError)
        return 'Sunucu zamanında yanıt vermedi';
    if (isNetworkError(e))
        return 'Sunucuya ulaşılamıyor. İnternet bağlantını ve sunucu adını denetle.';
    if (e instanceof GLib.Error && e.domain === Gio.tls_error_quark())
        return 'Sunucuyla güvenli bağlantı kurulamadı';
    return 'Beklenmeyen bir hata oluştu; ayrıntılar günlükte';
}

export async function withTimeout(ms, operation) {
    const cancellable = new Gio.Cancellable();
    let timedOut = false;
    const source = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        timedOut = true;
        cancellable.cancel();
        return GLib.SOURCE_REMOVE;
    });
    try {
        return await operation(cancellable);
    } catch (e) {
        if (timedOut)
            throw new TimeoutError(`timed out after ${ms} ms: ${e.message}`);
        throw e;
    } finally {
        if (!timedOut)
            GLib.source_remove(source);
    }
}

function idle() {
    return new Promise(resolve => GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
        resolve();
        return GLib.SOURCE_REMOVE;
    }));
}

const SECURITY_METHODS = {
    ssl: Camel.NetworkSecurityMethod.SSL_ON_ALTERNATE_PORT,
    starttls: Camel.NetworkSecurityMethod.STARTTLS_ON_STANDARD_PORT,
};

function configureService(service, server, extra = {}) {
    const settings = service.ref_settings();
    const security = SECURITY_METHODS[server.security];
    if (security === undefined)
        throw new UserError('Yalnızca SSL/TLS ya da STARTTLS ile bağlanılabilir');
    const values = {
        host: server.host, port: server.port, user: server.user,
        'auth-mechanism': 'PLAIN', 'security-method': security, ...extra,
    };
    for (const [key, value] of Object.entries(values))
        settings.set_property(key, value);
}

const SPECIAL_USE_ROLES = {
    '\\trash': 'trash', '\\sent': 'sent', '\\drafts': 'drafts', '\\junk': 'junk', '\\archive': 'archive',
};

function roleOf(mailbox) {
    if (mailbox.fullName.toUpperCase() === 'INBOX')
        return 'inbox';
    const special = mailbox.attributes.map(a => SPECIAL_USE_ROLES[a]).find(Boolean);
    if (special)
        return special;
    const name = mailbox.displayName.toLocaleLowerCase('tr');
    return Object.entries(FALLBACK_ROLE_NAMES).find(([, names]) => names.includes(name))?.[0] ?? null;
}

function selectable(mailbox) {
    return !mailbox.attributes.includes('\\noselect') && !mailbox.attributes.includes('\\nonexistent');
}

function compareFolders(a, b) {
    const rank = f => (f.role ? ROLE_ORDER.indexOf(f.role) : ROLE_ORDER.length);
    return rank(a) - rank(b) ||
        a.fullName.localeCompare(b.fullName, 'tr') ||
        (a.fullName < b.fullName ? -1 : a.fullName > b.fullName ? 1 : 0);
}

function readAddresses(address) {
    const list = [];
    for (let i = 0; address && i < address.length(); i++) {
        const [ok, name, email] = address.get(i);
        if (ok)
            list.push({name: name ?? '', email: email ?? ''});
    }
    return list;
}

function decodePart(part) {
    const out = Gio.MemoryOutputStream.new_resizable();
    part.get_content().decode_to_output_stream_sync(out, null);
    out.close(null);
    return out.steal_as_bytes();
}

function decodeText(part) {
    const bytes = decodePart(part).toArray();
    const charset = part.get_content_type().param('charset') || 'utf-8';
    try {
        return new TextDecoder(charset).decode(bytes);
    } catch (e) {
        console.warn(`posta: charset ${charset} not supported, decoding as UTF-8: ${e.message}`);
        return new TextDecoder('utf-8').decode(bytes);
    }
}

function collectParts(part, parsed) {
    const content = part.get_content();
    if (content instanceof Camel.Multipart) {
        for (let i = 0; i < content.get_number(); i++)
            collectParts(content.get_part(i), parsed);
        return;
    }
    const type = part.get_content_type();
    const filename = part.get_filename();
    const isAttachment = part.get_disposition() === 'attachment' || !!filename ||
        !(type.is('text', 'plain') || type.is('text', 'html'));
    if (!isAttachment && type.is('text', 'plain') && parsed.text === null) {
        parsed.text = decodeText(part);
        return;
    }
    if (!isAttachment && type.is('text', 'html') && parsed.html === null) {
        parsed.html = decodeText(part);
        return;
    }
    if (!isAttachment)
        return;
    const fallback = content instanceof Camel.MimeMessage ? `${content.get_subject() || 'ileti'}.eml` : null;
    parsed.attachments.push({
        name: sanitizeFilename(filename || fallback),
        mimeType: `${type.type}/${type.subtype}`.toLowerCase(),
        part,
        size: decodePart(part).get_size(),
    });
}

export function parseMessage(message) {
    const [date] = message.get_date();
    const parsed = {
        subject: message.get_subject() ?? '',
        from: readAddresses(message.get_from()),
        replyTo: readAddresses(message.get_reply_to()),
        to: readAddresses(message.get_recipients(Camel.RECIPIENT_TYPE_TO)),
        cc: readAddresses(message.get_recipients(Camel.RECIPIENT_TYPE_CC)),
        date: date > 0 ? date : 0,
        messageId: message.get_message_id(),
        references: message.get_header('References'),
        text: null,
        html: null,
        attachments: [],
        message,
    };
    collectParts(message, parsed);
    return parsed;
}

function messageFingerprint(info) {
    return info ? `${info.get_date_sent()}\n${info.get_from()}\n${info.get_subject()}` : null;
}

function serviceUid(account) {
    return account.id.replace(/[^A-Za-z0-9_-]/g, '_');
}

function utcOffsetHHMM() {
    const minutes = Math.round(GLib.DateTime.new_now_local().get_utc_offset() / 60_000_000);
    const sign = minutes < 0 ? -1 : 1;
    const abs = Math.abs(minutes);
    return sign * (Math.floor(abs / 60) * 100 + abs % 60);
}

function internetAddress(list) {
    const address = new Camel.InternetAddress();
    for (const {name, email} of list)
        address.add(name, email);
    return address;
}

function attachmentPart({name, mimeType, bytes}) {
    const part = new Camel.MimePart();
    part.set_content(bytes, mimeType);
    part.set_filename(sanitizeFilename(name));
    part.set_disposition('attachment');
    part.set_encoding(Camel.TransferEncoding.ENCODING_BASE64);
    return part;
}

export async function readAttachmentFile(file) {
    const [bytes] = await file.load_contents_async(null);
    const name = file.get_basename();
    const [contentType] = Gio.content_type_guess(name, bytes);
    return {name, mimeType: Gio.content_type_get_mime_type(contentType) ?? 'application/octet-stream', bytes};
}

export function buildMessage({from, to, cc, bcc, subject, body, attachments, inReplyTo, references}) {
    const message = new Camel.MimeMessage();
    message.set_subject(subject);
    message.set_from(internetAddress([from]));
    message.set_recipients(Camel.RECIPIENT_TYPE_TO, internetAddress(to));
    message.set_recipients(Camel.RECIPIENT_TYPE_CC, internetAddress(cc));
    message.set_recipients(Camel.RECIPIENT_TYPE_BCC, internetAddress(bcc));
    message.set_date(Camel.MESSAGE_DATE_CURRENT, utcOffsetHHMM());
    message.set_message_id(null);
    if (inReplyTo) {
        message.set_header('In-Reply-To', `<${inReplyTo}>`);
        message.set_header('References', `${references ? `${references} ` : ''}<${inReplyTo}>`);
    }

    const text = new TextEncoder().encode(body);
    if (attachments.length === 0) {
        message.set_content(text, 'text/plain; charset=utf-8');
        message.set_encoding(Camel.TransferEncoding.ENCODING_QUOTEDPRINTABLE);
        return message;
    }
    const multipart = new Camel.Multipart();
    multipart.set_mime_type('multipart/mixed');
    multipart.set_boundary(null);
    const textPart = new Camel.MimePart();
    textPart.set_content(text, 'text/plain; charset=utf-8');
    textPart.set_encoding(Camel.TransferEncoding.ENCODING_QUOTEDPRINTABLE);
    multipart.add_part(textPart);
    for (const attachment of attachments)
        multipart.add_part(attachment.part ?? attachmentPart(attachment));
    // MimePart.set_content (ham bayt) Medium.set_content'i gölgeliyor; çok parçalı
    // gövde Medium'unkiyle verilir.
    Camel.Medium.prototype.set_content.call(message, multipart);
    return message;
}

export function writeAttachment(part, file) {
    const bytes = decodePart(part);
    return new Promise((resolve, reject) => {
        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null,
            (source, result) => {
                try {
                    source.replace_contents_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
    });
}

export class MailEngine {
    // pinsFor: hesap → kullanıcının güvendiği sertifika parmak izleri. Her
    // bağlantıda yeniden sorulur; güven kararı oturum ortasında değişebilir.
    constructor(pinsFor) {
        this._pinsFor = pinsFor;
        const dataDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'vatan-posta']);
        const cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'vatan-posta']);
        for (const dir of [dataDir, cacheDir])
            GLib.mkdir_with_parents(dir, 0o700);
        Camel.init(dataDir, false);
        Camel.Provider.init();
        this._session = new PostaSession({user_data_dir: dataDir, user_cache_dir: cacheDir, online: true});
        this._dataDir = dataDir;
        this._entries = new Map();
    }

    _entry(account) {
        let entry = this._entries.get(account.id);
        if (entry)
            return entry;
        const uid = serviceUid(account);
        const store = this._session.add_service(uid, 'imapx', Camel.ProviderType.STORE);
        // IDLE ve çoklu bağlantı Camel'in arka plan işlerini çoğaltır; v0.1
        // yenilemeyi kendi zamanlayıcısıyla yapar. Süzgeçler kapalı: Camel süzgeç
        // sürücüsünü oturumun sanal yönteminden ister ve bizde o yok.
        // Abonelik listesi değil sunucudaki bütün klasörler gösterilir; çoğu
        // kullanıcı abone olmadığı klasörlerini de görmeyi bekler.
        configureService(store, account.imap, {
            'use-idle': false, 'concurrent-connections': 1, 'use-subscriptions': false,
            'filter-inbox': false, 'filter-all': false, 'filter-junk': false, 'filter-junk-inbox': false,
        });
        const transport = this._session.add_service(`${uid}-smtp`, 'smtp', Camel.ProviderType.TRANSPORT);
        configureService(transport, account.smtp);
        entry = {account, store, transport, online: false, folders: [], credentials: null};
        this._entries.set(account.id, entry);
        return entry;
    }

    isOnline(account) {
        return this._entry(account).online;
    }

    async open(account, credentials) {
        const entry = this._entry(account);
        entry.credentials = credentials;
        entry.store.set_password(credentials.imap);
        entry.transport.set_password(credentials.smtp);
        try {
            await withTimeout(LOGIN_TIMEOUT_MS, c =>
                verifyLogin({protocol: 'imap', ...account.imap}, credentials.imap, this._pinsFor(account), c));
        } catch (e) {
            if (!isOfflineError(e))
                throw e;
            console.warn(`posta: ${account.address} offline, using cache: ${e.message}`);
            entry.online = false;
            return false;
        }
        await withTimeout(OPERATION_TIMEOUT_MS, c => entry.store.set_online(true, GLib.PRIORITY_DEFAULT, c));
        entry.online = true;
        return true;
    }

    async close(account) {
        const entry = this._entries.get(account.id);
        if (!entry)
            return;
        this._entries.delete(account.id);
        for (const service of [entry.store, entry.transport]) {
            try {
                await withTimeout(OPERATION_TIMEOUT_MS, c => service.disconnect(true, GLib.PRIORITY_DEFAULT, c));
            } catch (e) {
                console.warn(`posta: disconnecting ${account.address}: ${e.message}`);
            }
            this._session.remove_service(service);
        }
    }

    // Camel'in sertifika veritabanına kayıt yalnızca Camel'in kendi bağlantı
    // denemesinde düşer (CamelCert'in metin alanları GJS'ten yazılamıyor). Bu
    // yüzden önce bilerek başarısız olacak bir bağlantı açılır, sonra o kaydın
    // güven düzeyi yükseltilir.
    async trustCertificate(account, protocol, certificate) {
        const entry = this._entry(account);
        const server = protocol === 'smtp' ? account.smtp : account.imap;
        const service = protocol === 'smtp' ? entry.transport : entry.store;
        try {
            await withTimeout(LOGIN_TIMEOUT_MS, c => (protocol === 'smtp'
                ? service.connect(GLib.PRIORITY_DEFAULT, c)
                : service.set_online(true, GLib.PRIORITY_DEFAULT, c)));
        } catch (e) {
            console.debug(`posta: expected TLS rejection while recording certificate: ${e.message}`);
        }
        const certdb = Camel.CertDB.get_default();
        const record = certdb.get_host(server.host, camelFingerprint(certificate));
        if (!record)
            throw new UserError('Sertifika kaydedilemedi; yeniden dene');
        record.trust = Camel.CertTrust.FULLY;
        certdb.touch();
        certdb.save();
    }

    _folderCachePath(account) {
        return GLib.build_filenamev([this._dataDir, `${serviceUid(account)}-folders.json`]);
    }

    async _mailboxes(account) {
        const entry = this._entry(account);
        const path = this._folderCachePath(account);
        if (!entry.online) {
            try {
                const [, bytes] = GLib.file_get_contents(path);
                return JSON.parse(new TextDecoder().decode(bytes));
            } catch (e) {
                console.warn(`posta: no cached folder list for ${account.address}: ${e.message}`);
                return [{fullName: 'INBOX', displayName: 'INBOX', attributes: []}];
            }
        }
        const mailboxes = await withTimeout(OPERATION_TIMEOUT_MS, c =>
            listMailboxes({protocol: 'imap', ...account.imap}, entry.credentials.imap, this._pinsFor(account), c));
        GLib.file_set_contents(path, JSON.stringify(mailboxes));
        return mailboxes;
    }

    async folders(account) {
        const entry = this._entry(account);
        const mailboxes = (await this._mailboxes(account)).filter(selectable);
        // Camel'in klasör özetini sunucuyla eşitler; get_folder bunu bekler.
        const flags = Camel.StoreGetFolderInfoFlags.RECURSIVE |
            (entry.online ? Camel.StoreGetFolderInfoFlags.REFRESH : 0);
        await withTimeout(OPERATION_TIMEOUT_MS, c => entry.store.get_folder_info(null, flags, GLib.PRIORITY_DEFAULT, c));
        const folders = mailboxes.map(mailbox => ({
            fullName: mailbox.fullName,
            displayName: mailbox.displayName,
            role: roleOf(mailbox),
            unread: mailbox.unread ?? 0,
            total: mailbox.total ?? 0,
            depth: mailbox.fullName.split('/').length - 1,
        }));
        entry.folders = folders.sort(compareFolders);
        return entry.folders;
    }

    async folder(account, fullName) {
        const entry = this._entry(account);
        return withTimeout(OPERATION_TIMEOUT_MS, c =>
            entry.store.get_folder(fullName, 0, GLib.PRIORITY_DEFAULT, c));
    }

    async refresh(account, folder) {
        if (!this._entry(account).online)
            return;
        await withTimeout(REFRESH_TIMEOUT_MS, c => folder.refresh_info(GLib.PRIORITY_DEFAULT, c));
    }

    summary(folder, uid) {
        const info = folder.get_message_info(uid);
        if (!info)
            return null;
        const sender = parseAddressList(info.get_from() ?? '').addresses[0];
        const flags = info.get_flags();
        return {
            uid,
            subject: info.get_subject() ?? '',
            sender: sender ? sender.name || sender.email : (info.get_from() ?? ''),
            date: info.get_date_sent() || info.get_date_received(),
            unread: !(flags & Camel.MessageFlags.SEEN),
            flagged: !!(flags & Camel.MessageFlags.FLAGGED),
            attachment: !!(flags & Camel.MessageFlags.ATTACHMENTS),
            deleted: !!(flags & Camel.MessageFlags.DELETED),
        };
    }

    async summaries(folder, uids = folder.get_uids()) {
        const records = [];
        for (let i = 0; i < uids.length; i += SUMMARY_BATCH) {
            for (const uid of uids.slice(i, i + SUMMARY_BATCH)) {
                const record = this.summary(folder, uid);
                if (record && !record.deleted)
                    records.push(record);
            }
            await idle();
        }
        return records;
    }

    async message(account, folder, uid) {
        try {
            const message = await withTimeout(OPERATION_TIMEOUT_MS, c =>
                folder.get_message(uid, GLib.PRIORITY_DEFAULT, c));
            return parseMessage(message);
        } catch (e) {
            if (!this._entry(account).online)
                throw new UserError('Çevrimdışısın ve bu ileti henüz indirilmemiş');
            throw e;
        }
    }

    setFlags(folder, uids, mask, set) {
        for (const uid of uids)
            folder.set_message_flags(uid, mask, set);
        this._scheduleSync(folder);
    }

    _scheduleSync(folder) {
        folder.synchronize(false, GLib.PRIORITY_DEFAULT, null).catch(e =>
            console.warn(`posta: syncing flags of ${folder.get_full_name()}: ${e.message}`));
    }

    specialFolder(account, role) {
        return this._entry(account).folders.find(f => f.role === role) ?? null;
    }

    async moveMessages(account, source, uids, destinationName) {
        const destination = await this.folder(account, destinationName);
        await this.refresh(account, destination);
        const existing = new Set(destination.get_uids());
        const ids = new Set(uids.map(uid => messageFingerprint(source.get_message_info(uid))).filter(Boolean));
        const result = await withTimeout(OPERATION_TIMEOUT_MS, c =>
            source.transfer_messages_to(uids, destination, true, GLib.PRIORITY_DEFAULT, c));
        await this.refresh(account, destination);
        // Promisify, finish'in dönüş değerini ve çıktı parametresini dizi olarak verir.
        let moved = Array.isArray(result) ? result[1] ?? [] : [];
        // Camel MOVE'da sunucunun bildirdiği yeni uid'leri iletmiyor. Taşınan
        // iletiler hedefte yeni beliren uid'ler arasından başlıklarıyla bulunur.
        // Camel'in 64 bitlik ileti kimliği özeti JS sayısına sığmadığı için
        // kullanılmıyor.
        if (moved.length === 0) {
            moved = destination.get_uids().filter(uid =>
                !existing.has(uid) && ids.has(messageFingerprint(destination.get_message_info(uid))));
        }
        return {destination, moved};
    }

    async moveToTrash(account, folder, uids) {
        const trash = this.specialFolder(account, 'trash');
        if (!trash)
            throw new UserError('Bu hesapta çöp klasörü bulunamadı');
        if (trash.fullName === folder.get_full_name()) {
            this.setFlags(folder, uids, Camel.MessageFlags.DELETED, Camel.MessageFlags.DELETED);
            await withTimeout(OPERATION_TIMEOUT_MS, c => folder.synchronize(true, GLib.PRIORITY_DEFAULT, c));
            return {permanent: true, moved: []};
        }
        const {moved} = await this.moveMessages(account, folder, uids, trash.fullName);
        return {permanent: false, moved, trashName: trash.fullName};
    }

    async search(account, folder, query) {
        const entry = this._entry(account);
        if (!entry.online)
            return null;
        return withTimeout(OPERATION_TIMEOUT_MS, c => searchText({protocol: 'imap', ...account.imap},
            entry.credentials.imap, this._pinsFor(account), folder.get_full_name(), query, c));
    }

    async verifySmtp(account) {
        const entry = this._entry(account);
        await withTimeout(LOGIN_TIMEOUT_MS, c =>
            verifyLogin({protocol: 'smtp', ...account.smtp}, entry.credentials.smtp, this._pinsFor(account), c));
    }

    async send(account, message, recipients) {
        const entry = this._entry(account);
        await this.verifySmtp(account);
        const from = internetAddress([{name: account.displayName, email: account.address}]);
        await withTimeout(OPERATION_TIMEOUT_MS, async c => {
            await entry.transport.connect(GLib.PRIORITY_DEFAULT, c);
            await entry.transport.send_to(message, from, internetAddress(recipients), GLib.PRIORITY_DEFAULT, c);
        });
        try {
            await entry.transport.disconnect(true, GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            console.warn(`posta: closing SMTP connection: ${e.message}`);
        }
        await this._saveSent(account, message);
    }

    async _saveSent(account, message) {
        const sent = this.specialFolder(account, 'sent');
        if (!sent || !this._entry(account).online) {
            console.warn(`posta: ${account.address} has no reachable Sent folder; sent copy not saved`);
            return false;
        }
        const folder = await this.folder(account, sent.fullName);
        const info = Camel.MessageInfo.new(null);
        info.set_flags(Camel.MessageFlags.SEEN, Camel.MessageFlags.SEEN);
        await withTimeout(OPERATION_TIMEOUT_MS, c =>
            folder.append_message(message, info, GLib.PRIORITY_DEFAULT, c));
        return true;
    }
}
