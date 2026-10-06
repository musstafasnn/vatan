import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';
import WebKit from 'gi://WebKit?version=6.0';

import {writeAttachment} from './engine.js';
import {dateTimeFromUnix, displayName, formatAddress, formatFullDate, formatSize, hasRemoteContent, prepareHtml} from './mail-format.js';

Gio._promisify(Gtk.FileDialog.prototype, 'save', 'save_finish');
Gio._promisify(Gtk.UriLauncher.prototype, 'launch', 'launch_finish');
Gio._promisify(WebKit.WebsiteDataManager.prototype, 'clear', 'clear_finish');

const EXTERNAL_SCHEMES = ['http', 'https', 'mailto'];

// Uzak içeriğin bir kısmı CSP'nin kapsamadığı yollardan da gelebilir (DNS ön
// çözümleme); bu ayarlardan ayrıca kapatılır. Oturum geçicidir (diske yazılmaz);
// oturum bütün iletilerce paylaşıldığından çerez ve önbellek ileti değişince
// MessageView.show içinde silinir.
function createWebView(networkSession) {
    const settings = new WebKit.Settings({
        enable_javascript: false,
        enable_javascript_markup: false,
        javascript_can_open_windows_automatically: false,
        auto_load_images: true,
        enable_dns_prefetching: false,
        enable_webgl: false,
        enable_media: false,
        enable_page_cache: false,
        allow_file_access_from_file_urls: false,
        allow_universal_access_from_file_urls: false,
    });
    const view = new WebKit.WebView({
        settings,
        network_session: networkSession,
        vexpand: true,
        hexpand: true,
    });
    view.connect('decide-policy', (webView, decision, type) => {
        if (type === WebKit.PolicyDecisionType.RESPONSE) {
            decision.use();
            return true;
        }
        const action = decision.get_navigation_action();
        const uri = action.get_request().get_uri();
        if (type === WebKit.PolicyDecisionType.NAVIGATION_ACTION && uri === 'about:blank') {
            decision.use();
            return true;
        }
        decision.ignore();
        if (action.is_user_gesture() || action.get_navigation_type() === WebKit.NavigationType.LINK_CLICKED)
            openExternally(webView.get_root(), uri);
        return true;
    });
    view.connect('create', () => null);
    view.connect('context-menu', () => true);
    return view;
}

function openExternally(window, uri) {
    const scheme = GLib.Uri.peek_scheme(uri);
    if (!EXTERNAL_SCHEMES.includes(scheme)) {
        console.warn(`posta: refusing to open ${scheme ?? 'unknown'} link`);
        return;
    }
    new Gtk.UriLauncher({uri}).launch(window, null).catch(e =>
        console.warn(`posta: opening link: ${e.message}`));
}

function addressLine(label, list) {
    if (list.length === 0)
        return null;
    return new Gtk.Label({
        label: `${label}: ${list.map(formatAddress).join(', ')}`,
        xalign: 0, wrap: true, wrap_mode: Pango.WrapMode.WORD_CHAR, selectable: true,
        css_classes: ['dim-label'],
    });
}

