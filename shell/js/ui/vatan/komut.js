import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as AppDisplay from '../appDisplay.js';
import * as Main from '../main.js';
import * as RemoteSearch from '../remoteSearch.js';
import * as SystemActions from '../../misc/systemActions.js';
import {ensureActorVisibleInScrollView} from '../../misc/animationUtils.js';
import {VatanActionsProvider} from './actionsProvider.js';

const SEARCH_PROVIDERS_SCHEMA = 'org.gnome.desktop.search-providers';

const MAX_WIDTH = 620;
const SCREEN_MARGIN = 12;
const MORPH_TIME = 460;
const RESIZE_TIME = 200;
const PANEL_FADE_TIME = 150;
const SEARCH_DEBOUNCE_MS = 120;
const ICON_SIZE = 16;
const ENTRY_ICON_SIZE = 18;

const MAX_ACTION_RESULTS = 5;
const MAX_APP_RESULTS = 3;
const MAX_REMOTE_RESULTS = 2;

const SUGGESTED_ACTIONS = ['tile', 'theme', 'focus', 'lock'];
const SUGGESTED_APP = 'tr.org.pardus.software.desktop';

function termsFor(text) {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/) : [];
}

const KomutRow = GObject.registerClass({
    Signals: {'activate-row': {}},
}, class KomutRow extends St.Button {
    _init(meta, kind, result) {
        super._init({
            style_class: 'vatan-komut-row',
            reactive: true,
            can_focus: false,
            track_hover: true,
            x_expand: true,
        });

        const box = new St.BoxLayout({x_expand: true});
        this.set_child(box);

        const iconBin = new St.Bin({
            style_class: 'vatan-komut-row-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Remote providers may return metas without an icon; fall back to
        // the provider's own app icon so every row keeps its tile.
        const icon = meta.createIcon(ICON_SIZE) ?? new St.Icon({
            gicon: result.provider.appInfo?.get_icon() ?? null,
            fallback_icon_name: 'system-search-symbolic',
            icon_size: ICON_SIZE,
        });
        iconBin.set_child(icon);
        box.add_child(iconBin);

        const text = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
        });
        text.add_child(new St.Label({style_class: 'vatan-komut-row-title', text: meta.name}));
        if (meta.description) {
            text.add_child(new St.Label({
                style_class: 'vatan-komut-row-description',
                text: meta.description,
            }));
        }
        box.add_child(text);

        box.add_child(new St.Label({
            style_class: 'vatan-komut-row-kind',
            text: kind,
            y_align: Clutter.ActorAlign.CENTER,
        }));

        this.result = result;
        this.connect('clicked', () => this.emit('activate-row'));
    }

    set selected(selected) {
        if (selected)
            this.add_style_pseudo_class('selected');
        else
            this.remove_style_pseudo_class('selected');
    }
});

