import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import System from 'system';

import {AccountStore} from './accounts.js';
import {MailEngine} from './engine.js';
import {PostaWindow} from './window.js';

const APP_ID = 'org.vatan.Posta';

const ACCELS = [
    ['win.compose', ['<Control>n']],
    ['win.reply', ['<Control>r']],
    ['win.reply-all', ['<Control><Shift>r']],
    ['win.forward', ['<Control>l']],
    ['win.search', ['<Control>f']],
    ['win.refresh', ['F5']],
    ['window.close', ['<Control>w']],
];

const CSS = `
.posta-row { padding: 8px 6px; }
.posta-unread-dot {
  min-width: 8px; min-height: 8px; border-radius: 999px;
  background: @accent_bg_color;
}
.posta-unread { font-weight: 600; }
.posta-star { min-width: 24px; min-height: 24px; padding: 0; }
`;

const application = new Adw.Application({application_id: APP_ID});
application.connect('startup', () => {
    const provider = new Gtk.CssProvider();
    provider.load_from_string(CSS);
    Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(),
        provider, Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);
    for (const [action, accels] of ACCELS)
        application.set_accels_for_action(action, accels);
});
application.connect('activate', () => {
    if (application.active_window) {
        application.active_window.present();
        return;
    }
    const settings = new Gio.Settings({schema_id: 'org.vatan.posta'});
    const accounts = new AccountStore(settings);
    const engine = new MailEngine(account => accounts.pins(account));
    new PostaWindow(application, {engine, accounts, settings}).present();
});
application.run([System.programInvocationName, ...System.programArgs]);
