import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import Soup from 'gi://Soup';
import St from 'gi://St';

import * as Main from '../main.js';
import {getMixerControl} from '../status/volume.js';
import {loadInterfaceXML} from '../../misc/fileUtils.js';
import {parseLevelCommand} from '../../misc/turkishText.js';
import {formatDuration, parseTimerCommand, secondsUntil} from '../../misc/vatanTimer.js';
import {
    convertCurrency, convertUnits, formatAmount, isCurrency, parseConversion, parseTcmbRates, unitName,
} from '../../misc/vatanConvert.js';
import {rankActions} from '../../misc/vatanActions.js';
import {showTour} from './tour.js';

const BRIGHTNESS_BUS_NAME = 'org.gnome.SettingsDaemon.Power';
const BRIGHTNESS_OBJECT_PATH = '/org/gnome/SettingsDaemon/Power';
const MIN_BRIGHTNESS_PERCENT = 5;

const BrightnessProxy = Gio.DBusProxy.makeProxyWrapper(
    loadInterfaceXML('org.gnome.SettingsDaemon.Power.Screen'));

const LEVEL_PREFIX = 'level:';
const TIMER_PREFIX = 'timer:';
const CONVERT_PREFIX = 'convert:';

// TCMB publishes one bulletin per working day; an hour-old copy is current.
const RATES_URL = 'https://www.tcmb.gov.tr/kurlar/today.xml';
const RATES_TTL_MS = 60 * 60 * 1000;
const RATES_TIMEOUT_SECONDS = 10;

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

// Pardus's own tools under the words people use for the job, not the app names.
const PARDUS_TOOLS = [
    {id: 'tool-usb', appId: 'tr.org.pardus.usb-formatter.desktop',
        title: _('USB belleği biçimlendir'), keywords: 'usb biçimlendir format flash bellek sil'},
    {id: 'tool-iso', appId: 'tr.org.pardus.image-writer.desktop',
        title: _('Disk kalıbını USB\'ye yaz'), keywords: 'iso kalıp yaz önyüklenebilir usb imaj'},
    {id: 'tool-update', appId: 'tr.org.pardus.update.desktop',
        title: _('Sistemi güncelle'), keywords: 'güncelle güncelleme yükselt yama'},
    {id: 'tool-hardware', appId: 'tr.org.pardus.about-hardware.desktop',
        title: _('Donanım bilgisini göster'), keywords: 'donanım işlemci bellek ram ekran kartı'},
    {id: 'tool-install', appId: 'tr.org.pardus.software.desktop',
        title: _('Uygulama kur'), keywords: 'yazılım kur yükle indir mağaza program'},
    {id: 'tool-disks', appId: 'tr.org.pardus.mycomputer.desktop',
        title: _('Diskleri göster'), keywords: 'bilgisayarım disk sürücü bölüm'},
];

