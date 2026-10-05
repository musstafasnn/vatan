import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {inFocusWindow} from '../../misc/vatanFocus.js';

const CHECK_SECONDS = 30;

// Turns notification banners off inside the scheduled window and back on
// after it. It only undoes what it did: "focus-schedule-owns" records that
// the schedule (not the user) silenced banners, and survives a restart.
export class VatanFocusSchedule {
    constructor() {
        this._settings = new Gio.Settings({schema_id: 'org.vatan.shell'});
        this._notifications = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});

        this._settings.connectObject('changed', () => this._sync(), this);
        this._checkId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, CHECK_SECONDS, () => {
            this._sync();
            return GLib.SOURCE_CONTINUE;
        });
        GLib.Source.set_name_by_id(this._checkId, '[gnome-shell] VatanFocusSchedule.check');
        this._sync();
    }

    _sync() {
        const inside = this._settings.get_boolean('focus-schedule') && inFocusWindow(
            new Date(),
            this._settings.get_string('focus-start'),
            this._settings.get_string('focus-end'),
            this._settings.get_boolean('focus-weekdays-only'));
        const owns = this._settings.get_boolean('focus-schedule-owns');
        const banners = this._notifications.get_boolean('show-banners');

        if (inside && banners && !owns) {
            this._notifications.set_boolean('show-banners', false);
            this._settings.set_boolean('focus-schedule-owns', true);
        } else if (!inside && owns) {
            // The user may have turned banners back on by hand meanwhile.
            if (!banners)
                this._notifications.set_boolean('show-banners', true);
            this._settings.set_boolean('focus-schedule-owns', false);
        }
    }
}
