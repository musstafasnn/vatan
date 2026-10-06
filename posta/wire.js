// Camel'in kimlik doğrulaması ve sertifika kararı GJS'ten güvenle
// kancalanamıyor (bkz. engine.js). Bu modül, Camel'e parola vermeden önce aynı
// sunucuya kendi kısa TLS bağlantısını açar: sertifikayı kullanıcıya gösterilecek
// biçimde yakalar ve parolayı tek bir denemeyle doğrular. Gövde araması da
// buradan gider; Camel'in arama çağrısının async sürümü yok.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';

import {encodeImapUtf7, imapQuote, parseListLine, parseStatusLine} from './mail-format.js';

Gio._promisify(Gio.SocketClient.prototype, 'connect_async');
Gio._promisify(Gio.TlsConnection.prototype, 'handshake_async');
Gio._promisify(Gio.DataInputStream.prototype, 'read_line_async', 'read_line_finish_utf8');
Gio._promisify(Gio.OutputStream.prototype, 'write_all_async');
Gio._promisify(Gio.IOStream.prototype, 'close_async');

const SOCKET_TIMEOUT_S = 30;
const SMTP_HELO_NAME = '[127.0.0.1]';

export class CertificateError extends Error {
    constructor(host, port, certificate, errors) {
        super(`${host}:${port} certificate rejected (flags ${errors})`);
        this.host = host;
        this.port = port;
        this.certificate = certificate;
        this.errors = errors;
    }
}

export class AuthError extends Error {}

export class ProtocolError extends Error {}

// Gio.SocketClient'ın kendi connect() yöntemi GObject'in sinyal bağlama
// yöntemini gölgeliyor.
function connectSignal(object, signal, handler) {
    return GObject.Object.prototype.connect.call(object, signal, handler);
}

function hexPairs(hex) {
    return hex.match(/../g);
}

export function sha256Fingerprint(certificate) {
    return hexPairs(GLib.compute_checksum_for_bytes(GLib.ChecksumType.SHA256, certificate.certificate))
        .join(':').toUpperCase();
}

// Camel'in sertifika veritabanı anahtarı: DER'in MD5'i, her bayttan sonra iki
// nokta (sondaki dahil). camel-network-service.c ile birebir aynı olmalı.
export function camelFingerprint(certificate) {
    const md5 = GLib.compute_checksum_for_bytes(GLib.ChecksumType.MD5, certificate.certificate);
    return hexPairs(md5).map(pair => `${pair}:`).join('');
}

export function describeCertificateErrors(errors) {
    const reasons = [
        [Gio.TlsCertificateFlags.UNKNOWN_CA, 'Sertifikayı tanınan bir yetkili imzalamamış'],
        [Gio.TlsCertificateFlags.BAD_IDENTITY, 'Sertifika bu sunucu adına verilmemiş'],
        [Gio.TlsCertificateFlags.NOT_ACTIVATED, 'Sertifikanın geçerlilik süresi henüz başlamamış'],
        [Gio.TlsCertificateFlags.EXPIRED, 'Sertifikanın süresi dolmuş'],
        [Gio.TlsCertificateFlags.REVOKED, 'Sertifika iptal edilmiş'],
        [Gio.TlsCertificateFlags.INSECURE, 'Sertifika güvensiz bir algoritma kullanıyor'],
    ];
    const found = reasons.filter(([flag]) => errors & flag).map(([, text]) => text);
    return found.length ? found : ['Sertifika doğrulanamadı'];
}

class LineChannel {
    constructor(connection) {
        this.connection = connection;
        this._input = new Gio.DataInputStream({
            base_stream: connection.get_input_stream(),
            close_base_stream: false,
            newline_type: Gio.DataStreamNewlineType.ANY,
        });
        this._output = connection.get_output_stream();
    }

    async readLine(cancellable) {
        const [line] = await this._input.read_line_async(GLib.PRIORITY_DEFAULT, cancellable);
        if (line === null)
            throw new ProtocolError('server closed the connection');
        return line;
    }

    async write(data, cancellable) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        await this._output.write_all_async(bytes, GLib.PRIORITY_DEFAULT, cancellable);
    }

    async close() {
        try {
            await this.connection.close_async(GLib.PRIORITY_DEFAULT, null);
        } catch (e) {
            console.debug(`posta: closing probe connection: ${e.message}`);
        }
    }
}

