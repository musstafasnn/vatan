import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Dialog from '../dialog.js';
import * as ModalDialog from '../modalDialog.js';

const PAGES = [
    {
        icon: 'view-app-grid-symbolic',
        title: _('VATAN\'a hoş geldin'),
        body: _('Her şey ekranın altındaki adada: uygulamaların, Komut, çalışma alanları, durum ve saat. Menüler ve bildirimler de adanın üstünde açılır.'),
    },
    {
        icon: 'system-search-symbolic',
        title: _('Komut'),
        body: _('Super tuşuna bas ve yaz. Uygulama, dosya ve ayarların yanında Türkçe eylemleri anlar: “karanlık”, “parlaklık 40”, “100 dolar”, “5 km kaç mil”.'),
    },
    {
        icon: 'alarm-symbolic',
        title: _('Canlı Ada'),
        body: _('Komut\'a “çay 3 dk” ya da “18:30 toplantı” yaz. Ada geri sayar, süre dolunca kırmızıya döner ve haber verir. Müzik çalarken parça da adada görünür.'),
    },
    {
        icon: 'web-browser-symbolic',
        title: _('Gündem ve kısayollar'),
        body: _('Masaüstündeki Gündem kartı son dakika haberlerini gösterir. Komut\'ta “e-devlet”, “mhrs”, “usb biçimlendir” gibi kısayollar da var.'),
    },
];

const VatanTour = GObject.registerClass(
class VatanTour extends ModalDialog.ModalDialog {
    _init() {
        super._init({styleClass: 'vatan-tour'});

        this._icon = new St.Icon({style_class: 'vatan-tour-icon', x_align: Clutter.ActorAlign.CENTER});
        this.contentLayout.add_child(this._icon);
        this._content = new Dialog.MessageDialogContent();
        this.contentLayout.add_child(this._content);
        this._dots = new St.BoxLayout({style_class: 'vatan-tour-dots', x_align: Clutter.ActorAlign.CENTER});
        PAGES.forEach(() => this._dots.add_child(new St.Widget({style_class: 'vatan-tour-dot'})));
        this.contentLayout.add_child(this._dots);

        this._show(0);
    }

    _show(index) {
        const page = PAGES[index];
        this._icon.icon_name = page.icon;
        this._content.title = page.title;
        this._content.description = page.body;
        this._dots.get_children().forEach((dot, i) => {
            if (i === index)
                dot.add_style_pseudo_class('checked');
            else
                dot.remove_style_pseudo_class('checked');
        });

        const last = index === PAGES.length - 1;
        this.setButtons([
            index === 0
                ? {label: _('Geç'), action: () => this.close(), key: Clutter.KEY_Escape}
                : {label: _('Geri'), action: () => this._show(index - 1), key: Clutter.KEY_Escape},
            {
                label: last ? _('Başla') : _('İleri'),
                action: () => last ? this.close() : this._show(index + 1),
                default: true,
            },
        ]);
    }
});

export function showTour() {
    new VatanTour().open();
}

let settings = null;

// Shown once per user; marking it before opening means a crash mid-tour does
// not trap anyone in a tour on every login. VATAN Ayarları clears the flag to
// ask for the tour again, which this picks up at once.
export function maybeShowTour() {
    if (!settings) {
        settings = new Gio.Settings({schema_id: 'org.vatan.shell'});
        settings.connect('changed::tour-shown', () => maybeShowTour());
    }
    if (settings.get_boolean('tour-shown'))
        return;
    settings.set_boolean('tour-shown', true);
    showTour();
}
