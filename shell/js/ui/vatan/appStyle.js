import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const STYLE_DIR = '/usr/share/vatan/style';
const BLOCK_START = '/* VATAN uygulama görünümü: başlangıç */';
const BLOCK_END = '/* VATAN uygulama görünümü: bitiş */';

// GNOME'un vurgu adları; GTK 3 uygulamaları adı değil rengi bilir.
const ACCENTS = {
    blue: '#3584e4', teal: '#2190a4', green: '#3a944a', yellow: '#c88800', orange: '#ed5b00',
    red: '#e62d42', pink: '#d56199', purple: '#9141ac', slate: '#6f8396',
};

const GTK3_PALETTES = {
    light: {
        window_bg_color: '#f6f7f9', view_bg_color: '#ffffff', headerbar_bg_color: '#f6f7f9',
        headerbar_backdrop_color: '#f6f7f9', sidebar_bg_color: '#eceef2', card_bg_color: '#ffffff',
        popover_bg_color: '#ffffff', window_fg_color: '#14181f', view_fg_color: '#14181f',
        headerbar_fg_color: '#14181f',
    },
    dark: {
        window_bg_color: '#16191e', view_bg_color: '#111317', headerbar_bg_color: '#1b1f25',
        headerbar_backdrop_color: '#16191e', sidebar_bg_color: '#14171c', card_bg_color: '#1b1e24',
        popover_bg_color: '#20242b', window_fg_color: '#eceef1', view_fg_color: '#eceef1',
        headerbar_fg_color: '#eceef1',
    },
};

// Masaüstü simgesi eklentisi etiketleri sabit beyaz yazar; açık duvar
// kağıdında okunmaz. Etiketin arkasındaki koyu cam her iki temada da okunur ve
// tema değişince eklentiyi yeniden başlatmayı gerektirmez.
const DESKTOP_LABEL_CSS = `
.file-label, label.file-label:backdrop, .file-label-dark, label.file-label-dark:backdrop {
  color: #f3f4f6;
  text-shadow: none;
  background-color: rgba(20, 24, 31, 0.58);
  border-radius: 6px;
  padding: 1px 6px;
}`;

// Okunamayan dosya için null döner: boş sayılıp üzerine yazılırsa kullanıcının
// CSS'i kaybolur. Olmayan dosya ise gerçekten boştur.
function readText(file) {
    try {
        const [, bytes] = file.load_contents(null);
        return new TextDecoder().decode(bytes);
    } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return '';
        console.warn(`VATAN görünüm: ${file.get_path()} okunamadı, dokunulmadı: ${e.message}`);
        return null;
    }
}

function writeText(file, text) {
    try {
        file.get_parent().make_directory_with_parents(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            throw e;
    }
    // REPLACE_DESTINATION verilmez: gtk.css bir dotfiles bağıysa bağ korunur ve
    // hedefine yazılır.
    file.replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.NONE, null);
}

function withoutBlock(text) {
    const start = text.indexOf(BLOCK_START);
    const end = text.indexOf(BLOCK_END);
    if (start < 0 || end < start)
        return text;
    return text.slice(0, start) + text.slice(end + BLOCK_END.length).replace(/^\n/, '');
}

// Uygulamalar ~/.config/gtk-*/gtk.css dosyasını okur; oraya yalnızca bu oturumun
// çalışma dizinindeki dosyayı içe aktaran bir blok eklenir. Kabuk birimi
// kapanırken (ExecStopPost) o dosyaları siler; böylece hemen ardından açılan
// GNOME oturumu VATAN görünümünü almaz, GTK yalnızca "içe aktarılamadı" uyarısı
// yazar. Kullanıcının kendi CSS'i korunur.
export class VatanAppStyle {
    constructor() {
        this._runtimeDir = Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_runtime_dir(), 'vatan']));
        this._settings = new Gio.Settings({schema_id: 'org.vatan.shell'});
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        this._settings.connectObject('changed::app-style', () => this._sync(), this);
        this._interface.connectObject(
            'changed::color-scheme', () => this._sync(),
            'changed::accent-color', () => this._sync(),
            this);
        this._sync();
    }

    _sync() {
        try {
            if (this._settings.get_boolean('app-style'))
                this._apply();
            else
                this._remove();
        } catch (e) {
            console.error(`VATAN görünüm: ${e.message}`);
        }
    }

    _runtimeFile(version) {
        return this._runtimeDir.get_child(`gtk-${version}.css`);
    }

    _userFile(version) {
        return Gio.File.new_for_path(GLib.build_filenamev([GLib.get_user_config_dir(), `gtk-${version}`, 'gtk.css']));
    }

    _apply() {
        writeText(this._runtimeFile('4.0'), `@import url("file://${STYLE_DIR}/gtk-4.0.css");\n`);
        writeText(this._runtimeFile('3.0'), this._gtk3Css());

        for (const version of ['4.0', '3.0']) {
            const user = this._userFile(version);
            const text = readText(user);
            if (text === null)
                continue;
            // @import kuralları dosyanın başında olmalı; blok her zaman en üste gider.
            const block = `${BLOCK_START}\n@import url("${this._runtimeFile(version).get_uri()}");\n${BLOCK_END}\n`;
            if (!text.startsWith(block))
                writeText(user, block + withoutBlock(text));
        }
    }

    _remove() {
        for (const version of ['4.0', '3.0']) {
            const user = this._userFile(version);
            const text = readText(user);
            const rest = text === null ? null : withoutBlock(text);
            if (rest !== null && rest !== text)
                writeText(user, rest);
            try {
                this._runtimeFile(version).delete(null);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                    console.warn(`VATAN görünüm: ${e.message}`);
            }
        }
    }

    // GTK 3 medya sorgusu bilmez; açık/koyu ve vurgu rengi buraya o an yazılır.
    // GTK 3 uygulamaları değişikliği bir sonraki açılışta alır.
    _gtk3Css() {
        const dark = this._interface.get_string('color-scheme') === 'prefer-dark';
        const palette = GTK3_PALETTES[dark ? 'dark' : 'light'];
        const accent = ACCENTS[this._interface.get_string('accent-color')] ?? ACCENTS.red;
        const lines = Object.entries(palette).map(([name, value]) => `@define-color ${name} ${value};`);
        lines.push(`@define-color accent_bg_color ${accent};`, '@define-color accent_color @accent_bg_color;');
        lines.push(DESKTOP_LABEL_CSS);
        return `${lines.join('\n')}\n`;
    }
}