function certificateGuard(server, pins) {
    const guard = {rejected: null};
    guard.attach = tls => {
        tls.connect('accept-certificate', (_tls, certificate, errors) => {
            if (!(errors & Gio.TlsCertificateFlags.REVOKED) && pins.includes(sha256Fingerprint(certificate)))
                return true;
            guard.rejected = {certificate, errors};
            return false;
        });
    };
    guard.rethrow = e => {
        if (guard.rejected)
            throw new CertificateError(server.host, server.port, guard.rejected.certificate, guard.rejected.errors);
        throw e;
    };
    return guard;
}

async function connectTcp(server, implicitTls, guard, cancellable) {
    const client = new Gio.SocketClient({tls: implicitTls, timeout: SOCKET_TIMEOUT_S});
    if (implicitTls) {
        connectSignal(client, 'event', (_client, event, _connectable, stream) => {
            if (event === Gio.SocketClientEvent.TLS_HANDSHAKING)
                guard.attach(stream);
        });
    }
    try {
        return await client.connect_async(Gio.NetworkAddress.new(server.host, server.port), cancellable);
    } catch (e) {
        return guard.rethrow(e);
    }
}

async function upgradeToTls(channel, server, guard, cancellable) {
    const tls = Gio.TlsClientConnection.new(channel.connection, Gio.NetworkAddress.new(server.host, server.port));
    guard.attach(tls);
    try {
        // GnuTLS bağlantısı DtlsConnection'ı da uyguluyor; adsız çağrı o
        // arayüzün söz verilmemiş yöntemine düşüyor.
        await Gio.TlsConnection.prototype.handshake_async.call(tls, GLib.PRIORITY_DEFAULT, cancellable);
    } catch (e) {
        guard.rethrow(e);
    }
    return new LineChannel(tls);
}

function plainToken(user, password) {
    return GLib.base64_encode(new TextEncoder().encode(`\0${user}\0${password}`));
}

async function imapTagged(channel, tag, cancellable, onLine = () => {}) {
    for (;;) {
        const line = await channel.readLine(cancellable);
        if (line.startsWith(`${tag} `))
            return line.slice(tag.length + 1);
        onLine(line);
    }
}

async function imapContinuation(channel, tag, cancellable) {
    for (;;) {
        const line = await channel.readLine(cancellable);
        if (line.startsWith('+'))
            return;
        if (line.startsWith(`${tag} `))
            throw new ProtocolError(`server refused: ${line}`);
    }
}

async function imapOpen(server, password, pins, cancellable) {
    const guard = certificateGuard(server, pins);
    const channel = new LineChannel(await connectTcp(server, server.security === 'ssl', guard, cancellable));
    try {
        return await imapLogin(channel, server, password, guard, cancellable);
    } catch (e) {
        await channel.close();
        throw e;
    }
}

async function imapLogin(channel, server, password, guard, cancellable) {
    const greeting = await channel.readLine(cancellable);
    if (!greeting.startsWith('* OK'))
        throw new ProtocolError(`unexpected greeting: ${greeting}`);
    if (server.security === 'starttls') {
        await channel.write('S1 STARTTLS\r\n', cancellable);
        const status = await imapTagged(channel, 'S1', cancellable);
        if (!status.startsWith('OK'))
            throw new ProtocolError(`STARTTLS refused: ${status}`);
        channel = await upgradeToTls(channel, server, guard, cancellable);
    }

    await channel.write('A1 AUTHENTICATE PLAIN\r\n', cancellable);
    await imapContinuation(channel, 'A1', cancellable);
    await channel.write(`${plainToken(server.user, password)}\r\n`, cancellable);
    const status = await imapTagged(channel, 'A1', cancellable);
    if (status.startsWith('NO'))
        throw new AuthError(status);
    if (!status.startsWith('OK'))
        throw new ProtocolError(`AUTHENTICATE: ${status}`);
    return channel;
}

async function smtpReply(channel, cancellable) {
    const lines = [];
    for (;;) {
        const line = await channel.readLine(cancellable);
        lines.push(line);
        if (line.length < 4 || line[3] !== '-')
            return {code: Number(line.slice(0, 3)), lines};
    }
}

async function smtpExpect(channel, command, expected, cancellable) {
    if (command)
        await channel.write(`${command}\r\n`, cancellable);
    const reply = await smtpReply(channel, cancellable);
    if (reply.code !== expected)
        throw new ProtocolError(`SMTP ${command?.split(' ')[0] ?? 'greeting'}: ${reply.lines.join(' | ')}`);
    return reply;
}

