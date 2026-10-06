import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

import {buildMessage, readAttachmentFile, userMessage} from './engine.js';
import {formatAddress, formatSize, parseAddressList} from './mail-format.js';

Gio._promisify(Gtk.FileDialog.prototype, 'open_multiple', 'open_multiple_finish');

const ADDRESS_FIELDS = [
    ['to', 'Kime'],
    ['cc', 'Bilgi'],
    ['bcc', 'Gizli'],
];

export const ComposerWindow = GObject.registerClass(
class ComposerWindow extends Adw.Window {
    // draft: {account, to, cc, bcc, subject, body, attachments, inReplyTo, references, title}
    _init(parent, draft, send) {
        super._init({
            transient_for: parent,
            title: draft.title ?? 'Yeni ileti',
            default_width: 720,
            default_height: 640,
        });
        this._draft = draft;
        this._send = send;
        this._attachments = [...(draft.attachments ?? [])];

        this._toasts = new Adw.ToastOverlay();
        const header = new Adw.HeaderBar();
        this._sendButton = new Gtk.Button({label: 'Gönder', css_classes: ['suggested-action']});
        this._sendButton.connect('clicked', () => this._onSend().catch(e => console.error(`posta: send: ${e.message}\n${e.stack}`)));
        const attach = new Gtk.Button({icon_name: 'mail-attachment-symbolic', tooltip_text: 'Dosya ekle'});
        attach.connect('clicked', () => this._onAttach().catch(e => console.error(`posta: attach: ${e.message}\n${e.stack}`)));
        this._spinner = new Adw.Spinner({visible: false});
        header.pack_end(this._sendButton);
        header.pack_end(this._spinner);
        header.pack_start(attach);

        const fields = new Gtk.Grid({column_spacing: 12, row_spacing: 6, margin_top: 12, margin_start: 12, margin_end: 12});
        const addRow = (row, label, widget) => {
            fields.attach(new Gtk.Label({label, xalign: 1, css_classes: ['dim-label']}), 0, row, 1, 1);
            fields.attach(widget, 1, row, 1, 1);
        };
        addRow(0, 'Kimden', new Gtk.Label({
            label: formatAddress({name: draft.account.displayName, email: draft.account.address}),
            xalign: 0, selectable: true,
        }));
        this._entries = {};
        ADDRESS_FIELDS.forEach(([key, label], index) => {
            const entry = new Gtk.Entry({hexpand: true, text: (draft[key] ?? []).map(formatAddress).join(', ')});
            entry.update_property([Gtk.AccessibleProperty.LABEL], [label]);
            this._entries[key] = entry;
            addRow(index + 1, label, entry);
        });
        this._subject = new Gtk.Entry({hexpand: true, text: draft.subject ?? ''});
        this._subject.update_property([Gtk.AccessibleProperty.LABEL], ['Konu']);
        addRow(ADDRESS_FIELDS.length + 1, 'Konu', this._subject);
        this._subject.connect('changed', () => {
            this.title = this._subject.text || (draft.title ?? 'Yeni ileti');
        });

        this._body = new Gtk.TextView({
            wrap_mode: Gtk.WrapMode.WORD_CHAR,
            top_margin: 12, bottom_margin: 12, left_margin: 12, right_margin: 12,
            vexpand: true,
        });
        this._body.buffer.text = draft.body ?? '';
        this._body.buffer.place_cursor(this._body.buffer.get_start_iter());

        this._attachmentBox = new Gtk.FlowBox({
            selection_mode: Gtk.SelectionMode.NONE, margin_start: 12, margin_end: 12, margin_bottom: 6,
            max_children_per_line: 4,
        });
        this._renderAttachments();

        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL});
        box.append(fields);
        box.append(new Gtk.Separator({margin_top: 12}));
        box.append(new Gtk.ScrolledWindow({child: this._body, vexpand: true}));
        box.append(this._attachmentBox);

        const view = new Adw.ToolbarView({content: box});
        view.add_top_bar(header);
        this._toasts.child = view;
        this.content = this._toasts;

        const focus = (draft.to ?? []).length === 0 ? this._entries.to : this._body;
        focus.grab_focus();
    }

    _renderAttachments() {
        for (let child = this._attachmentBox.get_first_child(); child; child = this._attachmentBox.get_first_child())
            this._attachmentBox.remove(child);
        this._attachmentBox.visible = this._attachments.length > 0;
        this._attachments.forEach((attachment, index) => {
            const size = attachment.bytes ? attachment.bytes.length : attachment.size;
            const button = new Gtk.Button({
                child: new Adw.ButtonContent({icon_name: 'edit-delete-symbolic', label: `${attachment.name} · ${formatSize(size ?? 0)}`}),
                tooltip_text: 'Eki çıkar',
                css_classes: ['flat'],
            });
            button.connect('clicked', () => {
                this._attachments.splice(index, 1);
                this._renderAttachments();
            });
            this._attachmentBox.append(button);
        });
    }

    async _onAttach() {
        let files;
        try {
            files = await new Gtk.FileDialog({title: 'Dosya ekle'}).open_multiple(this, null);
        } catch (e) {
            if (!e.matches?.(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                console.warn(`posta: file chooser: ${e.message}`);
            return;
        }
        for (let i = 0; i < files.get_n_items(); i++) {
            try {
                this._attachments.push(await readAttachmentFile(files.get_item(i)));
            } catch (e) {
                console.warn(`posta: reading attachment: ${e.message}`);
                this._toasts.add_toast(new Adw.Toast({title: 'Dosya okunamadı'}));
            }
        }
        this._renderAttachments();
    }

    _readRecipients() {
        const result = {};
        const invalid = [];
        for (const [key] of ADDRESS_FIELDS) {
            const parsed = parseAddressList(this._entries[key].text);
            result[key] = parsed.addresses;
            invalid.push(...parsed.invalid);
        }
        return {result, invalid};
    }

    async _onSend() {
        const {result, invalid} = this._readRecipients();
        if (invalid.length > 0) {
            this._toasts.add_toast(new Adw.Toast({title: `Geçersiz adres: ${invalid.join(', ')}`}));
            return;
        }
        const recipients = [...result.to, ...result.cc, ...result.bcc];
        if (recipients.length === 0) {
            this._toasts.add_toast(new Adw.Toast({title: 'En az bir alıcı yaz'}));
            return;
        }
        const message = buildMessage({
            from: {name: this._draft.account.displayName, email: this._draft.account.address},
            ...result,
            subject: this._subject.text,
            body: this._body.buffer.text,
            attachments: this._attachments,
            inReplyTo: this._draft.inReplyTo,
            references: this._draft.references,
        });
        this._setBusy(true);
        try {
            await this._send(this._draft.account, message, recipients, this);
            this.close();
        } catch (e) {
            console.warn(`posta: sending failed: ${e.message}\n${e.stack ?? ''}`);
            this._toasts.add_toast(new Adw.Toast({title: `Gönderilemedi: ${userMessage(e)}`, timeout: 0}));
        } finally {
            this._setBusy(false);
        }
    }

    _setBusy(busy) {
        this._sendButton.sensitive = !busy;
        this._spinner.visible = busy;
    }
});
