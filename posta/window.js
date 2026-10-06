import Adw from 'gi://Adw?version=1';
import Camel from 'gi://Camel';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango';

import {AccountDialog, askTrust} from './account-dialog.js';
import {ComposerWindow} from './composer.js';
import {UserError, isOfflineError, userMessage} from './engine.js';
import {
    compareMessages, dateTimeFromUnix, displayName, formatAddress, formatListDate, forwardBody,
    forwardSubject, htmlToText, matchesQuery, quoteReply, replyRecipients, replySubject,
} from './mail-format.js';
import {CertificateError, sha256Fingerprint} from './wire.js';
import {MessageView} from './reader.js';

const SECONDS_PER_MINUTE = 60;
const MIN_SERVER_QUERY = 2;
const UNDO_TIMEOUT_S = 10;
const ROLE_ICONS = {
    inbox: 'mail-inbox-symbolic',
    drafts: 'document-edit-symbolic',
    sent: 'mail-send-symbolic',
    archive: 'folder-symbolic',
    junk: 'mail-mark-junk-symbolic',
    trash: 'user-trash-symbolic',
};

const ROLE_NAMES = {
    inbox: 'Gelen Kutusu',
    drafts: 'Taslaklar',
    sent: 'Gönderilenler',
    junk: 'İstenmeyen',
    trash: 'Çöp',
};

const MessageItem = GObject.registerClass(
class MessageItem extends GObject.Object {
    _init(record) {
        super._init();
        Object.assign(this, record);
    }
});

function compareItems(a, b) {
    return compareMessages(a, b);
}

function folderKey(account, fullName) {
    return `${account.id}\n${fullName}`;
}

function logError(context, e) {
    console.warn(`posta: ${context}: ${e?.message ?? e}\n${e?.stack ?? ''}`);
}

