import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from '../main.js';
import * as PanelMenu from '../panelMenu.js';

export const VatanWorkspaceButton = GObject.registerClass(
class VatanWorkspaceButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Çalışma alanları'), true);

        const box = new St.BoxLayout({style_class: 'vatan-workspace-box'});
        box.add_child(new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            style_class: 'system-status-icon',
        }));
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._label);
        this.add_child(box);

        global.workspace_manager.connectObject('active-workspace-changed',
            () => this._sync(), this);
        this.connect('clicked', () => Main.overview.toggle());

        this._sync();
    }

    _sync() {
        const index = global.workspace_manager.get_active_workspace_index();
        this._label.text = Meta.prefs_get_workspace_name(index) ||
            _('Alan %d').format(index + 1);
    }
});