const PUBLIC_SERVICES = [
    {id: 'web-edevlet', uri: 'https://www.turkiye.gov.tr',
        title: _('e-Devlet Kapısı'), keywords: 'edevlet devlet türkiye.gov kimlik belge'},
    {id: 'web-mhrs', uri: 'https://www.mhrs.gov.tr',
        title: _('MHRS: hastane randevusu'), keywords: 'randevu hastane doktor hekim'},
    {id: 'web-enabiz', uri: 'https://enabiz.gov.tr',
        title: _('e-Nabız'), keywords: 'enabız sağlık tahlil reçete'},
    {id: 'web-eokul', uri: 'https://e-okul.meb.gov.tr',
        title: _('e-Okul'), keywords: 'eokul karne not meb öğrenci veli'},
    {id: 'web-eba', uri: 'https://www.eba.gov.tr',
        title: _('EBA'), keywords: 'eğitim ders meb'},
    {id: 'web-uyap', uri: 'https://vatandas.uyap.gov.tr',
        title: _('UYAP Vatandaş'), keywords: 'dava mahkeme adliye'},
    {id: 'web-gib', uri: 'https://ivd.gib.gov.tr',
        title: _('İnternet Vergi Dairesi'), keywords: 'gib vergi beyanname borç'},
];

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
        this._vatanSettings = new Gio.Settings({schema_id: 'org.vatan.shell'});
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
                id: 'news',
                title: this._vatanSettings.get_boolean('show-news')
                    ? _('Gündemi masaüstünden kaldır') : _('Gündemi masaüstünde göster'),
                keywords: 'haber gündem son dakika trt',
                icon: 'x-office-document-symbolic',
                run: () => this._toggleBoolean(this._vatanSettings, 'show-news'),
            },
            {
                id: 'tour',
                title: _('VATAN turunu göster'),
                keywords: 'tur tanıtım yardım nasıl kullanılır başlangıç',
                icon: 'help-about-symbolic',
                run: () => showTour(),
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
            ...PARDUS_TOOLS
                .map(tool => ({...tool, app: Shell.AppSystem.get_default().lookup_app(tool.appId)}))
                .filter(tool => tool.app)
                .map(tool => ({...tool, run: () => tool.app.activate()})),
            ...PUBLIC_SERVICES.map(service => ({
                ...service,
                icon: 'web-browser-symbolic',
                run: () => this._openUri(service.uri),
            })),
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

    async getInitialResultSet(terms, cancellable) {
        const ids = this._search(terms);
        const conversion = await this._convert(terms.join(' '), cancellable);
        if (conversion)
            ids.unshift(`${CONVERT_PREFIX}${JSON.stringify(conversion)}`);
        return ids;
    }

    getSubsearchResultSet(_previousResults, terms, cancellable) {
        return this.getInitialResultSet(terms, cancellable);
    }

    async _convert(query, cancellable) {
        const request = parseConversion(query);
        if (!request)
            return null;

        const {amount, from, to} = request;
        if (!isCurrency(from))
            return {amount, from, to, result: convertUnits(amount, from, to)};

        const bulletin = await this._rates(cancellable);
        const result = bulletin && convertCurrency(amount, from, to, bulletin.rates);
        return result === null || result === undefined
            ? null : {amount, from, to, result, date: bulletin.date};
    }

    // Concurrent queries share one request; a failed refresh keeps serving
    // the last bulletin rather than showing nothing.
    _rates(cancellable) {
        if (this._bulletin && Date.now() - this._bulletin.fetchedAt < RATES_TTL_MS)
            return Promise.resolve(this._bulletin);
        this._ratesRequest ??= this._fetchRates().finally(() => {
            this._ratesRequest = null;
        });
        return cancellable ? Promise.race([this._ratesRequest, this._whenCancelled(cancellable)]) : this._ratesRequest;
    }

    _whenCancelled(cancellable) {
        return new Promise(resolve => {
            if (cancellable.is_cancelled())
                resolve(null);
            else
                cancellable.connect(() => resolve(null));
        });
    }

    async _fetchRates() {
        this._session ??= new Soup.Session({timeout: RATES_TIMEOUT_SECONDS, user_agent: 'VATAN'});
        try {
            const message = Soup.Message.new('GET', RATES_URL);
            const bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null);
            if (message.get_status() !== Soup.Status.OK)
                throw new Error(`HTTP ${message.get_status()}`);
            const {date, rates} = parseTcmbRates(new TextDecoder().decode(bytes.get_data()));
            if (!rates.size)
                throw new Error('no rates in the bulletin');
            this._bulletin = {date, rates, fetchedAt: Date.now()};
        } catch (e) {
            console.warn(`VATAN rates: ${e.message}`);
        }
        return this._bulletin ?? null;
    }

    _openUri(uri) {
        try {
            Gio.AppInfo.launch_default_for_uri(uri, global.create_app_launch_context(0, -1));
        } catch (e) {
            console.warn(`VATAN: cannot open ${uri}: ${e.message}`);
        }
    }

    getResultMetas(ids) {
        const table = this._actionTable();
        const metas = [];
        for (const id of ids) {
            let name, iconName, description = '', createIcon = null;
            if (id.startsWith(CONVERT_PREFIX)) {
                const {amount, from, to, result, date} = JSON.parse(id.slice(CONVERT_PREFIX.length));
                const money = isCurrency(from);
                name = `${formatAmount(amount, money)} ${unitName(from)} = ${formatAmount(result, money)} ${unitName(to)}`;
                description = date ? _('TCMB döviz satış kuru, %s · Enter kopyalar').format(date) : _('Enter kopyalar');
                iconName = money ? 'money-symbolic' : 'accessories-calculator-symbolic';
            } else if (id.startsWith(TIMER_PREFIX)) {
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
                if (action.app)
                    createIcon = size => action.app.create_icon_texture(size);
            }
            metas.push({
                id,
                name,
                description,
                createIcon: createIcon ?? (size => new St.Icon({icon_name: iconName, icon_size: size})),
            });
        }
        return metas;
    }

    activateResult(id) {
        if (id.startsWith(CONVERT_PREFIX)) {
            const {result, from} = JSON.parse(id.slice(CONVERT_PREFIX.length));
            St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD,
                formatAmount(result, isCurrency(from)));
            return;
        }
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
