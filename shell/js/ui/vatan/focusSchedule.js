import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {inFocusWindow} from '../../misc/vatanFocus.js';

const CHECK_SECONDS = 30;

// Zamanlanmış aralıkta bildirim balonlarını yalnızca bu kabuk içinde susturur
// (bkz. MessageTray). GNOME ile ortak "show-banners" ayarına dokunulmaz: o ayar
// değiştirilirse odak saatinde GNOME oturumuna geçen kullanıcının bildirimleri
// orada da kapalı kalırdı.
export class VatanFocusSchedule {
    constructor() {
        this._settings = new Gio.Settings({schema_id: 'org.vatan.shell'});
        this._active = false;

        this._settings.connectObject('changed', () => this._sync(), this);
        this._checkId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_SECONDS, () => {
            this._sync();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._checkId, '[gnome-shell] VatanFocusSchedule.check');
        this._sync();
    }

    get active() {
        return this._active;
    }

    _sync() {
        this._active = this._settings.get_boolean('focus-schedule') && inFocusWindow(
            new Date(),
            this._settings.get_string('focus-start'),
            this._settings.get_string('focus-end'),
            this._settings.get_boolean('focus-weekdays-only'));
    }
}
