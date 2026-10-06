import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

const MAX_ENTRIES = 25;
const MAX_ENTRY_LENGTH = 4000;
// Parola yöneticileri (KeePassXC, KDE) sırları bu tiple işaretler ki pano
// araçları onlara dokunmasın.
const SECRET_HINT_TYPE = 'x-kde-passwordManagerHint';

// Komut için son pano metinleri. Yalnızca bellekte tutulur: kopyalanan hiçbir şey
// diske ulaşmaz ve ayarı kapatmak geçmişi hemen düşürür.
export class VatanClipboardHistory {
    constructor() {
        this._entries = [];
        this._lastId = 0;
        this._settings = new Gio.Settings({schema_id: 'org.vatan.shell'});
        this._settings.connectObject('changed::clipboard-history', () => {
            if (!this.enabled)
                this._entries = [];
        }, this);

        global.display.get_selection().connectObject('owner-changed',
            (_selection, type, source) => this._onOwnerChanged(type, source), this);
    }

    get enabled() {
        return this._settings.get_boolean('clipboard-history');
    }

    get entries() {
        return this._entries;
    }

    find(id) {
        return this._entries.find(entry => entry.id === id) ?? null;
    }

    copy(entry) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, entry.text);
    }

    _onOwnerChanged(type, source) {
        if (type !== Meta.SelectionType.SELECTION_CLIPBOARD || !source || !this.enabled)
            return;
        if (source.get_mimetypes().includes(SECRET_HINT_TYPE))
            return;

        St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (_clipboard, text) => {
            if (!text?.trim() || text.length > MAX_ENTRY_LENGTH)
                return;
            this._entries = [
                {id: ++this._lastId, text},
                ...this._entries.filter(entry => entry.text !== text),
            ].slice(0, MAX_ENTRIES);
        });
    }
}