export const Komut = GObject.registerClass(
class Komut extends St.Widget {
    _init() {
        super._init({
            style_class: 'vatan-komut',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.BinLayout(),
        });

        this._grab = null;
        this._rows = [];
        this._selected = -1;
        this._searchId = 0;
        this._cancellable = new Gio.Cancellable();

        this._appProvider = new AppDisplay.AppSearchProvider();
        this._actionsProvider = new VatanActionsProvider();
        this._systemActions = SystemActions.getDefault();
        this._searchSettings = new Gio.Settings({schema_id: SEARCH_PROVIDERS_SCHEMA});
        this._remoteProviders = [];
        this._reloadRemoteProviders();
        this._searchSettings.connectObject('changed',
            () => this._reloadRemoteProviders(), this);
        Shell.AppSystem.get_default().connectObject('installed-changed',
            () => this._reloadRemoteProviders(), this);

        // Clip the content, not the widget, so the island's shadow survives
        // while the content is cut during the morph.
        this._content = new St.BoxLayout({
            style_class: 'vatan-komut-content',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_align: Clutter.ActorAlign.START,
            clip_to_allocation: true,
        });
        this.add_child(this._content);

        this._entry = new St.Entry({
            style_class: 'vatan-komut-entry',
            hint_text: _('Uygulama, dosya, ayar ya da “ses 30”'),
            primary_icon: new St.Icon({
                icon_name: 'edit-find-symbolic',
                icon_size: ENTRY_ICON_SIZE,
            }),
            can_focus: true,
            x_expand: true,
        });
        this._entry.clutter_text.connectObject(
            'text-changed', () => this._queueSearch(),
            'key-press-event', (_actor, event) => this._onKeyPress(event),
            this);
        this._content.add_child(this._entry);

        this._header = new St.Label({style_class: 'vatan-komut-header'});
        this._content.add_child(this._header);

        this._list = new St.BoxLayout({
            style_class: 'vatan-komut-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        this._scroll = new St.ScrollView({
            style_class: 'vatan-komut-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._list,
        });
        this._content.add_child(this._scroll);

        this._content.add_child(new St.Label({
            style_class: 'vatan-komut-footer',
            text: _('↑↓ seç · Enter çalıştır · Esc kapat'),
        }));

        this.connect('button-press-event', (_actor, event) => this._onOutsideClick(event));
        this.connect('touch-event', (_actor, event) => this._onOutsideClick(event));

        Main.layoutManager.addTopChrome(this);

        Main.sessionMode.connectObject('updated', () => {
            if (!Main.sessionMode.hasOverview)
                this.close();
        }, this);
    }

    get isOpen() {
        return this._grab !== null;
    }

    toggle() {
        if (this.isOpen)
            this.close();
        else
            this.open();
    }

    open() {
        if (this.isOpen || !Main.sessionMode.hasOverview)
            return;

        const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.POPUP});
        if (grab.get_seat_state() !== Clutter.GrabState.ALL) {
            Main.popModal(grab);
            return;
        }
        this._grab = grab;
        this.reactive = true;

        // Clearing the entry queues a debounced search; drop it so the
        // suggestions are built once.
        this._entry.text = '';
        this._cancelSearch();
        this._showSuggestions().catch(e => logError(e, 'Komut suggestions failed'));

        // The island morph: start exactly over the panel, then grow to the
        // command bar's size while the panel content fades out underneath.
        const [panelX, panelY] = Main.panel.get_transformed_position();
        this.set_position(panelX, panelY);
        this.set_size(Main.panel.width, Main.panel.height);
        this._content.opacity = 0;
        this.show();

        Main.panel.ease({
            opacity: 0,
            duration: PANEL_FADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this._morphTo(this._targetGeometry(), MORPH_TIME);
        this._content.ease({
            opacity: 255,
            delay: 100,
            duration: MORPH_TIME - 100,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });

        this._entry.grab_key_focus();
    }

    close() {
        if (!this.isOpen)
            return;

        this._cancelSearch();
        Main.popModal(this._grab);
        this._grab = null;
        this.reactive = false;

        const [panelX, panelY] = Main.panel.get_transformed_position();
        this._content.ease({
            opacity: 0,
            duration: PANEL_FADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
        this.ease({
            x: panelX,
            y: panelY,
            width: Main.panel.width,
            height: Main.panel.height,
            duration: MORPH_TIME * 0.6,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
            onComplete: () => {
                this.hide();
                this._clearRows();
            },
        });
        Main.panel.ease({
            opacity: 255,
            delay: MORPH_TIME * 0.3,
            duration: PANEL_FADE_TIME,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _targetGeometry() {
        const monitor = Main.layoutManager.primaryMonitor;
        const width = Math.min(MAX_WIDTH, monitor.width - 2 * SCREEN_MARGIN);
        const themeNode = this.get_theme_node();
        const [, contentHeight] = this._content.get_preferred_height(
            themeNode.adjust_for_width(width));
        const [, height] = themeNode.adjust_preferred_height(contentHeight, contentHeight);

        // Bottom edge stays where the panel's bottom edge is.
        const [, panelY] = Main.panel.get_transformed_position();
        const bottom = panelY + Main.panel.height;
        return {
            x: monitor.x + Math.round((monitor.width - width) / 2),
            y: Math.round(bottom - height),
            width,
            height,
        };
    }

    _morphTo(geometry, duration) {
        this.ease({
            ...geometry,
            duration,
            mode: Clutter.AnimationMode.EASE_OUT_QUINT,
        });
    }

    _relayout() {
        if (!this.isOpen)
            return;

        // Results usually land while the opening morph is still running;
        // keep its remaining time instead of cutting it short.
        const transition = this.get_transition('height');
        const remaining = transition
            ? transition.get_duration() - transition.get_elapsed_time()
            : 0;
        this._morphTo(this._targetGeometry(), Math.max(RESIZE_TIME, remaining));
    }

    _onOutsideClick(event) {
        const type = event.type();
        if (type !== Clutter.EventType.BUTTON_PRESS && type !== Clutter.EventType.TOUCH_BEGIN)
            return Clutter.EVENT_PROPAGATE;

        const [x, y] = event.get_coords();
        const [ax, ay] = this.get_transformed_position();
        const [width, height] = this.get_transformed_size();
        const inside = x >= ax && x < ax + width && y >= ay && y < ay + height;
        if (inside)
            return Clutter.EVENT_PROPAGATE;

        this.close();
        return Clutter.EVENT_STOP;
    }

    _onKeyPress(event) {
        const symbol = event.get_key_symbol();
        switch (symbol) {
        case Clutter.KEY_Escape:
            this.close();
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Down:
            this._select(this._selected + 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Up:
            this._select(this._selected - 1);
            return Clutter.EVENT_STOP;
        case Clutter.KEY_Return:
        case Clutter.KEY_KP_Enter:
        case Clutter.KEY_ISO_Enter:
            this._activate(this._selected);
            return Clutter.EVENT_STOP;
        default:
            return Clutter.EVENT_PROPAGATE;
        }
    }

    _reloadRemoteProviders() {
        this._remoteProviders = RemoteSearch.loadRemoteSearchProviders(this._searchSettings);
    }

    _cancelSearch() {
        if (this._searchId) {
            GLib.source_remove(this._searchId);
            this._searchId = 0;
        }
        this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
    }

    _queueSearch() {
        this._cancelSearch();
        this._searchId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SEARCH_DEBOUNCE_MS, () => {
            this._searchId = 0;
            this._search(this._entry.text).catch(e => logError(e, 'Komut search failed'));
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._searchId, '[gnome-shell] Komut search');
    }

    _sections() {
        return [
            {provider: this._actionsProvider, max: MAX_ACTION_RESULTS, kind: _('Eylem')},
            {provider: this._appProvider, max: MAX_APP_RESULTS, kind: _('Uygulama')},
            ...this._remoteProviders.map(provider => ({
                provider,
                max: MAX_REMOTE_RESULTS,
                kind: provider.appInfo.get_name(),
            })),
        ];
    }

    async _search(text) {
        const terms = termsFor(text);
        if (terms.length === 0) {
            await this._showSuggestions();
            return;
        }

        // Each provider is shown as soon as it answers, in section order. A
        // remote provider can sit on D-Bus activation for many seconds, so
        // waiting for all of them would leave the list frozen.
        const cancellable = this._cancellable;
        const sections = this._sections();
        const answered = new Array(sections.length).fill(null);
        let pending = sections.length;
        const settle = entries => {
            pending--;
            if (cancellable.is_cancelled() || !this.isOpen)
                return;
            if (entries === null && pending > 0)
                return;
            this._setRows(answered.flatMap(rows => rows ?? []), terms, '', pending === 0);
        };
        sections.forEach((section, index) => {
            this._querySection(section, terms, cancellable).then(entries => {
                answered[index] = entries;
                settle(entries);
            }).catch(e => {
                if (!cancellable.is_cancelled())
                    logError(e, 'Komut search provider failed');
                settle(null);
            });
        });
    }

    async _querySection(section, terms, cancellable) {
        const ids = await section.provider.getInitialResultSet(terms, cancellable);
        const top = section.provider.filterResults(ids, section.max);
        if (top.length === 0)
            return [];
        const metas = await section.provider.getResultMetas(top, cancellable);
        return metas.map(meta => ({meta, section}));
    }

    async _showSuggestions() {
        const cancellable = this._cancellable;
        const actionMetas = await this._actionsProvider.getResultMetas(SUGGESTED_ACTIONS, cancellable);
        const appSection = {provider: this._appProvider, kind: _('Uygulama')};
        const actionSection = {provider: this._actionsProvider, kind: _('Eylem')};

        const entries = actionMetas.map(meta => ({meta, section: actionSection}));
        if (Shell.AppSystem.get_default().lookup_app(SUGGESTED_APP)) {
            const [appMeta] = await this._appProvider.getResultMetas([SUGGESTED_APP], cancellable);
            entries.splice(2, 0, {meta: appMeta, section: appSection});
        }
        if (cancellable.is_cancelled() || !this.isOpen)
            return;
        this._setRows(entries, [], _('Öneriler'), true);
    }

    _clearRows() {
        this._list.destroy_all_children();
        this._rows = [];
        this._selected = -1;
    }

    _setRows(entries, terms, header, complete) {
        // Results arrive provider by provider; keep the row the user is on
        // so a late answer cannot move a different item under Enter.
        const previous = this._rows[this._selected]?.result;
        this._list.destroy_all_children();
        this._header.text = header;
        this._header.visible = header !== '';

        this._rows = entries.map(({meta, section}) => {
            const row = new KomutRow(meta, section.kind,
                {id: meta.id, provider: section.provider, terms});
            row.connect('notify::hover', () => {
                if (row.hover)
                    this._select(this._rows.indexOf(row));
            });
            row.connect('activate-row', () => this._activate(this._rows.indexOf(row)));
            this._list.add_child(row);
            return row;
        });

        // The empty state waits for the slowest provider, otherwise it
        // flashes while remote providers are still answering.
        if (this._rows.length === 0 && terms.length > 0 && complete) {
            this._list.add_child(new St.Label({
                style_class: 'vatan-komut-empty',
                text: _('Sonuç yok. Bir uygulama adı, dosya ya da “ses 30” dene.'),
            }));
        }

        const kept = previous
            ? this._rows.findIndex(row =>
                row.result.id === previous.id && row.result.provider === previous.provider)
            : -1;
        this._selected = -1;
        this._select(Math.max(kept, 0));
        this._relayout();
    }

    _select(index) {
        if (this._rows.length === 0) {
            this._selected = -1;
            return;
        }
        const previous = this._rows[this._selected];
        if (previous)
            previous.selected = false;
        this._selected = (index + this._rows.length) % this._rows.length;
        const row = this._rows[this._selected];
        row.selected = true;
        ensureActorVisibleInScrollView(this._scroll, row);
    }

    _activate(index) {
        const row = this._rows[index];
        if (!row)
            return;

        const {id, provider, terms} = row.result;
        // Close first so the launched window, not the modal, receives focus.
        this.close();

        if (provider === this._appProvider) {
            const app = Shell.AppSystem.get_default().lookup_app(id);
            if (app)
                app.activate();
            else
                this._systemActions.activateAction(id);
            return;
        }
        provider.activateResult(id, terms);
    }
});
