import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from '../panelMenu.js';
import {MprisSource} from '../mpris.js';

// The island's media section: whatever MPRIS player is playing (or, failing
// that, the first one with a track) with play/pause and next. It hides when
// no player has anything to show.
export const VatanMediaButton = GObject.registerClass(
class VatanMediaButton extends PanelMenu.Button {
    _init() {
        super._init(0.5, _('Medya'), true);

        this.add_style_class_name('vatan-media');

        const box = new St.BoxLayout({style_class: 'vatan-media-box'});
        this._playButton = this._createControl(() => this._player?.playPause());
        box.add_child(this._playButton);

        this._title = new St.Label({
            style_class: 'vatan-media-title',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const titleButton = new St.Button({
            child: this._title,
            can_focus: true,
            accessible_name: _('Oynatıcıyı göster'),
        });
        titleButton.connect('clicked', () => this._player?.raise());
        box.add_child(titleButton);

        this._nextButton = this._createControl(() => this._player?.next());
        this._nextButton.child.icon_name = 'media-skip-forward-symbolic';
        this._nextButton.accessible_name = _('Sonraki');
        box.add_child(this._nextButton);
        this.add_child(box);

        this._players = new Set();
        this._player = null;
        this._source = new MprisSource();
        this._source.connectObject(
            'player-added', (_s, player) => this._track(player),
            'player-removed', (_s, player) => this._untrack(player),
            this);

        this._sync();
    }

    _createControl(onClick) {
        const button = new St.Button({
            style_class: 'vatan-media-control',
            can_focus: true,
            child: new St.Icon({icon_name: 'media-playback-start-symbolic', style_class: 'popup-menu-icon'}),
        });
        button.connect('clicked', onClick);
        return button;
    }

    _track(player) {
        this._players.add(player);
        player.connectObject('changed', () => this._sync(), this);
        this._sync();
    }

    _untrack(player) {
        this._players.delete(player);
        player.disconnectObject(this);
        this._sync();
    }

    _sync() {
        const players = [...this._players].filter(p => p.canPlay && p.trackTitle);
        this._player = players.find(p => p.status === 'Playing') ?? players[0] ?? null;
        this.visible = !!this._player;
        if (!this._player)
            return;

        const {trackTitle, trackArtists, status} = this._player;
        const artists = trackArtists.join(', ');
        this._title.text = artists ? `${trackTitle} · ${artists}` : trackTitle;

        const playing = status === 'Playing';
        this._playButton.child.icon_name = playing
            ? 'media-playback-pause-symbolic' : 'media-playback-start-symbolic';
        this._playButton.accessible_name = playing ? _('Duraklat') : _('Oynat');
        this._nextButton.visible = this._player.canGoNext;
    }
});