export const MessageView = GObject.registerClass(
class MessageView extends Gtk.Box {
    _init(toast) {
        super._init({orientation: Gtk.Orientation.VERTICAL});
        this._toast = toast;
        this._stack = new Gtk.Stack({vexpand: true, transition_type: Gtk.StackTransitionType.CROSSFADE});
        this._stack.add_named(new Adw.StatusPage({icon_name: 'mail-unread-symbolic', title: 'İleti seçilmedi'}), 'empty');
        this._stack.add_named(new Adw.Spinner({halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER}), 'loading');

        this._header = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL, spacing: 4,
            margin_top: 18, margin_bottom: 12, margin_start: 18, margin_end: 18,
        });
        this._remote = new Adw.Banner({title: 'Uzak görseller engellendi', button_label: 'Görselleri göster'});
        this._remote.connect('button-clicked', () => this._showHtml(true).catch(e => console.warn(`posta: showing images: ${e.message}`)));
        this._attachments = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE, max_children_per_line: 4, halign: Gtk.Align.START,
            margin_start: 12, margin_end: 12, margin_bottom: 6,
        });
        this._text = new Gtk.TextView({
            editable: false, cursor_visible: false, wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 12, bottom_margin: 18, left_margin: 18, right_margin: 18,
        });
        this._networkSession = WebKit.NetworkSession.new_ephemeral();
        this._htmlToken = 0;
        this._web = createWebView(this._networkSession);
        this._body = new Gtk.Stack();
        this._body.add_named(new Gtk.ScrolledWindow({child: this._text, vexpand: true}), 'text');
        this._body.add_named(this._web, 'html');

        const message = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        message.append(this._header);
        message.append(this._attachments);
        message.append(new Gtk.Separator());
        message.append(this._remote);
        message.append(this._body);
        this._stack.add_named(message, 'message');
        this.append(this._stack);
    }

    clear() {
        this._htmlToken++;
        this._stack.visible_child_name = 'empty';
        this._parsed = null;
    }

    loading() {
        this._stack.visible_child_name = 'loading';
    }

    show(parsed) {
        this._parsed = parsed;
        this._renderHeader(parsed);
        this._renderAttachments(parsed.attachments);
        if (parsed.html !== null) {
            this._showHtml(false, true).catch(e => console.warn(`posta: showing message: ${e.message}`));
        } else {
            this._htmlToken++;
            this._remote.revealed = false;
            this._text.buffer.text = parsed.text ?? '';
            this._body.visible_child_name = 'text';
        }
        this._stack.visible_child_name = 'message';
    }

    async _showHtml(allowRemote, newMessage = false) {
        const token = ++this._htmlToken;
        const html = this._parsed.html;
        this._remote.revealed = !allowRemote && hasRemoteContent(html);
        this._body.visible_child_name = 'html';
        if (newMessage) {
            // Önceki iletide "Görselleri göster" ile gelen izleyici çerezi bu
            // iletiye taşınmasın. Silme başarısız olsa da ilk gösterim uzak
            // içeriği CSP ile engelliyor, o yüzden yalnızca uyarılır.
            try {
                await this._networkSession.get_website_data_manager()
                    .clear(WebKit.WebsiteDataTypes.ALL, 0, null);
            } catch (e) {
                console.warn(`posta: clearing web data: ${e.message}`);
            }
            if (token !== this._htmlToken)
                return;
        }
        this._web.load_html(prepareHtml(html, allowRemote), 'about:blank');
    }

    _renderHeader(parsed) {
        for (let child = this._header.get_first_child(); child; child = this._header.get_first_child())
            this._header.remove(child);
        this._header.append(new Gtk.Label({
            label: parsed.subject || '(Konu yok)', xalign: 0, wrap: true, selectable: true,
            css_classes: ['title-3'],
        }));
        const from = parsed.from[0];
        const sender = new Gtk.Box({spacing: 8, margin_top: 6});
        sender.append(new Gtk.Label({label: from ? displayName(from) : '(Gönderen yok)', css_classes: ['heading'], selectable: true}));
        if (from?.name)
            sender.append(new Gtk.Label({label: from.email, css_classes: ['dim-label'], selectable: true}));
        if (parsed.date > 0) {
            sender.append(new Gtk.Label({
                label: formatFullDate(dateTimeFromUnix(parsed.date)),
                hexpand: true, xalign: 1, css_classes: ['dim-label', 'numeric'],
            }));
        }
        this._header.append(sender);
        for (const line of [addressLine('Kime', parsed.to), addressLine('Bilgi', parsed.cc)]) {
            if (line)
                this._header.append(line);
        }
    }

    _renderAttachments(attachments) {
        for (let child = this._attachments.get_first_child(); child; child = this._attachments.get_first_child())
            this._attachments.remove(child);
        this._attachments.visible = attachments.length > 0;
        for (const attachment of attachments) {
            const button = new Gtk.Button({
                child: new Adw.ButtonContent({
                    icon_name: 'mail-attachment-symbolic',
                    label: `${attachment.name} · ${formatSize(attachment.size)}`,
                }),
                tooltip_text: 'Kaydet',
                css_classes: ['flat'],
            });
            button.connect('clicked', () => this._save(attachment).catch(e =>
                console.error(`posta: saving attachment: ${e.message}\n${e.stack}`)));
            this._attachments.append(button);
        }
    }

    async _save(attachment) {
        let file;
        try {
            file = await new Gtk.FileDialog({title: 'Eki kaydet', initial_name: attachment.name}).save(this.get_root(), null);
        } catch (e) {
            if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                console.warn(`posta: save dialog: ${e.message}`);
            return;
        }
        try {
            await writeAttachment(attachment.part, file);
            this._toast(`${file.get_basename()} kaydedildi`);
        } catch (e) {
            console.warn(`posta: writing ${file.get_path()}: ${e.message}`);
            this._toast('Ek kaydedilemedi');
        }
    }
});
