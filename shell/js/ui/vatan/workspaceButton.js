import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from '../main.js';
import * as PanelMenu from '../panelMenu.js';

export const VatanWorkspaceButton = GObject.registerClass(
class VatanWorkspaceButton extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Çalışma alanları'), true);

        this.accessible_role = Atk.Role.PUSH_BUTTON;

        const box = new St.BoxLayout({style_class: 'vatan-workspace-box'});
        box.add_child(new St.Icon({
            icon_name: 'focus-windows-symbolic',
            style_class: 'system-status-icon',
        }));
        this._label = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        box.add_child(this._label);
        this.add_child(box);

        this._settings = new Gio.Settings({schema_id: 'org.gnome.desktop.wm.preferences'});
        this._settings.connectObject('changed::workspace-names', () => this._sync(), this);
        global.workspace_manager.connectObject(
            'active-workspace-changed', () => this._sync(),
            'workspace-added', () => this._sync(),
            'workspace-removed', () => this._sync(),
            this);

        this._sync();
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
        Main.overview.toggle();
    }

    _sync() {
        const index = global.workspace_manager.get_active_workspace_index();
        // Meta.prefs_get_workspace_name invents "Workspace N" for unnamed
        // workspaces, so the Turkish fallback needs the raw setting.
        const names = this._settings.get_strv('workspace-names');
        this._label.text = names[index] || _('Alan %d').format(index + 1);
    }
});
