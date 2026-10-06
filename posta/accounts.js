import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Goa from 'gi://Goa?version=1.0';
import Secret from 'gi://Secret?version=1';

import {UserError} from './engine.js';

Gio._promisify(Secret, 'password_store', 'password_store_finish');
Gio._promisify(Secret, 'password_lookup', 'password_lookup_finish');
Gio._promisify(Secret, 'password_clear', 'password_clear_finish');
Gio._promisify(Goa.Client, 'new', 'new_finish');
Gio._promisify(Goa.PasswordBasedProxy.prototype, 'call_get_password', 'call_get_password_finish');

// Parola yalnızca anahtarlıkta durur; GSettings'te sunucu ve kullanıcı adı
// kalır. Şema adı brifte sabitlendi, başka uygulamalar parolayı bu adla bulur.
const SECRET_SCHEMA = new Secret.Schema('org.vatan.Posta.Password', Secret.SchemaFlags.NONE, {
    account: Secret.SchemaAttributeType.STRING,
    protocol: Secret.SchemaAttributeType.STRING,
});

const DEFAULT_PORTS = {
    imap: {ssl: 993, starttls: 143},
    smtp: {ssl: 465, starttls: 587},
};

export function defaultPort(protocol, security) {
    return DEFAULT_PORTS[protocol][security];
}

function fromRecord(record) {
    const server = protocol => ({
        host: record[`${protocol}-host`],
        port: Number(record[`${protocol}-port`]),
        security: record[`${protocol}-security`],
        user: record[`${protocol}-user`],
    });
    return {
        id: record.id,
        source: 'manual',
        displayName: record['display-name'],
        address: record.address,
        imap: server('imap'),
        smtp: server('smtp'),
        unsupported: null,
    };
}

function toRecord(account) {
    const record = {id: account.id, 'display-name': account.displayName, address: account.address};
    for (const protocol of ['imap', 'smtp']) {
        for (const key of ['host', 'port', 'security', 'user'])
            record[`${protocol}-${key}`] = String(account[protocol][key]);
    }
    return record;
}

function splitHostPort(value) {
    const match = /^(.*?)(?::(\d+))?$/.exec(value ?? '');
    return [match[1], match[2] ? Number(match[2]) : null];
}

function goaServer(protocol, hostField, user, useSsl, useTls) {
    const security = useSsl ? 'ssl' : useTls ? 'starttls' : null;
    if (!security)
        return null;
    const [host, port] = splitHostPort(hostField);
    return {host, port: port ?? defaultPort(protocol, security), security, user};
}

function goaAccount(object) {
    const account = object.get_account();
    const mail = object.get_mail();
    const imap = goaServer('imap', mail.imap_host, mail.imap_user_name, mail.imap_use_ssl, mail.imap_use_tls);
    const smtp = goaServer('smtp', mail.smtp_host, mail.smtp_user_name, mail.smtp_use_ssl, mail.smtp_use_tls);
    let unsupported = null;
    if (object.get_oauth2_based())
        unsupported = `${account.provider_name} hesabı tarayıcı oturumuyla (OAuth) bağlanıyor; VATAN Posta bunu henüz desteklemiyor.`;
    else if (!object.get_password_based())
        unsupported = 'Bu hesabın parolası Çevrimiçi Hesaplar\'dan alınamıyor.';
    else if (!imap || !smtp)
        unsupported = 'Bu hesap şifresiz bağlantı kullanıyor; VATAN Posta yalnızca SSL/TLS ya da STARTTLS ile bağlanır.';
    return {
        id: `goa-${account.id}`,
        source: 'goa',
        displayName: mail.name || account.presentation_identity,
        address: mail.email_address,
        imap: imap ?? {host: '', port: 0, security: 'ssl', user: ''},
        smtp: smtp ?? {host: '', port: 0, security: 'ssl', user: ''},
        unsupported,
        goa: object,
    };
}

export class AccountStore {
    constructor(settings) {
        this._settings = settings;
    }

    manual() {
        return this._settings.get_value('accounts').recursiveUnpack().map(fromRecord);
    }

    async goa() {
        let client;
        try {
            client = await Goa.Client.new(null);
        } catch (e) {
            console.warn(`posta: GNOME Online Accounts unavailable: ${e.message}`);
            return [];
        }
        return client.get_accounts()
            .filter(object => object.get_mail() && !object.get_account().mail_disabled)
            .map(goaAccount)
            .sort((a, b) => a.address.localeCompare(b.address, 'tr') || (a.id < b.id ? -1 : 1));
    }

    async all() {
        return [...this.manual(), ...await this.goa()];
    }

    _write(accounts) {
        this._settings.set_value('accounts', new GLib.Variant('aa{ss}', accounts.map(toRecord)));
    }

    hasAddress(address) {
        return this.manual().some(a => a.address.toLowerCase() === address.toLowerCase());
    }

    async add(account, password) {
        try {
            await Secret.password_store(SECRET_SCHEMA, {account: account.id, protocol: 'imap'},
                Secret.COLLECTION_DEFAULT, `VATAN Posta: ${account.address}`, password, null);
        } catch (e) {
            console.warn(`posta: storing password: ${e.message}`);
            throw new UserError('Parola anahtarlığa kaydedilemedi; anahtarlık kilitli olabilir');
        }
        this._write([...this.manual(), account]);
    }

    async remove(account) {
        this._write(this.manual().filter(a => a.id !== account.id));
        await Secret.password_clear(SECRET_SCHEMA, {account: account.id, protocol: 'imap'}, null);
    }

    async credentials(account) {
        if (account.source === 'goa') {
            const passwordBased = account.goa.get_password_based();
            const [, imap] = await passwordBased.call_get_password('imap-password', null);
            const [, smtp] = await passwordBased.call_get_password('smtp-password', null);
            return {imap, smtp: smtp || imap};
        }
        let password;
        try {
            password = await Secret.password_lookup(SECRET_SCHEMA, {account: account.id, protocol: 'imap'}, null);
        } catch (e) {
            console.warn(`posta: reading password: ${e.message}`);
            throw new UserError('Anahtarlık açılamadı; parola okunamadı');
        }
        if (password === null)
            return null;
        return {imap: password, smtp: password};
    }

    // Parmak izi sunucu adına bağlanır, bağlantı noktasına değil: IMAP için
    // onaylanan sertifika aynı sunucunun SMTP'sinde yeniden sorulmaz.
    pins(account) {
        const hosts = [account.imap.host, account.smtp.host];
        return this._settings.get_strv('trusted-certificates')
            .map(entry => entry.split(' '))
            .filter(([server]) => hosts.includes(server.slice(0, server.lastIndexOf(':'))))
            .map(([, fingerprint]) => fingerprint);
    }

    trust(server, fingerprint) {
        const entry = `${server.host}:${server.port} ${fingerprint}`;
        const entries = this._settings.get_strv('trusted-certificates');
        if (!entries.includes(entry))
            this._settings.set_strv('trusted-certificates', [...entries, entry].sort());
    }
}

export function newAccountId() {
    return GLib.uuid_string_random();
}
