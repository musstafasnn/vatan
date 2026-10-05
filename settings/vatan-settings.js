import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

const APP_ID = 'org.vatan.Settings';
const VERSION_FILE = '/usr/share/vatan/version';
const VATAN_ICON_THEME = 'VATAN';
const PARDUS_ICON_THEME = 'pardus-gnome';

const FEEDS = [
    {label: 'TRT Haber · Son Dakika', source: 'TRT Haber', url: 'https://www.trthaber.com/sondakika.rss'},
    {label: 'TRT Haber · Manşet', source: 'TRT Haber', url: 'https://www.trthaber.com/manset_articles.rss'},
];
const CUSTOM_FEED_LABEL = 'Başka bir adres';

// Sayfa girişi: her tercih grubu sırayla biraz yukarı kayarak belirir, böylece
// sayfa değiştirilmiş gibi değil, gelmiş gibi okunur.
const ENTRANCE_MS = 320;
const ENTRANCE_STAGGER_MS = 50;
const ENTRANCE_RISE_PX = 14;
const STACK_FADE_MS = 200;

const PACES = [
    {name: 'live', label: 'Canlı', factor: 1.0},
    {name: 'balanced', label: 'Dengeli', factor: 1.3},
    {name: 'calm', label: 'Sakin', factor: 1.7},
];

// GNOME'un vurgu renk adları; örnek kutuları kabuğun ve uygulamaların
// kullandığı renkleri gösterir.
const ACCENTS = [
    ['red', 'Kırmızı', '#e62d42'], ['blue', 'Mavi', '#3584e4'], ['teal', 'Turkuaz', '#2190a4'],
    ['green', 'Yeşil', '#3a944a'], ['yellow', 'Sarı', '#c88800'], ['orange', 'Turuncu', '#ed5b00'],
    ['pink', 'Pembe', '#d56199'], ['purple', 'Mor', '#9141ac'], ['slate', 'Arduvaz', '#6f8396'],
];

const KOMUT_EXAMPLES = [
    ['çay 3 dk', 'Adada geri sayan bir zamanlayıcı kurar'],
    ['18:30 toplantı', 'O saatte hatırlatır'],
    ['100 dolar', 'TCMB kuruyla liraya çevirir'],
    ['5 km kaç mil', 'Birim çevirir'],
    ['parlaklık 40', 'Ekran parlaklığını ayarlar'],
    ['e-devlet', 'e-Devlet Kapısı\'nı açar'],
    ['biçimlendir', 'Pardus USB Biçimlendirici\'yi açar'],
];

const CSS = `
.vatan-swatch {
  min-width: 26px; min-height: 26px; padding: 0; border-radius: 999px;
  transition: transform 180ms cubic-bezier(.2, .9, .3, 1.3), outline-color 180ms ease-out;
  outline: 2px solid transparent; outline-offset: 2px;
}
.vatan-swatch:hover { transform: scale(1.12); }
.vatan-swatch:checked { outline-color: @window_fg_color; }
.navigation-sidebar row { transition: background-color 160ms ease-out; }
row.activatable { transition: background-color 160ms ease-out; }
${ACCENTS.map(([name, , hex]) => `.vatan-swatch-${name} { background: ${hex}; }`).join('\n')}
.vatan-sidebar-title { font-weight: 600; }
`;

function isHttpsUrl(text) {
    return /^https:\/\/[^\s]+$/.test(text);
}

function isClock(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text);
    return !!match && Number(match[1]) < 24 && Number(match[2]) < 60;
}

function readVersion() {
    try {
        const [, bytes] = GLib.file_get_contents(VERSION_FILE);
        return new TextDecoder().decode(bytes).trim();
    } catch (e) {
        console.warn(`${VERSION_FILE}: ${e.message}`);
        return '';
    }
}

function launchDesktopApp(id) {
    const app = Gio.DesktopAppInfo.new(id);
    if (!app) {
        console.warn(`${id} is not installed`);
        return;
    }
    app.launch([], null);
}

