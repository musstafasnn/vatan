import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

import * as Main from '../main.js';
import * as MessageTray from '../messageTray.js';
import * as PanelMenu from '../panelMenu.js';
import * as PopupMenu from '../popupMenu.js';
import * as Signals from '../../misc/signals.js';
import {formatCountdown, formatDuration} from '../../misc/vatanTimer.js';

const TICK_MS = 1000;
const MAX_TIMERS = 10;
// How long the island keeps showing a finished timer before it folds away.
const DONE_LINGER_SECONDS = 10;
const PULSE_MS = 220;
const PULSE_COUNT = 3;

// Timers live in memory only: a shell restart drops them, which is acceptable
// for kitchen-timer lengths and keeps the user's files out of it.
export class VatanTimers extends Signals.EventEmitter {
    constructor() {
        super();
        this._timers = [];
        this._lastId = 0;
        this._tickId = 0;
    }

    get timers() {
        return this._timers;
    }

    add(seconds, label) {
        if (this._timers.length >= MAX_TIMERS)
            this._timers.pop();

        const now = Date.now();
        this._timers.push({
            id: ++this._lastId,
            label,
            totalMs: seconds * 1000,
            endMs: now + seconds * 1000,
        });
        this._timers.sort((a, b) => a.endMs - b.endMs || a.id - b.id);

        if (!this._tickId) {
            this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => this._tick());
            GLib.Source.set_name_by_id(this._tickId, '[gnome-shell] VatanTimers.tick');
        }
        this.emit('changed');
    }

    cancel(id) {
        this._timers = this._timers.filter(t => t.id !== id);
        this.emit('changed');
    }

    remainingSeconds(timer) {
        return Math.max(0, Math.ceil((timer.endMs - Date.now()) / 1000));
    }

    // Wall-clock time on purpose: a reminder set for 18:30 must fire at
    // 18:30 even when the machine slept in between.
    _tick() {
        const now = Date.now();
        const finished = this._timers.filter(t => t.endMs <= now);
        if (finished.length) {
            this._timers = this._timers.filter(t => t.endMs > now);
            finished.forEach(t => this._notify(t));
            this.emit('finished', finished.at(-1));
            this.emit('changed');
        }

        this.emit('tick');
        if (this._timers.length)
            return GLib.SOURCE_CONTINUE;

        this._tickId = 0;
        return GLib.SOURCE_REMOVE;
    }

    _notify(timer) {
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title: _('Süre doldu'),
            body: timer.label || formatDuration(Math.round(timer.totalMs / 1000)),
            iconName: 'alarm-symbolic',
            urgency: MessageTray.Urgency.HIGH,
            sound: new MessageTray.Sound(null, 'complete'),
        });
        source.addNotification(notification);
    }
}

export const VatanTimerButton = GObject.registerClass(
class VatanTimerButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, _('Zamanlayıcılar'));

        this.add_style_class_name('vatan-timer');

        const box = new St.BoxLayout({style_class: 'vatan-timer-box'});
        box.add_child(new St.Icon({
            icon_name: 'alarm-symbolic',
            style_class: 'system-status-icon',
        }));
        this._countdown = new St.Label({
            style_class: 'vatan-timer-countdown',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._countdown);
        this._name = new St.Label({
            style_class: 'vatan-timer-name',
            y_align: Clutter.ActorAlign.CENTER,
        });
        box.add_child(this._name);

        // A bar under the pill drains with the nearest timer. St does not
        // tween width, so it is a full-width bar scaled in x.
        this._progress = new St.Widget({
            style_class: 'vatan-timer-progress',
            x_expand: true,
            pivot_point: new Graphene.Point({x: 0, y: 0.5}),
        });

        const column = new St.BoxLayout({
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        column.add_child(box);
        column.add_child(this._progress);
        this.add_child(column);

        this._doneId = 0;
        this._timers = Main.vatanTimers;
        this._timers.connectObject(
            'changed', () => this._rebuildMenu(),
            'tick', () => this._sync(),
            'finished', (_o, timer) => this._showDone(timer),
            this);

        this.connect('destroy', () => this._clearDone());
        this._rebuildMenu();
    }

    _sync() {
        const [next] = this._timers.timers;
        this.visible = !!next || !!this._doneId;
        if (!next || this._doneId)
            return;

        const remaining = this._timers.remainingSeconds(next);
        this._countdown.text = formatCountdown(remaining);
        this._name.text = next.label;
        this._name.visible = !!next.label;
        this._progress.scale_x = remaining * 1000 / next.totalMs;

        for (const [timer, item] of this._items)
            item.label.text = this._itemText(timer);
    }

    _itemText(timer) {
        const countdown = formatCountdown(this._timers.remainingSeconds(timer));
        return timer.label ? `${timer.label}  ${countdown}` : countdown;
    }

    _rebuildMenu() {
        this.menu.removeAll();
        this._items = new Map();

        for (const timer of this._timers.timers) {
            const item = new PopupMenu.PopupMenuItem(this._itemText(timer));
            item.add_child(new St.Icon({
                icon_name: 'window-close-symbolic',
                style_class: 'popup-menu-icon',
                x_expand: true,
                x_align: Clutter.ActorAlign.END,
            }));
            item.accessible_name = _('İptal et: %s').format(timer.label || this._itemText(timer));
            item.connect('activate', () => this._timers.cancel(timer.id));
            this.menu.addMenuItem(item);
            this._items.set(timer, item);
        }
        this._sync();
    }

    _showDone(timer) {
        this._clearDone();
        this.add_style_pseudo_class('done');
        this._countdown.text = _('Süre doldu');
        this._name.text = timer.label;
        this._name.visible = !!timer.label;
        this._progress.hide();
        this.visible = true;
        this._pulse(PULSE_COUNT * 2);

        this._doneId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, DONE_LINGER_SECONDS, () => {
            this._doneId = 0;
            this._clearDone();
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._doneId, '[gnome-shell] VatanTimerButton.done');
    }

    _pulse(remaining) {
        if (!remaining)
            return;
        this.ease({
            opacity: remaining % 2 ? 255 : 120,
            duration: PULSE_MS,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => this._pulse(remaining - 1),
        });
    }

    _clearDone() {
        if (this._doneId) {
            GLib.source_remove(this._doneId);
            this._doneId = 0;
        }
        this.remove_style_pseudo_class('done');
        this._progress.show();
        this.remove_all_transitions();
        this.opacity = 255;
    }

    // While the island shows a finished timer, a click dismisses it instead
    // of opening an empty menu.
    vfunc_event(event) {
        const release = event.type() === Clutter.EventType.BUTTON_RELEASE ||
            event.type() === Clutter.EventType.TOUCH_END;
        if (this._doneId && release && !this._timers.timers.length) {
            this._clearDone();
            this._sync();
            return Clutter.EVENT_STOP;
        }
        return super.vfunc_event(event);
    }
});