async function smtpVerify(server, password, pins, cancellable) {
    const guard = certificateGuard(server, pins);
    let channel = new LineChannel(await connectTcp(server, server.security === 'ssl', guard, cancellable));
    try {
        await smtpExpect(channel, null, 220, cancellable);
        await smtpExpect(channel, `EHLO ${SMTP_HELO_NAME}`, 250, cancellable);
        if (server.security === 'starttls') {
            await smtpExpect(channel, 'STARTTLS', 220, cancellable);
            channel = await upgradeToTls(channel, server, guard, cancellable);
            await smtpExpect(channel, `EHLO ${SMTP_HELO_NAME}`, 250, cancellable);
        }
        await channel.write(`AUTH PLAIN ${plainToken(server.user, password)}\r\n`, cancellable);
        const reply = await smtpReply(channel, cancellable);
        if (reply.code === 535 || reply.code === 534)
            throw new AuthError(reply.lines.join(' '));
        if (reply.code !== 235)
            throw new ProtocolError(`AUTH: ${reply.lines.join(' | ')}`);
        await channel.write('QUIT\r\n', cancellable);
    } finally {
        await channel.close();
    }
}

export async function verifyLogin(server, password, pins, cancellable) {
    if (server.protocol === 'smtp') {
        await smtpVerify(server, password, pins, cancellable);
        return;
    }
    await withImap(server, password, pins, cancellable, () => null);
}

// Camel klasör ağacını yalnızca bağlı liste alanlarıyla (next/child) veriyor ve
// GJS bu işaretçi alanları okuyamıyor; klasör listesi bu yüzden doğrudan
// sunucunun LIST yanıtından kurulur. Özel kullanım işaretleri (\Sent,
// \Trash) de oradan gelir.
async function imapList(channel, pattern, cancellable, withStatus = false) {
    const mailboxes = [];
    const counts = new Map();
    const returnOption = withStatus ? ' RETURN (STATUS (MESSAGES UNSEEN))' : '';
    await channel.write(`L1 LIST "" ${imapQuote(pattern)}${returnOption}\r\n`, cancellable);
    const status = await imapTagged(channel, 'L1', cancellable, line => {
        const mailbox = parseListLine(line);
        if (mailbox)
            mailboxes.push(mailbox);
        const count = parseStatusLine(line);
        if (count)
            counts.set(count.rawName, count);
    });
    // LIST-STATUS (RFC 5819) her sunucuda yok; desteklemeyen sunucuda sayılar boş kalır.
    if (withStatus && status.startsWith('BAD'))
        return imapList(channel, pattern, cancellable, false);
    if (!status.startsWith('OK'))
        throw new ProtocolError(`LIST: ${status}`);
    for (const mailbox of mailboxes) {
        const count = counts.get(mailbox.rawName);
        mailbox.total = count?.messages ?? null;
        mailbox.unread = count?.unseen ?? null;
    }
    return mailboxes;
}

async function withImap(server, password, pins, cancellable, work) {
    const channel = await imapOpen(server, password, pins, cancellable);
    try {
        const result = await work(channel);
        await channel.write('A9 LOGOUT\r\n', cancellable);
        return result;
    } finally {
        await channel.close();
    }
}

export function listMailboxes(server, password, pins, cancellable) {
    return withImap(server, password, pins, cancellable, channel => imapList(channel, '*', cancellable, true));
}

// Camel klasör adlarını "/" ile ayırır; sunucunun kendi ayırıcısı LIST
// yanıtından öğrenilir.
function serverMailboxName(fullName, separator) {
    return encodeImapUtf7(separator && separator !== '/' ? fullName.split('/').join(separator) : fullName);
}

export function searchText(server, password, pins, folderFullName, query, cancellable) {
    return withImap(server, password, pins, cancellable, async channel => {
        const [root] = await imapList(channel, '', cancellable);
        const mailbox = serverMailboxName(folderFullName, root?.separator);
        await channel.write(`E1 EXAMINE ${imapQuote(mailbox)}\r\n`, cancellable);
        const examined = await imapTagged(channel, 'E1', cancellable);
        if (!examined.startsWith('OK'))
            throw new ProtocolError(`EXAMINE ${mailbox}: ${examined}`);

        const needle = new TextEncoder().encode(query);
        await channel.write(`S2 UID SEARCH CHARSET UTF-8 TEXT {${needle.length}}\r\n`, cancellable);
        await imapContinuation(channel, 'S2', cancellable);
        await channel.write(needle, cancellable);
        await channel.write('\r\n', cancellable);
        const uids = [];
        const status = await imapTagged(channel, 'S2', cancellable, line => {
            if (line.startsWith('* SEARCH'))
                uids.push(...line.slice('* SEARCH'.length).trim().split(/\s+/).filter(Boolean));
        });
        if (!status.startsWith('OK'))
            throw new ProtocolError(`SEARCH: ${status}`);
        return uids;
    });
}
