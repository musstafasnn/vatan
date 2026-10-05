import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Main from '../main.js';
import {parseRssItems, relativeTime} from '../../misc/vatanFeed.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

const MAX_ITEMS = 5;
const REFRESH_SECONDS = 15 * 60;
const REQUEST_TIMEOUT_SECONDS = 15;
// Bir feed birkaç düzine kilobayttır; çok daha büyük olan bir feed değildir.
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const SCREEN_MARGIN = 32;

// Kart arka plan grubunda durur: duvar kâğıdının üstünde, her pencerenin altında;
// böylece yüzen bir panel gibi değil masaüstünün parçası gibi davranır.
export const VatanNewsWidget = GObject.registerClass(
class VatanNewsWidget extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'vatan-news',
            vertical: true,
            reactive: true,
            visible: false,
        });

        const header = new St.BoxLayout({style_class: 'vatan-news-header'});
        header.add_child(new St.Label({text: _('Gündem'), style_class: 'vatan-news-title'}));
        this._source = new St.Label({
            style_class: 'vatan-news-source',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });
        header.add_child(this._source);
        this.add_child(header);

        this._list = new St.BoxLayout({vertical: true, style_class: 'vatan-news-list'});
        this.add_child(this._list);

        this._items = [];
        this._refreshId = 0;
        this._cancellable = null;
        this._session = new Soup.Session({
            timeout: REQUEST_TIMEOUT_SECONDS,
            user_agent: 'VATAN',
        });

        this._settings = new Gio.Settings({schema_id: 'org.vatan.shell'});
        this._settings.connectObject(
            'changed::show-news', () => this._syncEnabled(),
            'changed::news-feed', () => this._refresh(),
            'changed::news-source', () => this._render(),
            this);

        Main.layoutManager._backgroundGroup.add_child(this);
        Main.layoutManager.connectObject('monitors-changed', () => this._place(), this);
        this.connect('notify::width', () => this._place());
        this.connect('destroy', () => this._stop());

        this._syncEnabled();
    }

    _syncEnabled() {
        if (this._settings.get_boolean('show-news')) {
            this._refresh();
        } else {
            this._stop();
            this.hide();
        }
    }

    _stop() {
        this._cancellable?.cancel();
        this._cancellable = null;
        if (this._refreshId) {
            GLib.source_remove(this._refreshId);
            this._refreshId = 0;
        }
    }

    _scheduleRefresh() {
        if (this._refreshId)
            GLib.source_remove(this._refreshId);
        this._refreshId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this._refreshId = 0;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(this._refreshId, '[gnome-shell] VatanNewsWidget.refresh');
    }

    async _refresh() {
        this._stop();
        if (!this._settings.get_boolean('show-news'))
            return;

        const url = this._settings.get_string('news-feed');
        if (!/^https:\/\/[^\s]+$/.test(url)) {
            console.warn(`VATAN news: ignoring non-https feed ${JSON.stringify(url)}`);
            this._items = [];
            this._render();
            return;
        }

        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;
        this._scheduleRefresh();
        try {
            const message = Soup.Message.new('GET', url);
            const bytes = await this._session.send_and_read_async(
                message, GLib.PRIORITY_LOW, cancellable);
            if (message.get_status() !== Soup.Status.OK)
                throw new Error(`HTTP ${message.get_status()}`);
            if (bytes.get_size() > MAX_FEED_BYTES)
                throw new Error(`feed is ${bytes.get_size()} bytes`);
            this._items = parseRssItems(new TextDecoder().decode(bytes.get_data()), MAX_ITEMS);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
            // Son manşetleri göstermeye devam et; sonraki yenileme yeniden dener.
            console.warn(`VATAN news: ${url}: ${e.message}`);
        }
        if (this._cancellable === cancellable)
            this._cancellable = null;
        this._render();
    }

    _render() {
        if (!this._settings.get_boolean('show-news'))
            return;
        this._list.destroy_all_children();
        this._source.text = this._settings.get_string('news-source');

        const now = new Date();
        for (const item of this._items)
            this._list.add_child(this._createRow(item, now));

        if (!this._items.length) {
            this._list.add_child(new St.Label({
                text: _('Haberler şu an alınamıyor.'),
                style_class: 'vatan-news-empty',
            }));
        }
        this.show();
        this._place();
    }

    _createRow(item, now) {
        const title = new St.Label({text: item.title, style_class: 'vatan-news-headline'});
        title.clutter_text.line_wrap = true;
        title.clutter_text.ellipsize = Pango.EllipsizeMode.END;

        const column = new St.BoxLayout({vertical: true});
        column.add_child(title);
        const when = relativeTime(item.date, now);
        if (when)
            column.add_child(new St.Label({text: when, style_class: 'vatan-news-time'}));

        const row = new St.Button({
            style_class: 'vatan-news-row',
            child: column,
            x_expand: true,
            can_focus: true,
            accessible_name: item.title,
        });
        row.connect('clicked', () => {
            try {
                Gio.AppInfo.launch_default_for_uri(item.link,
                    global.create_app_launch_context(0, -1));
            } catch (e) {
                console.warn(`VATAN news: cannot open ${item.link}: ${e.message}`);
            }
        });
        return row;
    }

    _place() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        // Arka plan yöneticileri monitör değişikliklerinde actor'larını yeniden ekler;
        // onların üstünde kal.
        this.get_parent()?.set_child_above_sibling(this, null);
        this.set_position(
            monitor.x + monitor.width - this.width - SCREEN_MARGIN,
            monitor.y + SCREEN_MARGIN);
    }
});
