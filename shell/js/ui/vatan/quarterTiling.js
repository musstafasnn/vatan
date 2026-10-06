import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Mtk from 'gi://Mtk';
import Shell from 'gi://Shell';

import * as Main from '../main.js';
import {cornerAt, halfRect, halfSideOf, nextPlacement, quarterRect} from '../../misc/vatanTiling.js';

const CORNER_REACH_PX = 48;
// Mutter pencere taşıma sırasında işaretçi hareketini bildirmez, bu yüzden köşe
// tutma sürerken işaretçi örneklenerek bulunur.
const POLL_MS = 40;
const MOVE_OPS = [Meta.GrabOp.MOVING, Meta.GrabOp.KEYBOARD_MOVING, Meta.GrabOp.MOVING_UNCONSTRAINED];
// Mutter son sürükleme konumunu grab-op-end'den sonra uygular; hemen yapılan bir
// yerleştirme boyutunu koruyabilir ama konumunu o taşımaya kaptırabilir.
const SETTLE_MS = 150;
const POSITION_TOLERANCE_PX = 2;

function workArea(window) {
    return Main.layoutManager.getWorkAreaForMonitor(window.get_monitor());
}

function toMtk({x, y, width, height}) {
    return new Mtk.Rectangle({x, y, width, height});
}

// Mutter 48 yalnızca yarıları döşer (tile). VATAN çeyrekleri ekler: bir pencereyi
// köşeye sürükle ya da yarım döşenmiş pencerede Super+Up/Down'a bas.
export class VatanQuarterTiling {
    constructor() {
        this._quarters = new WeakMap();
        this._dragWindow = null;
        this._pendingCorner = null;
        this._pollId = 0;

        global.display.connectObject(
            'grab-op-begin', (_display, window, op) => this._onGrabBegin(window, op),
            'grab-op-end', (_display, window, op) => this._onGrabEnd(window, op),
            this);

        Main.wm.setCustomKeybindingHandler('maximize', Shell.ActionMode.NORMAL,
            (_display, window) => this._onSnapKey(window, true));
        Main.wm.setCustomKeybindingHandler('unmaximize', Shell.ActionMode.NORMAL,
            (_display, window) => this._onSnapKey(window, false));
    }

    // Bir köşe seçiliyken döşeme önizlemesi bize aittir ve Mutter'ın yarım ekran
    // önizleme istekleri yok sayılır.
    get ownsPreview() {
        return this._pendingCorner !== null;
    }

    _onGrabBegin(window, op) {
        if (!window || window.window_type !== Meta.WindowType.NORMAL || !MOVE_OPS.includes(op))
            return;
        this._dragWindow = window;
        this._quarters.delete(window);
        this._pollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => this._poll());
        GLib.Source.set_name_by_id(this._pollId, '[gnome-shell] VatanQuarterTiling.poll');
    }

    _poll() {
        const window = this._dragWindow;
        if (!window)
            return GLib.SOURCE_REMOVE;

        const [x, y] = global.get_pointer();
        const area = workArea(window);
        const corner = cornerAt(x, y, area, CORNER_REACH_PX);
        if (corner === this._pendingCorner)
            return GLib.SOURCE_CONTINUE;

        this._pendingCorner = corner;
        if (corner)
            Main.wm.showVatanTilePreview(window, toMtk(quarterRect(area, corner)), window.get_monitor());
        else
            Main.wm.hideVatanTilePreview();
        return GLib.SOURCE_CONTINUE;
    }

    _onGrabEnd(window) {
        if (this._pollId) {
            GLib.source_remove(this._pollId);
            this._pollId = 0;
        }
        const corner = this._pendingCorner;
        this._pendingCorner = null;
        this._dragWindow = null;
        if (!corner || !window)
            return;

        Main.wm.hideVatanTilePreview();
        this._placeQuarter(window, corner);
        const settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            const target = quarterRect(workArea(window), corner);
            const frame = window.get_frame_rect();
            if (Math.abs(frame.x - target.x) > POSITION_TOLERANCE_PX ||
                Math.abs(frame.y - target.y) > POSITION_TOLERANCE_PX)
                this._placeQuarter(window, corner);
            return GLib.SOURCE_REMOVE;
        });
        GLib.Source.set_name_by_id(settleId, '[gnome-shell] VatanQuarterTiling.settle');
    }

    _placeQuarter(window, corner) {
        this._place(window, quarterRect(workArea(window), corner));
        this._quarters.set(window, corner);
    }

    _place(window, rect) {
        if (window.get_maximized())
            window.unmaximize(Meta.MaximizeFlags.BOTH);
        window.move_resize_frame(true, rect.x, rect.y, rect.width, rect.height);
    }

    _currentPlacement(window) {
        const area = workArea(window);
        const frame = window.get_frame_rect();
        const quarter = this._quarters.get(window);
        if (quarter) {
            const rect = quarterRect(area, quarter);
            // Kullanıcı bu arada taşımış olabilir; yalnızca hâlâ sığan bir çeyreğe güven.
            if (Math.abs(frame.x - rect.x) <= POSITION_TOLERANCE_PX &&
                Math.abs(frame.y - rect.y) <= POSITION_TOLERANCE_PX)
                return {quarter};
            this._quarters.delete(window);
        }
        const half = halfSideOf(frame, area);
        return half ? {half} : null;
    }

    _onSnapKey(window, up) {
        if (!window || window.window_type !== Meta.WindowType.NORMAL)
            return;

        const next = nextPlacement(this._currentPlacement(window), up);
        switch (next.action) {
        case 'quarter':
            this._placeQuarter(window, next.corner);
            break;
        case 'half':
            this._quarters.delete(window);
            this._place(window, halfRect(workArea(window), next.side));
            break;
        case 'maximize':
            this._quarters.delete(window);
            window.maximize(Meta.MaximizeFlags.BOTH);
            break;
        case 'minimize':
            this._quarters.delete(window);
            window.minimize();
            break;
        default:
            if (window.get_maximized())
                window.unmaximize(Meta.MaximizeFlags.BOTH);
        }
    }
}
