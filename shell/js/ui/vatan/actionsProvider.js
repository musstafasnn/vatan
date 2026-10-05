import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import St from 'gi://St';

import * as Main from '../main.js';
import {getMixerControl} from '../status/volume.js';
import {loadInterfaceXML} from '../../misc/fileUtils.js';
import {parseLevelCommand} from '../../misc/turkishText.js';
import {formatDuration, parseTimerCommand, secondsUntil} from '../../misc/vatanTimer.js';
import {rankActions} from '../../misc/vatanActions.js';

const BRIGHTNESS_BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const BRIGHTNESS_OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';
const MIN_BRIGHTNESS_PERCENT = 5;

const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(
    loadInterfaceXML('org.gnome.SettingsDaemon.Power.Screen'));

const LEVEL_PREFIX = 'level:';
const TIMER_PREFIX = 'timer:';

const ACCENTS = [
    {id: 'accent-red', value: 'red', title: _('Vurgu rengi: Kırmızı')},
    {id: 'accent-blue', value: 'blue', title: _('Vurgu rengi: Mavi')},
    {id: 'accent-green', value: 'green', title: _('Vurgu rengi: Yeşil')},
    {id: 'accent-yellow', value: 'yellow', title: _('Vurgu rengi: Sarı')},
];
const ACCENT_KEYWORDS = 'renk vurgu tema';

export class VatanActionsProvider {
    constructor() {
        this.id = 'vatan-actions';
        this.isRemoteProvider = false;
        this.canLaunchSearch = false;
        this.maxResults = 6;

        this._interfaceSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._notificationSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._colorSettings = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.color'});
        this._brightnessProxy = null;

        // Titles depend on current settings, so the table is rebuilt per query.
        this._actionTable = () => [
            {
                id: 'theme',
                title: this._interfaceSettings.get_string('color-scheme') === 'prefer-dark'
                    ? _('Aydınlık moda geç') : _('Karanlık moda geç'),
                keywords: 'tema karanlık aydınlık koyu açık gece gündüz',
                icon: 'weather-clear-night-symbolic',
                run: () => this._toggleTheme(),
            },
            {
                id: 'focus',
                title: this._notificationSettings.get_boolean('show-banners')
                    ? _('Odak modunu aç') : _('Odak modunu kapat'),
                keywords: 'bildirim sessiz rahatsız etme',
                icon: 'notifications-disabled-symbolic',
                run: () => this._toggleBoolean(this._notificationSettings, 'show-banners'),
            },
            {
                id: 'night',
                title: this._colorSettings.get_boolean('night-light-enabled')
                    ? _('Gece ışığını kapat') : _('Gece ışığını aç'),
                keywords: 'mavi ışık göz sıcak',
                icon: 'night-light-symbolic',
                run: () => this._toggleBoolean(this._colorSettings, 'night-light-enabled'),
            },
            {
                id: 'tile',
                title: _('Pencereleri yan yana diz'),
                keywords: 'böl yerleştir ikiye',
                icon: 'view-dual-symbolic',
                run: () => this._tileWindows(),
            },
            {
                id: 'lock',
                title: _('Ekranı kilitle'),
                keywords: 'kilit oturum',
                icon: 'system-lock-screen-symbolic',
                run: () => Main.screenShield.lock(true),
            },
            ...ACCENTS.map(({id, value, title}) => ({
                id,
                title,
                keywords: ACCENT_KEYWORDS,
                icon: 'preferences-color-symbolic',
                run: () => this._interfaceSettings.set_string('accent-color', value),
            })),
        ];
    }

    _search(terms) {
        const query = terms.join(' ');
        const ids = rankActions(this._actionTable(), query);
        const level = parseLevelCommand(query);
        if (level)
            ids.unshift(`${LEVEL_PREFIX}${level.target}:${level.percent}`);
        const timer = parseTimerCommand(query);
        if (timer)
            ids.unshift(`${TIMER_PREFIX}${JSON.stringify(timer)}`);
        return ids;
    }

    getInitialResultSet(terms) {
        return this._search(terms);
    }

    getSubsearchResultSet(_previousResults, terms) {
        return this._search(terms);
    }

