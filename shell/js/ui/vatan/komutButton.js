import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from '../main.js';
import * as PanelMenu from '../panelMenu.js';

export const VatanKomutButton = GObject.registerClass(
class VatanKomutButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Komut'), true);

        this.accessible_role = Atk.Role.PUSH_BUTTON;

        this.add_style_class_name('vatan-komut-button');

        const box = new St.BoxLayout({style_class: 'vatan-komut-box'});
        box.add_child(new St.Icon({
            icon_name: 'edit-find-symbolic',
            style_class: 'system-status-icon',
        }));
        box.add_child(new St.Label({
            text: _('Ara ya da komut yaz'),
            style_class: 'vatan-komut-label',
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        }));
        box.add_child(new St.Label({
            text: 'Super',
            style_class: 'vatan-komut-hint',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this.add_child(box);
    }

    vfunc_event(event) {
        if (event.type() === Clutter.EventType.TOUCH_END ||
            event.type() === Clutter.EventType.BUTTON_RELEASE)
            this._activate();

        return Clutter.EVENT_PROPAGATE;
    }

    vfunc_key_release_event(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter ||
            symbol === Clutter.KEY_space) {
            this._activate();
            return Clutter.EVENT_STOP;
        }

        return Clutter.EVENT_PROPAGATE;
    }

    _activate() {
        // Komut exists only in session modes with an overview; elsewhere the
        // button falls back to the overview itself.
        if (Main.vatanKomut)
            Main.vatanKomut.toggle();
        else
            Main.overview.toggle();
    }
});
