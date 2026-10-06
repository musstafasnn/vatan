import Adw from 'gi://Adw?version=1';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {defaultPort, newAccountId} from './accounts.js';
import {parseAddressList} from './mail-format.js';
import {describeCertificateErrors, sha256Fingerprint} from './wire.js';

// Şifresiz bağlantı seçeneği bilerek yok.
const SECURITY_CHOICES = [
    {id: 'ssl', label: 'SSL/TLS'},
    {id: 'starttls', label: 'STARTTLS'},
];
const MAX_PORT = 65535;

const FINGERPRINT_PAIRS_PER_LINE = 8;

function fingerprintLines(fingerprint) {
    const pairs = fingerprint.split(':');
    const lines = [];
    for (let i = 0; i < pairs.length; i += FINGERPRINT_PAIRS_PER_LINE)
        lines.push(pairs.slice(i, i + FINGERPRINT_PAIRS_PER_LINE).join(':'));
    return lines.join('\n');
}

export function askTrust(parent, error) {
    const fingerprint = sha256Fingerprint(error.certificate);
    const reasons = describeCertificateErrors(error.errors).map(r => `• ${GLib.markup_escape_text(r, -1)}`).join('\n');
    const dialog = new Adw.AlertDialog({
        heading: 'Sertifika doğrulanamadı',
        body_use_markup: true,
        body: `<b>${GLib.markup_escape_text(error.host, -1)}:${error.port}</b> sunucusunun kimliği doğrulanamadı.\n\n${reasons}\n\n` +
            `SHA-256 parmak izi:\n<tt>${fingerprintLines(fingerprint)}</tt>\n\n` +
            'Bu parmak izini sunucunun yöneticisinden aldığın değerle karşılaştır. Emin değilsen bağlanma; ' +
            'araya giren biri parolanı ele geçirebilir.',
        close_response: 'cancel',
        default_response: 'cancel',
    });
    dialog.add_response('cancel', 'Bağlanma');
    dialog.add_response('trust', 'Güven ve bağlan');
    dialog.set_response_appearance('trust', Adw.ResponseAppearance.DESTRUCTIVE);
    return new Promise(resolve => {
        dialog.connect('response', (_dialog, response) => resolve(response === 'trust'));
        dialog.present(parent);
    });
}

function serverGroup(title, protocol, defaults) {
    const group = new Adw.PreferencesGroup({title});
    const host = new Adw.EntryRow({title: 'Sunucu'});
    const security = new Adw.ComboRow({
        title: 'Güvenlik',
        model: Gtk.StringList.new(SECURITY_CHOICES.map(c => c.label)),
        selected: SECURITY_CHOICES.findIndex(c => c.id === defaults.security),
    });
    const port = new Adw.SpinRow({
        title: 'Bağlantı noktası',
        adjustment: new Gtk.Adjustment({lower: 1, upper: MAX_PORT, step_increment: 1, value: defaultPort(protocol, defaults.security)}),
    });
    const user = new Adw.EntryRow({title: 'Kullanıcı adı'});
    security.connect('notify::selected', () => {
        port.value = defaultPort(protocol, SECURITY_CHOICES[security.selected].id);
    });
    for (const row of [host, security, port, user])
        group.add(row);
    return {
        group,
        host,
        user,
        read: () => ({
            host: host.text.trim(),
            port: Math.round(port.value),
            security: SECURITY_CHOICES[security.selected].id,
            user: user.text.trim(),
        }),
    };
}

export const AccountDialog = GObject.registerClass(
class AccountDialog extends Adw.Dialog {
    _init(submit) {
        super._init({title: 'Hesap ekle', content_width: 520, content_height: 680});
        this._submit = submit;

        this._name = new Adw.EntryRow({title: 'Adın'});
        this._address = new Adw.EntryRow({title: 'E-posta adresi', input_purpose: Gtk.InputPurpose.EMAIL});
        this._password = new Adw.PasswordEntryRow({title: 'Parola'});
        const identity = new Adw.PreferencesGroup({
            description: 'Parola GNOME anahtarlığında saklanır; diske ya da ayarlara yazılmaz.',
        });
        for (const row of [this._name, this._address, this._password])
            identity.add(row);

        this._imap = serverGroup('Gelen posta (IMAP)', 'imap', {security: 'ssl'});
        this._smtp = serverGroup('Giden posta (SMTP)', 'smtp', {security: 'starttls'});
        // Kullanıcı adı çoğu sağlayıcıda adresin kendisidir; elle değiştirilmediyse
        // adresle birlikte güncellenir.
        this._address.connect('changed', () => {
            for (const server of [this._imap, this._smtp]) {
                if (!server.user.text || server.user.text === this._lastAddress)
                    server.user.text = this._address.text.trim();
            }
            this._lastAddress = this._address.text.trim();
        });
        this._lastAddress = '';

        this._error = new Adw.Banner({revealed: false});
        const page = new Adw.PreferencesPage();
        for (const group of [identity, this._imap.group, this._smtp.group])
            page.add(group);

        const cancel = new Gtk.Button({label: 'Vazgeç'});
        cancel.connect('clicked', () => this.close());
        this._add = new Gtk.Button({label: 'Ekle', css_classes: ['suggested-action']});
        this._add.connect('clicked', () => this._onAdd().catch(e => console.error(`posta: account dialog: ${e.message}\n${e.stack}`)));
        this._spinner = new Adw.Spinner({visible: false});
        const header = new Adw.HeaderBar({show_start_title_buttons: false, show_end_title_buttons: false});
        header.pack_start(cancel);
        header.pack_end(this._add);
        header.pack_end(this._spinner);

        const view = new Adw.ToolbarView({content: page});
        view.add_top_bar(header);
        view.add_top_bar(this._error);
        this.child = view;
        this.default_widget = this._add;
    }

    showError(message) {
        this._error.title = message;
        this._error.revealed = true;
    }

    _validate() {
        const address = this._address.text.trim();
        const parsed = parseAddressList(address).addresses;
        if (parsed.length !== 1 || parsed[0].email !== address)
            return 'Geçerli bir e-posta adresi yaz';
        if (!this._password.text)
            return 'Parolayı yaz';
        for (const [label, server] of [['Gelen', this._imap.read()], ['Giden', this._smtp.read()]]) {
            if (!server.host || /\s/.test(server.host))
                return `${label} posta sunucusunun adını yaz`;
            if (!server.user)
                return `${label} posta kullanıcı adını yaz`;
        }
        return null;
    }

    async _onAdd() {
        const problem = this._validate();
        if (problem) {
            this.showError(problem);
            return;
        }
        this._error.revealed = false;
        const account = {
            id: newAccountId(),
            source: 'manual',
            displayName: this._name.text.trim() || this._address.text.trim(),
            address: this._address.text.trim(),
            imap: this._imap.read(),
            smtp: this._smtp.read(),
            unsupported: null,
        };
        this._setBusy(true);
        try {
            const message = await this._submit(account, this._password.text, this);
            if (message)
                this.showError(message);
            else
                this.close();
        } finally {
            this._setBusy(false);
        }
    }

    _setBusy(busy) {
        this._add.sensitive = !busy;
        this._spinner.visible = busy;
    }
});