    getResultMetas(ids) {
        const table = this._actionTable();
        const metas = [];
        for (const id of ids) {
            let name, iconName;
            if (id.startsWith(TIMER_PREFIX)) {
                const {seconds, label, at} = JSON.parse(id.slice(TIMER_PREFIX.length));
                const when = at ?? formatDuration(seconds);
                const what = label ? `${label} · ${when}` : when;
                name = at ? _('Hatırlatıcı kur: %s').format(what) : _('Zamanlayıcı kur: %s').format(what);
                iconName = 'alarm-symbolic';
            } else if (id.startsWith(LEVEL_PREFIX)) {
                const [target, percent] = id.slice(LEVEL_PREFIX.length).split(':');
                const label = `%${percent}`;
                if (target === 'brightness') {
                    name = _('Parlaklığı %s yap').format(label);
                    iconName = 'display-brightness-symbolic';
                } else {
                    name = _('Sesi %s yap').format(label);
                    iconName = 'audio-volume-high-symbolic';
                }
            } else {
                const action = table.find(a => a.id === id);
                if (!action)
                    continue;
                name = action.title;
                iconName = action.icon;
            }
            metas.push({
                id,
                name,
                description: '',
                createIcon: size => new St.Icon({icon_name: iconName, icon_size: size}),
            });
        }
        return metas;
    }

    activateResult(id) {
        if (id.startsWith(TIMER_PREFIX)) {
            this._startTimer(JSON.parse(id.slice(TIMER_PREFIX.length)));
            return;
        }
        if (id.startsWith(LEVEL_PREFIX)) {
            const [target, percent] = id.slice(LEVEL_PREFIX.length).split(':');
            this._setLevel(target, Number(percent));
            return;
        }
        this._actionTable().find(a => a.id === id)?.run();
    }

    // A clock-time reminder is measured again on activation: the result may
    // have sat in Komut for a while since it was parsed.
    _startTimer({seconds, label, at}) {
        if (at) {
            const [hours, minutes] = at.split(':').map(Number);
            seconds = secondsUntil(hours, minutes, new Date());
        }
        Main.vatanTimers.add(seconds, label);
    }

    filterResults(results, maxNumber) {
        return results.slice(0, maxNumber);
    }

    _toggleTheme() {
        const dark = this._interfaceSettings.get_string('color-scheme') === 'prefer-dark';
        this._interfaceSettings.set_string('color-scheme', dark ? 'default' : 'prefer-dark');
    }

    _toggleBoolean(settings, key) {
        settings.set_boolean(key, !settings.get_boolean(key));
    }

    _setLevel(target, percent) {
        if (target === 'brightness')
            this._setBrightness(percent);
        else
            this._setVolume(percent);
    }

    _setBrightness(percent) {
        if (!this._brightnessProxy) {
            this._brightnessProxy = new BrightnessProxy(Gio.DBus.session,
                BRIGHTNESS_BUS_NAME, BRIGHTNESS_OBJECT_PATH,
                (_proxy, error) => {
                    if (error)
                        console.error(error.message);
                });
        }
        this._brightnessProxy.Brightness = Math.max(percent, MIN_BRIGHTNESS_PERCENT);
    }

    _setVolume(percent) {
        const control = getMixerControl();
        const sink = control.get_default_sink();
        if (!sink)
            return;
        // Like the volume slider: asking for a level means wanting to hear it.
        if (percent > 0 && sink.is_muted)
            sink.change_is_muted(false);
        sink.volume = percent / 100 * control.get_vol_max_norm();
        sink.push_volume();
    }

    // Meta.Window.tile() is not public API in Mutter 48, so place the two
    // halves by hand.
    _tileWindows() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = global.display.get_tab_list(Meta.TabList.NORMAL, workspace).slice(0, 2);

        windows.forEach((win, index) => {
            const area = Main.layoutManager.getWorkAreaForMonitor(win.get_monitor());
            const half = Math.floor(area.width / 2);
            const width = index === 0 ? half : area.width - half;
            if (win.get_maximized())
                win.unmaximize(Meta.MaximizeFlags.BOTH);
            win.move_resize_frame(true, area.x + index * half, area.y, width, area.height);
        });
    }
}
