import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppFavorites from '../appFavorites.js';
import * as PanelMenu from '../panelMenu.js';

const MAX_DOCK_ITEMS = 8;
const DOCK_ICON_SIZE = 36;
const INDICATOR_EASE_MS = 300;
// Hover lifts the icon off the slab rather than scaling it: a scaled icon
// texture goes soft, a translated one stays pixel sharp.
const LIFT_PX = 5;
const LIFT_EASE_MS = 220;
const BOUNCE_PX = 14;
const BOUNCE_UP_MS = 180;
const BOUNCE_DOWN_MS = 520;
// St does not tween width, so the indicator is a fixed 14px bar scaled in x.
const INDICATOR_SCALE_RUNNING = 4 / 14;

export const VatanDock = GObject.registerClass(
class VatanDock extends PanelMenu.Button {
    _init() {
        super._init(0.0, _('Uygulamalar'), true);

        this.add_style_class_name('vatan-dock-host');

        this._box = new St.BoxLayout({style_class: 'vatan-dock'});
        this.add_child(this._box);

        this._items = new Map();
        const appSystem = Shell.AppSystem.get_default();
        this._tracker = Shell.WindowTracker.get_default();
        this._favorites = AppFavorites.getAppFavorites();

        this._favorites.connectObject('changed', () => this._sync(), this);
        appSystem.connectObject('app-state-changed', () => this._sync(), this);
        this._tracker.connectObject('notify::focus-app', () => this._sync(), this);

        this._sync();
    }

    _apps() {
        const favorites = this._favorites.getFavorites();
        const running = Shell.AppSystem.get_default().get_running()
            .filter(app => !favorites.includes(app));
        return [...favorites, ...running].slice(0, MAX_DOCK_ITEMS);
    }

    _sync() {
        const apps = this._apps();

        for (const [app, item] of this._items) {
            if (apps.includes(app))
                continue;
            item.destroy();
            this._items.delete(app);
        }

        apps.forEach((app, index) => {
            let item = this._items.get(app);
            if (!item) {
                item = this._createItem(app);
                this._items.set(app, item);
                this._box.add_child(item);
            }
            this._box.set_child_at_index(item, index);
            this._updateState(app, item);
        });
    }

    _createItem(app) {
        const indicator = new St.Widget({
            style_class: 'vatan-dock-indicator',
            x_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
            scale_x: 0,
        });

        const iconBin = new St.Bin({
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
            child: app.create_icon_texture(DOCK_ICON_SIZE),
        });
        const column = new St.BoxLayout({vertical: true});
        column.add_child(iconBin);
        column.add_child(indicator);

        const item = new St.Button({
            style_class: 'vatan-dock-item',
            accessible_name: app.get_name(),
            can_focus: true,
            child: column,
        });
        item._indicator = indicator;
        item._iconBin = iconBin;
        item.connect('notify::hover', () => this._lift(item));
        item.connect('clicked', () => this._activate(app, item));
        return item;
    }

    _lift(item) {
        if (item._bouncing)
            return;
        item._iconBin.ease({
            translation_y: item.hover ? -LIFT_PX : 0,
            duration: LIFT_EASE_MS,
            mode: item.hover
                ? Clutter.AnimationMode.EASE_OUT_BACK
                : Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _bounce(item) {
        item._bouncing = true;
        const bin = item._iconBin;
        bin.ease({
            translation_y: -BOUNCE_PX,
            duration: BOUNCE_UP_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => bin.ease({
                translation_y: item.hover ? -LIFT_PX : 0,
                duration: BOUNCE_DOWN_MS,
                mode: Clutter.AnimationMode.EASE_OUT_BOUNCE,
                onStopped: () => {
                    item._bouncing = false;
                },
            }),
        });
    }

    _updateState(app, item) {
        const running = app.state === Shell.AppState.RUNNING;
        const focused = this._tracker.focus_app === app;

        if (running)
            item.add_style_pseudo_class('running');
        else
            item.remove_style_pseudo_class('running');

        if (focused)
            item.add_style_pseudo_class('focused');
        else
            item.remove_style_pseudo_class('focused');

        let scale = 0;
        if (focused)
            scale = 1;
        else if (running)
            scale = INDICATOR_SCALE_RUNNING;

        item._indicator.ease({
            scale_x: scale,
            duration: INDICATOR_EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _activate(app, item) {
        if (app.state === Shell.AppState.STOPPED)
            this._bounce(item);

        const workspace = global.workspace_manager.get_active_workspace();
        const windows = app.get_windows()
            .filter(win => win.located_on_workspace(workspace));
        const focused = this._tracker.focus_app === app;

        if (!focused || windows.length === 0) {
            app.activate();
            return;
        }

        const focusWindow = global.display.focus_window;
        (windows.includes(focusWindow) ? focusWindow : windows[0]).minimize();
    }
});
