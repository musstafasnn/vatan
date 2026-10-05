import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from '../appFavorites.js';
import * as PanelMenu from '../panelMenu.js';

const MAX_DOCK_ITEMS = 8;
const DOCK_ICON_SIZE = 20;

export const VatanDock = GObject.registerClass(
class VatanDock extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Uygulamalar'), true);

        this.add_style_class_name('vatan-dock-host');

        this._box = new St.BoxLayout({style_class: 'vatan-dock'});
        this.add_child(this._box);

        const appSystem = Shell.AppSystem.get_default();
        this._tracker = Shell.WindowTracker.get_default();
        this._favorites = AppFavorites.getAppFavorites();

        this._favorites.connectObject('changed', () => this._rebuild(), this);
        appSystem.connectObject('app-state-changed', () => this._rebuild(), this);
        this._tracker.connectObject('notify::focus-app', () => this._rebuild(), this);

        this._rebuild();
    }

    _apps() {
        const favorites = this._favorites.getFavorites();
        const running = Shell.AppSystem.get_default().get_running()
            .filter(app => !favorites.includes(app));
        return [...favorites, ...running].slice(0, MAX_DOCK_ITEMS);
    }

    _rebuild() {
        this._box.destroy_all_children();
        for (const app of this._apps())
            this._box.add_child(this._createItem(app));
    }

    _createItem(app) {
        const column = new St.BoxLayout({vertical: true});
        column.add_child(new St.Bin({
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            child: app.create_icon_texture(DOCK_ICON_SIZE),
        }));
        column.add_child(new St.Widget({
            style_class: 'vatan-dock-indicator',
            x_align: Clutter.ActorAlign.CENTER,
        }));

        const item = new St.Button({
            style_class: 'vatan-dock-item',
            accessible_name: app.get_name(),
            child: column,
        });

        const focused = this._tracker.focus_app === app;
        if (app.state === Shell.AppState.RUNNING)
            item.add_style_pseudo_class('running');
        if (focused)
            item.add_style_pseudo_class('focused');

        item.connect('clicked', () => this._activate(app, focused));
        return item;
    }

    _activate(app, focused) {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = app.get_windows()
            .filter(win => win.located_on_workspace(workspace));

        if (!focused || windows.length === 0) {
            app.activate();
            return;
        }

        const focusWindow = global.display.focus_window;
        (windows.includes(focusWindow) ? focusWindow : windows[0]).minimize();
    }
});