export const PostaWindow = GObject.registerClass(
class PostaWindow extends Adw.ApplicationWindow {
    _init(application, {engine, accounts, settings}) {
        super._init({application, title: 'Posta', default_width: 1240, default_height: 780});
        this._engine = engine;
        this._accounts = accounts;
        this._settings = settings;
        this._accountList = [];
        this._states = new Map();
        this._folderRows = new Map();
        this._current = null;
        this._selectToken = 0;
        this._openToken = 0;
        this._query = '';
        this._serverHits = new Set();

        this._toasts = new Adw.ToastOverlay();
        this._root = new Gtk.Stack({transition_type: Gtk.StackTransitionType.CROSSFADE});
        this._root.add_named(this._welcomePage(), 'welcome');
        this._root.add_named(this._mainPage(), 'main');
        this._toasts.child = this._root;
        this.content = this._toasts;

        this._installActions();
        this._scheduleRefresh();
        this._settings.connect('changed::refresh-minutes', () => this._scheduleRefresh());
        this._loadAccounts().catch(e => logError('loading accounts', e));
    }

    toast(title, options = {}) {
        const toast = new Adw.Toast({title, ...options});
        this._toasts.add_toast(toast);
        return toast;
    }

    _welcomePage() {
        const add = new Gtk.Button({
            label: 'Hesap ekle', halign: Gtk.Align.CENTER, css_classes: ['pill', 'suggested-action'],
            action_name: 'win.add-account',
        });
        const status = new Adw.StatusPage({
            icon_name: 'mail-send-receive',
            title: 'VATAN Posta',
            description: 'Başlamak için bir posta hesabı ekle. GNOME Çevrimiçi Hesaplar\'daki posta hesapları da burada görünür.',
            child: add,
        });
        const view = new Adw.ToolbarView({content: status});
        view.add_top_bar(new Adw.HeaderBar({title_widget: new Gtk.Label()}));
        return view;
    }

    _mainPage() {
        this._sidebarList = new Gtk.ListBox({css_classes: ['navigation-sidebar']});
        this._sidebarList.connect('row-selected', (_list, row) => {
            if (row?._folder)
                this._selectFolder(row._account, row._folder).catch(e => logError('opening folder', e));
        });
        const sidebarHeader = new Adw.HeaderBar({title_widget: new Gtk.Label({label: 'Posta', css_classes: ['heading']})});
        sidebarHeader.pack_end(new Gtk.Button({
            icon_name: 'list-add-symbolic', tooltip_text: 'Hesap ekle', action_name: 'win.add-account',
        }));
        const sidebarView = new Adw.ToolbarView({content: new Gtk.ScrolledWindow({child: this._sidebarList})});
        sidebarView.add_top_bar(sidebarHeader);
        const sidebarPage = new Adw.NavigationPage({title: 'Posta', child: sidebarView});

        this._inner = new Adw.NavigationSplitView({
            sidebar: this._listPage(),
            content: this._readerPage(),
            min_sidebar_width: 320,
            max_sidebar_width: 480,
            sidebar_width_fraction: 0.38,
        });
        this._outer = new Adw.NavigationSplitView({
            sidebar: sidebarPage,
            content: new Adw.NavigationPage({title: 'İletiler', child: this._inner}),
            min_sidebar_width: 200,
            max_sidebar_width: 280,
        });

        const medium = new Adw.Breakpoint({condition: Adw.BreakpointCondition.parse('max-width: 900sp')});
        medium.add_setter(this._inner, 'collapsed', true);
        this.add_breakpoint(medium);
        const narrow = new Adw.Breakpoint({condition: Adw.BreakpointCondition.parse('max-width: 560sp')});
        narrow.add_setter(this._inner, 'collapsed', true);
        narrow.add_setter(this._outer, 'collapsed', true);
        this.add_breakpoint(narrow);
        return this._outer;
    }

    _listPage() {
        this._store = new Gio.ListStore({item_type: MessageItem});
        this._filter = Gtk.CustomFilter.new(item =>
            matchesQuery(item, this._query) || this._serverHits.has(item.uid));
        this._filtered = new Gtk.FilterListModel({model: this._store, filter: this._filter});
        this._selection = new Gtk.SingleSelection({model: this._filtered, autoselect: false, can_unselect: true});
        this._selection.connect('notify::selected-item', () => this._onSelectionChanged());
        this._filtered.connect('items-changed', () => this._updateListState());

        const factory = new Gtk.SignalListItemFactory();
        factory.connect('setup', (_factory, listItem) => listItem.set_child(this._messageRow()));
        factory.connect('bind', (_factory, listItem) => this._bindRow(listItem));
        factory.connect('unbind', (_factory, listItem) => {
            if (listItem.item)
                listItem.item._refresh = null;
        });
        this._listView = new Gtk.ListView({model: this._selection, factory, css_classes: ['navigation-sidebar']});

        this._listStack = new Gtk.Stack();
        this._listStack.add_named(new Gtk.ScrolledWindow({child: this._listView, vexpand: true}), 'list');
        this._listStack.add_named(new Adw.Spinner({halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER}), 'loading');
        this._listStack.add_named(new Adw.StatusPage({icon_name: 'mail-inbox-symbolic', title: 'Bu klasör boş'}), 'empty');
        this._listStack.add_named(new Adw.StatusPage({icon_name: 'edit-find-symbolic', title: 'Sonuç yok'}), 'nomatch');
        this._listStack.add_named(new Adw.StatusPage({icon_name: 'folder-symbolic', title: 'Bir klasör seç'}), 'none');
        this._listStack.visible_child_name = 'none';

        this._searchEntry = new Gtk.SearchEntry({placeholder_text: 'Konu, gönderen ya da gövdede ara', hexpand: true});
        this._searchEntry.connect('search-changed', () => this._onSearch().catch(e => logError('search', e)));
        this._searchBar = new Gtk.SearchBar({child: this._searchEntry, show_close_button: false});
        this._searchBar.connect_entry(this._searchEntry);

        this._offline = new Adw.Banner({title: 'Çevrimdışı: önbellekteki iletiler gösteriliyor', button_label: 'Yeniden bağlan'});
        this._offline.connect('button-clicked', () => this._reconnect().catch(e => logError('reconnect', e)));

        const header = new Adw.HeaderBar();
        header.pack_start(new Gtk.Button({icon_name: 'mail-message-new-symbolic', tooltip_text: 'Yeni ileti (Ctrl+N)', action_name: 'win.compose'}));
        const searchToggle = new Gtk.ToggleButton({icon_name: 'system-search-symbolic', tooltip_text: 'Ara (Ctrl+F)'});
        searchToggle.bind_property('active', this._searchBar, 'search-mode-enabled', GObject.BindingFlags.BIDIRECTIONAL);
        header.pack_end(searchToggle);
        header.pack_end(new Gtk.Button({icon_name: 'view-refresh-symbolic', tooltip_text: 'Yenile (F5)', action_name: 'win.refresh'}));

        const view = new Adw.ToolbarView({content: this._listStack});
        view.add_top_bar(header);
        view.add_top_bar(this._searchBar);
        view.add_top_bar(this._offline);
        this._listNavPage = new Adw.NavigationPage({title: 'İletiler', child: view});
        return this._listNavPage;
    }

    _readerPage() {
        this._reader = new MessageView(title => this.toast(title));
        const header = new Adw.HeaderBar({show_title: false});
        const buttons = [
            ['mail-reply-sender-symbolic', 'Yanıtla (Ctrl+R)', 'win.reply'],
            ['mail-reply-all-symbolic', 'Tümünü yanıtla (Ctrl+Shift+R)', 'win.reply-all'],
            ['mail-forward-symbolic', 'İlet (Ctrl+L)', 'win.forward'],
        ];
        for (const [icon, tooltip, action] of buttons)
            header.pack_start(new Gtk.Button({icon_name: icon, tooltip_text: tooltip, action_name: action}));
        header.pack_end(new Gtk.Button({icon_name: 'user-trash-symbolic', tooltip_text: 'Sil (Delete)', action_name: 'win.delete'}));
        this._starButton = new Gtk.Button({icon_name: 'non-starred-symbolic', tooltip_text: 'Yıldızla', action_name: 'win.toggle-star'});
        header.pack_end(this._starButton);
        const view = new Adw.ToolbarView({content: this._reader});
        view.add_top_bar(header);
        return new Adw.NavigationPage({title: 'İleti', child: view});
    }

    _messageRow() {
        const dot = new Gtk.Box({css_classes: ['posta-unread-dot'], valign: Gtk.Align.CENTER});
        const sender = new Gtk.Label({xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END});
        const attachment = new Gtk.Image({icon_name: 'mail-attachment-symbolic', css_classes: ['dim-label']});
        const date = new Gtk.Label({css_classes: ['dim-label', 'caption', 'numeric']});
        const top = new Gtk.Box({spacing: 6});
        for (const widget of [dot, sender, attachment, date])
            top.append(widget);

        const subject = new Gtk.Label({xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END});
        const star = new Gtk.Button({css_classes: ['flat', 'circular', 'posta-star'], valign: Gtk.Align.CENTER});
        const bottom = new Gtk.Box({spacing: 6});
        bottom.append(subject);
        bottom.append(star);

        const row = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, css_classes: ['posta-row']});
        row.append(top);
        row.append(bottom);
        row._widgets = {dot, sender, attachment, date, subject, star};
        star.connect('clicked', () => {
            if (row._item)
                this._setFlagged(row._item, !row._item.flagged);
        });
        return row;
    }

    _bindRow(listItem) {
        const row = listItem.child;
        const item = listItem.item;
        const {dot, sender, attachment, date, subject, star} = row._widgets;
        row._item = item;
        const now = GLib.DateTime.new_now_local();
        item._refresh = () => {
            dot.opacity = item.unread ? 1 : 0;
            sender.label = item.sender || '(Gönderen yok)';
            sender.css_classes = item.unread ? ['posta-unread'] : [];
            subject.label = item.subject || '(Konu yok)';
            subject.css_classes = item.unread ? [] : ['dim-label'];
            attachment.visible = item.attachment;
            date.label = item.date > 0 ? formatListDate(dateTimeFromUnix(item.date), now) : '';
            star.icon_name = item.flagged ? 'starred-symbolic' : 'non-starred-symbolic';
            star.tooltip_text = item.flagged ? 'Yıldızı kaldır' : 'Yıldızla';
            row.update_property([Gtk.AccessibleProperty.LABEL],
                [`${item.unread ? 'Okunmamış, ' : ''}${item.sender}: ${item.subject}`]);
        };
        item._refresh();
    }

    _installActions() {
        const actions = {
            'compose': () => this._compose(),
            'reply': () => this._reply(false),
            'reply-all': () => this._reply(true),
            'forward': () => this._forward(),
            'delete': () => this._deleteSelected().catch(e => logError('delete', e)),
            'toggle-star': () => this._toggleStarOnSelected(),
            'search': () => {
                this._searchBar.search_mode_enabled = true;
                this._searchEntry.grab_focus();
            },
            'refresh': () => this._refreshAll(true).catch(e => logError('refresh', e)),
            'add-account': () => new AccountDialog((account, password, dialog) =>
                this._submitAccount(account, password, dialog)).present(this),
        };
        this._actions = {};
        for (const [name, handler] of Object.entries(actions)) {
            const action = new Gio.SimpleAction({name});
            action.connect('activate', handler);
            this.add_action(action);
            this._actions[name] = action;
        }
        // Delete uygulama kısayolu olsaydı arama kutusunda harf silmeyi de
        // yakalardı; kabarma evresindeki bu denetleyiciye ancak odaklı metin
        // alanı tuşu kullanmazsa sıra gelir.
        const shortcuts = new Gtk.ShortcutController({propagation_phase: Gtk.PropagationPhase.BUBBLE});
        shortcuts.add_shortcut(new Gtk.Shortcut({
            trigger: Gtk.ShortcutTrigger.parse_string('Delete'),
            action: Gtk.ShortcutAction.parse_string('action(win.delete)'),
        }));
        this.add_controller(shortcuts);
        this._updateActions();
    }

    _updateActions() {
        const hasMessage = !!this._parsed;
        for (const name of ['reply', 'reply-all', 'forward', 'delete', 'toggle-star'])
            this._actions[name].enabled = hasMessage;
        const usable = this._accountList.some(a => this._states.get(a.id)?.status === 'ok' ||
            this._states.get(a.id)?.status === 'offline');
        this._actions['compose'].enabled = usable;
        const item = this._selection.selected_item;
        this._starButton.icon_name = item?.flagged ? 'starred-symbolic' : 'non-starred-symbolic';
    }

    async _withTrust(account, protocol, operation, parent = this) {
        for (;;) {
            try {
                return await operation();
            } catch (e) {
                if (!(e instanceof CertificateError))
                    throw e;
                if (!await askTrust(parent, e))
                    throw new UserError('Sertifikaya güvenilmediği için bağlanılmadı');
                const server = protocol === 'smtp' ? account.smtp : account.imap;
                await this._engine.trustCertificate(account, protocol, e.certificate);
                this._accounts.trust(server, sha256Fingerprint(e.certificate));
            }
        }
    }

    async _loadAccounts() {
        this._accountList = await this._accounts.all();
        if (this._accountList.length === 0) {
            this._root.visible_child_name = 'welcome';
            return;
        }
        this._root.visible_child_name = 'main';
        this._rebuildSidebar();
        for (const account of this._accountList)
            await this._openAccount(account);
        this._selectFirstInbox();
    }

    _selectFirstInbox() {
        for (const account of this._accountList) {
            const state = this._states.get(account.id);
            const inbox = state?.folders?.find(f => f.role === 'inbox');
            if (inbox) {
                this._sidebarList.select_row(this._folderRows.get(folderKey(account, inbox.fullName)).row);
                return;
            }
        }
    }

    async _openAccount(account) {
        const state = {status: 'connecting', message: '', folders: []};
        this._states.set(account.id, state);
        if (account.unsupported) {
            Object.assign(state, {status: 'unsupported', message: account.unsupported});
            this._rebuildSidebar();
            return;
        }
        try {
            const credentials = await this._accounts.credentials(account);
            if (!credentials)
                throw new UserError('Parola anahtarlıkta bulunamadı; hesabı yeniden ekle');
            const online = await this._withTrust(account, 'imap', () => this._engine.open(account, credentials));
            state.status = online ? 'ok' : 'offline';
            state.folders = await this._engine.folders(account);
        } catch (e) {
            logError(`opening ${account.address}`, e);
            Object.assign(state, {status: 'error', message: userMessage(e)});
        }
        this._rebuildSidebar();
        this._updateActions();
    }

    _rebuildSidebar() {
        const selectedKey = this._current ? folderKey(this._current.account, this._current.info.fullName) : null;
        this._sidebarList.remove_all();
        this._folderRows.clear();
        for (const account of this._accountList) {
            const state = this._states.get(account.id) ?? {status: 'connecting', folders: []};
            this._sidebarList.append(this._accountRow(account, state));
            for (const folder of state.folders)
                this._sidebarList.append(this._folderRow(account, folder));
        }
        const selected = selectedKey && this._folderRows.get(selectedKey);
        if (selected) {
            this._restoringSelection = true;
            this._sidebarList.select_row(selected.row);
            this._restoringSelection = false;
        }
    }

    _accountRow(account, state) {
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 2, margin_top: 12, margin_start: 6});
        box.append(new Gtk.Label({
            label: account.address, xalign: 0, ellipsize: Pango.EllipsizeMode.END, css_classes: ['heading'],
        }));
        const notes = {
            connecting: 'Bağlanıyor…',
            offline: 'Çevrimdışı',
            error: state.message,
            unsupported: state.message,
        };
        if (notes[state.status]) {
            box.append(new Gtk.Label({
                label: notes[state.status], xalign: 0, wrap: true,
                css_classes: ['caption', state.status === 'error' ? 'error' : 'dim-label'],
            }));
        }
        return new Gtk.ListBoxRow({child: box, activatable: false, selectable: false});
    }

    _folderRow(account, folder) {
        const box = new Gtk.Box({spacing: 12, margin_start: 6 + folder.depth * 12});
        box.append(new Gtk.Image({icon_name: ROLE_ICONS[folder.role] ?? 'folder-symbolic'}));
        box.append(new Gtk.Label({label: ROLE_NAMES[folder.role] ?? folder.displayName, xalign: 0, hexpand: true, ellipsize: Pango.EllipsizeMode.END}));
        const count = new Gtk.Label({css_classes: ['dim-label', 'numeric', 'caption']});
        box.append(count);
        const row = new Gtk.ListBoxRow({child: box});
        row._account = account;
        row._folder = folder;
        const entry = {row, count, folder};
        this._folderRows.set(folderKey(account, folder.fullName), entry);
        this._setFolderCount(entry, folder.unread);
        return row;
    }

    _setFolderCount(entry, unread) {
        entry.folder.unread = unread;
        entry.count.label = unread > 0 ? String(unread) : '';
    }

    async _selectFolder(account, info) {
        if (this._restoringSelection && this._current?.info.fullName === info.fullName &&
            this._current.account.id === account.id)
            return;
        const token = ++this._selectToken;
        this._current = {account, info, folder: null};
        this._listNavPage.title = ROLE_NAMES[info.role] ?? info.displayName;
        this._offline.revealed = this._states.get(account.id)?.status === 'offline';
        this._store.remove_all();
        this._resetSearch();
        this._showMessage(null);
        this._listStack.visible_child_name = 'loading';
        this._outer.show_content = true;
        try {
            const folder = await this._engine.folder(account, info.fullName);
            if (token !== this._selectToken)
                return;
            this._current.folder = folder;
            await this._fillList();
            if (token !== this._selectToken)
                return;
            await this._engine.refresh(account, folder);
            if (token === this._selectToken)
                await this._syncList();
        } catch (e) {
            if (token !== this._selectToken)
                return;
            logError(`folder ${info.fullName}`, e);
            this._updateListState();
            if (isOfflineError(e))
                this._offline.revealed = true;
            else
                this.toast(`Klasör açılamadı: ${userMessage(e)}`);
        }
    }

    async _fillList() {
        const {folder} = this._current;
        const records = await this._engine.summaries(folder);
        records.sort(compareMessages);
        this._store.splice(0, this._store.get_n_items(), records.map(r => new MessageItem(r)));
        this._updateFolderCount();
        this._updateListState();
        // Gizli yığın sayfasındayken dolan liste ilk görünüşte kaydırılmış açılıyor.
        if (this._store.get_n_items() > 0)
            this._listView.scroll_to(0, Gtk.ListScrollFlags.NONE, null);
    }

    // Yenilemeden sonra listeyi baştan kurmak 10 000 iletilik klasörde kaydırma
    // konumunu ve seçimi kaybettirir; yalnızca değişen satırlara dokunulur.
    async _syncList() {
        const {folder} = this._current;
        const remaining = new Set(folder.get_uids());
        for (let i = this._store.get_n_items() - 1; i >= 0; i--) {
            const item = this._store.get_item(i);
            const record = remaining.has(item.uid) ? this._engine.summary(folder, item.uid) : null;
            remaining.delete(item.uid);
            if (!record || record.deleted) {
                this._store.remove(i);
                continue;
            }
            if (record.unread !== item.unread || record.flagged !== item.flagged) {
                Object.assign(item, record);
                item._refresh?.();
            }
        }
        for (const uid of remaining) {
            const record = this._engine.summary(folder, uid);
            if (record && !record.deleted)
                this._store.insert_sorted(new MessageItem(record), compareItems);
        }
        this._updateFolderCount();
        this._updateListState();
    }

    _updateFolderCount() {
        if (!this._current)
            return;
        let unread = 0;
        for (let i = 0; i < this._store.get_n_items(); i++) {
            if (this._store.get_item(i).unread)
                unread++;
        }
        const entry = this._folderRows.get(folderKey(this._current.account, this._current.info.fullName));
        if (entry)
            this._setFolderCount(entry, unread);
    }

    _updateListState() {
        if (!this._current || this._listStack.visible_child_name === 'loading' && !this._current.folder)
            return;
        if (this._filtered.get_n_items() > 0)
            this._listStack.visible_child_name = 'list';
        else
            this._listStack.visible_child_name = this._query ? 'nomatch' : 'empty';
    }

    _resetSearch() {
        this._query = '';
        this._serverHits = new Set();
        if (this._searchEntry.text)
            this._searchEntry.text = '';
        this._searchBar.search_mode_enabled = false;
        this._filter.changed(Gtk.FilterChange.LESS_STRICT);
    }

    async _onSearch() {
        const query = this._searchEntry.text.trim();
        this._query = query;
        this._serverHits = new Set();
        this._filter.changed(Gtk.FilterChange.DIFFERENT);
        this._updateListState();
        if (query.length < MIN_SERVER_QUERY || !this._current?.folder)
            return;
        const {account, folder} = this._current;
        try {
            const uids = await this._engine.search(account, folder, query);
            if (!uids || query !== this._query || folder !== this._current?.folder)
                return;
            this._serverHits = new Set(uids);
            this._filter.changed(Gtk.FilterChange.LESS_STRICT);
            this._updateListState();
        } catch (e) {
            logError('server search', e);
            this.toast('Gövdede arama yapılamadı; yalnızca konu ve gönderen arandı');
        }
    }

    _onSelectionChanged() {
        const item = this._selection.selected_item;
        this._updateActions();
        if (!item) {
            this._showMessage(null);
            return;
        }
        if (item === this._openedItem)
            return;
        this._openMessage(item).catch(e => logError('opening message', e));
    }

    _showMessage(parsed) {
        this._parsed = parsed;
        if (!parsed) {
            this._openedItem = null;
            this._reader.clear();
        }
        this._updateActions();
    }

    async _openMessage(item) {
        const token = ++this._openToken;
        const {account, folder} = this._current;
        this._openedItem = item;
        this._reader.loading();
        this._inner.show_content = true;
        try {
            const parsed = await this._engine.message(account, folder, item.uid);
            if (token !== this._openToken)
                return;
            this._reader.show(parsed);
            this._showMessage(parsed);
            if (item.unread) {
                this._engine.setFlags(folder, [item.uid], Camel.MessageFlags.SEEN, Camel.MessageFlags.SEEN);
                item.unread = false;
                item._refresh?.();
                this._updateFolderCount();
            }
        } catch (e) {
            if (token !== this._openToken)
                return;
            logError(`message ${item.uid}`, e);
            this._openedItem = null;
            this._reader.clear();
            this.toast(`İleti açılamadı: ${userMessage(e)}`);
        }
    }

    _setFlagged(item, flagged) {
        const {folder} = this._current;
        this._engine.setFlags(folder, [item.uid], Camel.MessageFlags.FLAGGED, flagged ? Camel.MessageFlags.FLAGGED : 0);
        item.flagged = flagged;
        item._refresh?.();
        this._updateActions();
    }

    _toggleStarOnSelected() {
        const item = this._selection.selected_item;
        if (item)
            this._setFlagged(item, !item.flagged);
    }

    async _deleteSelected() {
        const item = this._selection.selected_item;
        if (!item || !this._current?.folder)
            return;
        const {account, folder, info} = this._current;
        const position = this._selection.selected;
        let result;
        try {
            result = await this._engine.moveToTrash(account, folder, [item.uid]);
        } catch (e) {
            logError('moving to trash', e);
            this.toast(`Silinemedi: ${userMessage(e)}`);
            return;
        }
        const [found, index] = this._store.find(item);
        if (found)
            this._store.remove(index);
        this._updateFolderCount();
        const next = Math.min(position, this._filtered.get_n_items() - 1);
        if (next >= 0)
            this._selection.selected = next;
        else
            this._showMessage(null);

        if (result.permanent) {
            this.toast('İleti kalıcı olarak silindi');
            return;
        }
        const toast = this.toast('İleti çöpe taşındı', {button_label: 'Geri al', timeout: UNDO_TIMEOUT_S});
        if (result.moved.length === 0) {
            toast.button_label = null;
            return;
        }
        toast.connect('button-clicked', () => this._undoDelete(account, info.fullName, result)
            .catch(e => logError('undo delete', e)));
    }

    async _undoDelete(account, originalName, result) {
        try {
            const trash = await this._engine.folder(account, result.trashName);
            await this._engine.moveMessages(account, trash, result.moved, originalName);
        } catch (e) {
            logError('restoring from trash', e);
            this.toast(`Geri alınamadı: ${userMessage(e)}`);
            return;
        }
        if (this._current?.account.id === account.id && this._current.info.fullName === originalName && this._current.folder) {
            await this._engine.refresh(account, this._current.folder);
            await this._syncList();
        }
        this.toast('İleti geri alındı');
    }

    _composeAccount() {
        const current = this._current?.account;
        if (current && ['ok', 'offline'].includes(this._states.get(current.id)?.status))
            return current;
        return this._accountList.find(a => ['ok', 'offline'].includes(this._states.get(a.id)?.status)) ?? null;
    }

    _openComposer(draft) {
        new ComposerWindow(this, draft, (account, message, recipients, composer) =>
            this._send(account, message, recipients, composer)).present();
    }

    _compose() {
        const account = this._composeAccount();
        if (account)
            this._openComposer({account, title: 'Yeni ileti'});
    }

    _bodyText(parsed) {
        return parsed.text ?? htmlToText(parsed.html ?? '');
    }

    _reply(all) {
        const parsed = this._parsed;
        if (!parsed)
            return;
        const account = this._current.account;
        const {to, cc} = replyRecipients(parsed, {name: '', email: account.address}, all);
        const sender = parsed.from[0] ? displayName(parsed.from[0]) : '';
        this._openComposer({
            account, to, cc,
            title: all ? 'Tümünü yanıtla' : 'Yanıtla',
            subject: replySubject(parsed.subject),
            body: quoteReply(this._bodyText(parsed), sender, dateTimeFromUnix(parsed.date)),
            inReplyTo: parsed.messageId,
            references: parsed.references,
        });
    }

    _forward() {
        const parsed = this._parsed;
        if (!parsed)
            return;
        this._openComposer({
            account: this._current.account,
            title: 'İlet',
            subject: forwardSubject(parsed.subject),
            body: forwardBody(this._bodyText(parsed), {
                from: parsed.from.map(formatAddress).join(', '),
                to: parsed.to.map(formatAddress).join(', '),
                subject: parsed.subject,
                dateTime: dateTimeFromUnix(parsed.date),
            }),
            attachments: parsed.attachments.map(({name, part, size}) => ({name, part, size})),
        });
    }

    async _send(account, message, recipients, composer) {
        await this._withTrust(account, 'smtp', () => this._engine.send(account, message, recipients), composer);
        this.toast('İleti gönderildi');
    }

    async _submitAccount(account, password, dialog) {
        if (this._accounts.hasAddress(account.address))
            return 'Bu adres zaten ekli';
        const credentials = {imap: password, smtp: password};
        try {
            const online = await this._withTrust(account, 'imap', () => this._engine.open(account, credentials), dialog);
            if (!online)
                throw new UserError('Sunucuya ulaşılamıyor. Sunucu adını ve bağlantı noktasını denetle.');
            await this._withTrust(account, 'smtp', () => this._engine.verifySmtp(account), dialog);
            await this._accounts.add(account, password);
        } catch (e) {
            logError(`adding ${account.address}`, e);
            await this._engine.close(account);
            return userMessage(e);
        }
        this._accountList.push(account);
        this._root.visible_child_name = 'main';
        const state = {status: 'ok', message: '', folders: []};
        this._states.set(account.id, state);
        try {
            state.folders = await this._engine.folders(account);
        } catch (e) {
            logError(`folders of ${account.address}`, e);
            Object.assign(state, {status: 'error', message: userMessage(e)});
        }
        this._rebuildSidebar();
        this._updateActions();
        const inbox = state.folders.find(f => f.role === 'inbox');
        if (inbox)
            this._sidebarList.select_row(this._folderRows.get(folderKey(account, inbox.fullName)).row);
        this.toast(`${account.address} eklendi`);
        return null;
    }

    async _reconnect() {
        if (!this._current)
            return;
        const {account, info} = this._current;
        await this._openAccount(account);
        const entry = this._folderRows.get(folderKey(account, info.fullName));
        if (entry) {
            this._current = null;
            this._sidebarList.select_row(entry.row);
        }
    }

    _scheduleRefresh() {
        if (this._refreshSource)
            GLib.source_remove(this._refreshSource);
        const seconds = this._settings.get_uint('refresh-minutes') * SECONDS_PER_MINUTE;
        this._refreshSource = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._refreshAll(false).catch(e => logError('periodic refresh', e));
            return GLib.SOURCE_CONTINUE;
        });
    }

    async _refreshAll(userInitiated) {
        for (const account of this._accountList) {
            if (this._states.get(account.id)?.status !== 'ok')
                continue;
            try {
                await this._refreshInbox(account);
            } catch (e) {
                logError(`refreshing ${account.address}`, e);
                if (userInitiated)
                    this.toast(`${account.address}: ${userMessage(e)}`);
            }
        }
        const current = this._current;
        if (current?.folder && current.info.role !== 'inbox') {
            await this._engine.refresh(current.account, current.folder);
            if (current === this._current)
                await this._syncList();
        }
    }

    async _refreshInbox(account) {
        const state = this._states.get(account.id);
        const info = state.folders.find(f => f.role === 'inbox');
        if (!info)
            return;
        const inbox = await this._engine.folder(account, info.fullName);
        const before = new Set(inbox.get_uids());
        await this._engine.refresh(account, inbox);
        const fresh = inbox.get_uids()
            .filter(uid => !before.has(uid))
            .map(uid => this._engine.summary(inbox, uid))
            .filter(record => record?.unread && !record.deleted);
        if (this._current?.folder === inbox)
            await this._syncList();
        if (fresh.length > 0 && !this.is_active)
            this._notify(account, fresh);
    }

    _notify(account, records) {
        const notification = new Gio.Notification();
        if (records.length === 1) {
            notification.set_title(records[0].sender);
            notification.set_body(records[0].subject);
        } else {
            notification.set_title(`${records.length} yeni ileti`);
            notification.set_body(account.address);
        }
        notification.set_icon(new Gio.ThemedIcon({name: 'mail-unread-symbolic'}));
        this.application.send_notification(`new-mail-${account.id}`, notification);
    }
});
