import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from '../main.js';
import * as PanelMenu from '../panelMenu.js';

export const VatanKomutButton = GObject.registerClass(
class VatanKomutButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Komut'), true);

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

        this.connect('clicked', () => {
            // Task 9 provides vatanKomut; the overview search stands in until then.
            if (Main.vatanKomut)
                Main.vatanKomut.toggle();
            else
                Main.overview.toggle();
        });
    }
});