const VatanSettingsWindow = GObject.registerClass(
class VatanSettingsWindow extends Adw.ApplicationWindow {
    _init(application) {
        super._init({application, title: 'VATAN Ayarları', default_width: 920, default_height: 660});

        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._vatan = new Gio.Settings({schema_id: 'org.vatan.shell'});

        this._toasts = new Adw.ToastOverlay();
        const stack = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
        // Uygulama kabuğun temposuna uyar, böylece sayfaları masaüstü gibi hareket eder.
        const syncPace = () => {
            stack.transition_duration = Math.round(STACK_FADE_MS * this._pace());
        };
        syncPace();
        this._vatan.connect('changed::animation-pace', syncPace);
        const pages = [
            ['gorunum', 'Görünüm', 'applications-graphics-symbolic', this._appearancePage()],
            ['gundem', 'Gündem', 'x-office-document-symbolic', this._newsPage()],
            ['komut', 'Komut', 'system-search-symbolic', this._komutPage()],
            ['odak', 'Odak', 'notifications-disabled-symbolic', this._focusPage()],
            ['hakkinda', 'Hakkında', 'help-about-symbolic', this._aboutPage()],
        ];
        pages.forEach(([name, title, , page]) => stack.add_titled(page, name, title));

        const contentPage = new Adw.NavigationPage({title: pages[0][1]});
        const contentView = new Adw.ToolbarView({content: stack});
        contentView.add_top_bar(new Adw.HeaderBar());
        contentPage.child = contentView;

        const sidebarList = new Gtk.ListBox({css_classes: ['navigation-sidebar']});
        for (const [, title, icon] of pages) {
            const box = new Gtk.Box({spacing: 12, margin_top: 6, margin_bottom: 6, margin_start: 6});
            box.append(new Gtk.Image({icon_name: icon}));
            box.append(new Gtk.Label({label: title, xalign: 0}));
            sidebarList.append(box);
        }

        const split = new Adw.NavigationSplitView({
            sidebar: this._sidebar(sidebarList),
            content: contentPage,
        });
        sidebarList.connect('row-activated', (_list, row) => {
            const [name, title, , page] = pages[row.get_index()];
            if (stack.visible_child_name !== name) {
                stack.visible_child_name = name;
                this._playEntrance(page);
            }
            contentPage.title = title;
            split.show_content = true;
        });
        sidebarList.select_row(sidebarList.get_row_at_index(0));

        this._toasts.child = split;
        this.content = this._toasts;

        const breakpoint = new Adw.Breakpoint({condition: Adw.BreakpointCondition.parse('max-width: 600sp')});
        breakpoint.add_setter(split, 'collapsed', true);
        this.add_breakpoint(breakpoint);

        this._playEntrance(pages[0][3]);
    }

    _sidebar(list) {
        const header = new Adw.HeaderBar({
            title_widget: new Gtk.Label({label: 'VATAN', css_classes: ['vatan-sidebar-title']}),
        });
        const view = new Adw.ToolbarView({content: new Gtk.ScrolledWindow({child: list})});
        view.add_top_bar(header);
        return new Adw.NavigationPage({title: 'VATAN', child: view});
    }

    _pace() {
        return this._vatan.get_double('animation-pace');
    }

    _playEntrance(page) {
        let child = page.get_first_child();
        const groups = [];
        // PreferencesPage gruplarını kaydırmalı bir pencere ve bir box içine yerleştirir.
        while (child && !(child instanceof Adw.PreferencesGroup)) {
            const next = child.get_first_child();
            if (!next)
                break;
            child = next;
        }
        for (let group = child; group; group = group.get_next_sibling()) {
            if (group instanceof Adw.PreferencesGroup)
                groups.push(group);
        }

        groups.forEach((group, index) => {
            group.opacity = 0;
            group.margin_top = ENTRANCE_RISE_PX;
            const animation = new Adw.TimedAnimation({
                widget: group,
                value_from: 0,
                value_to: 1,
                duration: Math.round(ENTRANCE_MS * this._pace()),
                easing: Adw.Easing.EASE_OUT_CUBIC,
                target: Adw.CallbackAnimationTarget.new(value => {
                    group.opacity = value;
                    group.margin_top = Math.round(ENTRANCE_RISE_PX * (1 - value));
                }),
            });
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.round(index * ENTRANCE_STAGGER_MS * this._pace()), () => {
                animation.play();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    _toast(title) {
        this._toasts.add_toast(new Adw.Toast({title}));
    }

    _appearancePage() {
        const page = new Adw.PreferencesPage();

        const style = new Adw.PreferencesGroup({title: 'Biçem'});
        const schemeRow = new Adw.ActionRow({title: 'Görünüm'});
        const schemes = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
        schemes.add(new Adw.Toggle({name: 'default', label: 'Açık'}));
        schemes.add(new Adw.Toggle({name: 'prefer-dark', label: 'Koyu'}));
        const syncScheme = () => {
            schemes.active_name = this._interface.get_string('color-scheme') === 'prefer-dark'
                ? 'prefer-dark' : 'default';
        };
        syncScheme();
        this._interface.connect('changed::color-scheme', syncScheme);
        schemes.connect('notify::active-name', () => {
            if (this._interface.get_string('color-scheme') !== schemes.active_name)
                this._interface.set_string('color-scheme', schemes.active_name);
        });
        schemeRow.add_suffix(schemes);
        style.add(schemeRow);
        style.add(this._accentRow());
        style.add(this._paceRow());
        page.add(style);

        const look = new Adw.PreferencesGroup({title: 'Simgeler ve duvar kağıdı'});
        const icons = new Adw.SwitchRow({
            title: 'VATAN simgeleri',
            subtitle: 'Kapalıyken Pardus simgeleri kullanılır',
            active: this._interface.get_string('icon-theme') === VATAN_ICON_THEME,
        });
        // "VATAN" yazmak yerine sıfırlamak seçimi bu oturumun içinde tutar:
        // VATAN varsayılanı oturuma özgüdür, yazılmış bir değer ise paylaşılan
        // dconf veritabanı üzerinden GNOME oturumuna sızardı.
        icons.connect('notify::active', () => {
            if (icons.active)
                this._interface.reset('icon-theme');
            else
                this._interface.set_string('icon-theme', PARDUS_ICON_THEME);
        });
        look.add(icons);

        const wallpaper = new Adw.ActionRow({
            title: 'Kabartma Türkiye haritası',
            subtitle: 'VATAN duvar kağıdını geri getirir; açık ve koyu biçemde kendiliğinden değişir',
        });
        const restore = new Gtk.Button({label: 'Geri getir', valign: Gtk.Align.CENTER});
        restore.connect('clicked', () => {
            for (const key of ['picture-uri', 'picture-uri-dark', 'picture-options'])
                this._background.reset(key);
            this._toast('Duvar kağıdı geri getirildi');
        });
        wallpaper.add_suffix(restore);
        look.add(wallpaper);

        const desktop = new Adw.SwitchRow({
            title: 'Masaüstü simgeleri',
            subtitle: 'Masaüstünde dosya ve klasörler; sağ tıkla yeni klasör, yapıştır, uçbirimde aç',
        });
        this._vatan.bind('desktop-icons', desktop, 'active', Gio.SettingsBindFlags.DEFAULT);
        look.add(desktop);
        page.add(look);
        return page;
    }

    _paceRow() {
        const row = new Adw.ActionRow({
            title: 'Animasyon hızı',
            subtitle: 'Pencereler, ada, Komut ve menüler bu hızda hareket eder',
        });
        const group = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
        for (const {name, label} of PACES)
            group.add(new Adw.Toggle({name, label}));
        // En yakın ön ayara yuvarla ki elle girilmiş bir değer de yine bir ön ayarı
        // seçsin.
        const sync = () => {
            const pace = this._pace();
            const nearest = PACES.reduce((a, b) =>
                Math.abs(b.factor - pace) < Math.abs(a.factor - pace) ? b : a);
            group.active_name = nearest.name;
        };
        sync();
        this._vatan.connect('changed::animation-pace', sync);
        group.connect('notify::active-name', () => {
            const preset = PACES.find(p => p.name === group.active_name);
            if (preset && Math.abs(preset.factor - this._pace()) > 0.01)
                this._vatan.set_double('animation-pace', preset.factor);
        });
        row.add_suffix(group);
        return row;
    }

    _accentRow() {
        const row = new Adw.ActionRow({title: 'Vurgu rengi'});
        const box = new Gtk.Box({spacing: 8, valign: Gtk.Align.CENTER});
        let group = null;
        const buttons = new Map();
        for (const [name, label] of ACCENTS) {
            const button = new Gtk.ToggleButton({
                css_classes: ['vatan-swatch', `vatan-swatch-${name}`],
                tooltip_text: label,
                group,
            });
            button.update_property([Gtk.AccessibleProperty.LABEL], [label]);
            group ??= button;
            button.connect('toggled', () => {
                if (button.active && this._interface.get_string('accent-color') !== name)
                    this._interface.set_string('accent-color', name);
            });
            buttons.set(name, button);
            box.append(button);
        }
        const sync = () => {
            const button = buttons.get(this._interface.get_string('accent-color'));
            if (button)
                button.active = true;
        };
        sync();
        this._interface.connect('changed::accent-color', sync);
        row.add_suffix(box);
        return row;
    }

    _newsPage() {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Gündem kartı',
            description: 'Masaüstünde, pencerelerin altında son dakika başlıkları. Kart açıkken seçili kaynağa 15 dakikada bir istek gider.',
        });

        const show = new Adw.SwitchRow({title: 'Masaüstünde göster'});
        this._vatan.bind('show-news', show, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(show);

        const source = new Adw.ComboRow({
            title: 'Kaynak',
            model: Gtk.StringList.new([...FEEDS.map(f => f.label), CUSTOM_FEED_LABEL]),
        });
        const custom = new Adw.EntryRow({title: 'RSS adresi (https)', show_apply_button: true});
        const current = this._vatan.get_string('news-feed');
        const known = FEEDS.findIndex(f => f.url === current);
        source.selected = known >= 0 ? known : FEEDS.length;
        custom.text = known >= 0 ? '' : current;
        custom.visible = known < 0;

        source.connect('notify::selected', () => {
            const feed = FEEDS[source.selected];
            custom.visible = !feed;
            if (feed) {
                this._vatan.set_string('news-feed', feed.url);
                this._vatan.set_string('news-source', feed.source);
            }
        });
        custom.connect('apply', () => {
            const url = custom.text.trim();
            if (!isHttpsUrl(url)) {
                this._toast('Adres https:// ile başlamalı');
                return;
            }
            this._vatan.set_string('news-feed', url);
            this._vatan.set_string('news-source', GLib.Uri.parse(url, GLib.UriFlags.NONE).get_host());
            this._toast('Kaynak değişti');
        });
        for (const row of [source, custom])
            this._vatan.bind('show-news', row, 'sensitive', Gio.SettingsBindFlags.GET);
        group.add(source);
        group.add(custom);
        page.add(group);
        return page;
    }

    _komutPage() {
        const page = new Adw.PreferencesPage();
        const network = new Adw.PreferencesGroup({title: 'İnternet'});
        const rates = new Adw.SwitchRow({
            title: 'Döviz kurlarını TCMB\'den al',
            subtitle: 'Kapalıyken para birimi çevirisi yapılmaz; birim çevirisi çalışmaya devam eder',
        });
        this._vatan.bind('currency-rates', rates, 'active', Gio.SettingsBindFlags.DEFAULT);
        network.add(rates);
        page.add(network);

        const privacy = new Adw.PreferencesGroup({title: 'Pano'});
        const clipboard = new Adw.SwitchRow({
            title: 'Pano geçmişini tut',
            subtitle: 'Komut\'a “pano” yazınca son kopyaladıkların çıkar. Yalnızca bellekte tutulur; parola yöneticilerinin gizli kopyaları alınmaz.',
        });
        this._vatan.bind('clipboard-history', clipboard, 'active', Gio.SettingsBindFlags.DEFAULT);
        privacy.add(clipboard);
        page.add(privacy);

        const examples = new Adw.PreferencesGroup({
            title: 'Komut\'a yazabileceklerin',
            description: 'Super tuşuna bas ve yaz.',
        });
        for (const [query, effect] of KOMUT_EXAMPLES) {
            const row = new Adw.ActionRow({title: query, subtitle: effect});
            row.add_css_class('monospace');
            examples.add(row);
        }
        page.add(examples);
        return page;
    }

    _focusPage() {
        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({
            title: 'Zamanlı odak',
            description: 'Belirlediğin saatlerde bildirim balonları gösterilmez; bildirimler yine de listede birikir.',
        });
        const enabled = new Adw.SwitchRow({title: 'Zamanlı odak'});
        this._vatan.bind('focus-schedule', enabled, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(enabled);

        for (const [key, title] of [['focus-start', 'Başlangıç'], ['focus-end', 'Bitiş']]) {
            const row = new Adw.EntryRow({title: `${title} (SS:DD)`, show_apply_button: true});
            row.text = this._vatan.get_string(key);
            row.connect('apply', () => {
                const text = row.text.trim();
                if (!isClock(text)) {
                    this._toast('Saati 09:00 biçiminde yaz');
                    row.text = this._vatan.get_string(key);
                    return;
                }
                this._vatan.set_string(key, text.padStart(5, '0'));
            });
            this._vatan.bind('focus-schedule', row, 'sensitive', Gio.SettingsBindFlags.GET);
            group.add(row);
        }

        const weekdays = new Adw.SwitchRow({
            title: 'Yalnızca hafta içi',
            subtitle: 'Gece yarısını geçen bir aralık başladığı günün sayılır',
        });
        this._vatan.bind('focus-weekdays-only', weekdays, 'active', Gio.SettingsBindFlags.DEFAULT);
        this._vatan.bind('focus-schedule', weekdays, 'sensitive', Gio.SettingsBindFlags.GET);
        group.add(weekdays);
        page.add(group);
        return page;
    }

    _aboutPage() {
        const page = new Adw.PreferencesPage();
        const about = new Adw.PreferencesGroup({title: 'VATAN'});
        about.add(new Adw.ActionRow({
            title: 'Sürüm',
            subtitle: readVersion() || 'bilinmiyor',
            css_classes: ['property'],
        }));

        const tour = new Adw.ButtonRow({title: 'Tanıtım turunu yeniden göster'});
        tour.connect('activated', () => this._vatan.set_boolean('tour-shown', false));
        about.add(tour);

        const system = new Adw.ButtonRow({title: 'Sistem ayarlarını aç', end_icon_name: 'go-next-symbolic'});
        system.connect('activated', () => launchDesktopApp('org.gnome.Settings.desktop'));
        about.add(system);

        const licenses = new Adw.ButtonRow({title: 'Lisanslar ve katkılar'});
        licenses.connect('activated', () => this._showAboutDialog());
        about.add(licenses);
        page.add(about);
        return page;
    }

    _showAboutDialog() {
        new Adw.AboutDialog({
            application_name: 'VATAN',
            application_icon: APP_ID,
            version: readVersion(),
            comments: 'Pardus 25 için masaüstü oturumu.',
            website: 'https://github.com/musstafasnn/vatan',
            license_type: Gtk.License.GPL_2_0,
            developers: ['Mustafa'],
        }).present(this);
    }
});

const application = new Adw.Application({application_id: APP_ID});
application.connect('startup', () => {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
        provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
});
application.connect('activate', () => {
    (application.active_window ?? new VatanSettingsWindow(application)).present();
});
application.run([System.programInvocationName, ...System.programArgs]);
