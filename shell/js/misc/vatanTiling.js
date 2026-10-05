// Corners are named by the quarter of the work area they select.
export const Corner = {
    TOP_LEFT: 'top-left',
    TOP_RIGHT: 'top-right',
    BOTTOM_LEFT: 'bottom-left',
    BOTTOM_RIGHT: 'bottom-right',
};

// area: {x, y, width, height}; size: how far into the area a corner reaches.
// The pointer may also be past the area (over the island or a screen edge),
// so only the inner bound of each corner is checked.
export function cornerAt(px, py, area, size) {
    const left = px <= area.x + size;
    const right = px >= area.x + area.width - size;
    const top = py <= area.y + size;
    const bottom = py >= area.y + area.height - size;
    if (top && left)
        return Corner.TOP_LEFT;
    if (top && right)
        return Corner.TOP_RIGHT;
    if (bottom && left)
        return Corner.BOTTOM_LEFT;
    if (bottom && right)
        return Corner.BOTTOM_RIGHT;
    return null;
}

// Odd sizes give the extra pixel to the right/bottom quarter so the four
// quarters cover the area exactly.
export function quarterRect(area, corner) {
    const leftWidth = Math.floor(area.width / 2);
    const topHeight = Math.floor(area.height / 2);
    const right = corner === Corner.TOP_RIGHT || corner === Corner.BOTTOM_RIGHT;
    const bottom = corner === Corner.BOTTOM_LEFT || corner === Corner.BOTTOM_RIGHT;
    return {
        x: area.x + (right ? leftWidth : 0),
        y: area.y + (bottom ? topHeight : 0),
        width: right ? area.width - leftWidth : leftWidth,
        height: bottom ? area.height - topHeight : topHeight,
    };
}

export function halfRect(area, side) {
    const leftWidth = Math.floor(area.width / 2);
    return {
        x: area.x + (side === 'right' ? leftWidth : 0),
        y: area.y,
        width: side === 'right' ? area.width - leftWidth : leftWidth,
        height: area.height,
    };
}

// Which half a frame fills, within a few pixels of client-side rounding.
export function halfSideOf(frame, area, tolerance = 2) {
    const near = (a, b) => Math.abs(a - b) <= tolerance;
    for (const side of ['left', 'right']) {
        const half = halfRect(area, side);
        if (near(frame.x, half.x) && near(frame.width, half.width) &&
            near(frame.y, half.y) && near(frame.height, half.height))
            return side;
    }
    return null;
}

// Super+Up/Down from a given placement: half → quarter of that side, quarter
// → back to the half (or out to maximize/minimize at the ends), like the
// snapping keys people already know from Windows.
export function nextPlacement(current, up) {
    if (!current)
        return up ? {action: 'maximize'} : {action: 'unmaximize'};
    if (current.half) {
        const corner = `${up ? 'top' : 'bottom'}-${current.half}`;
        return {action: 'quarter', corner};
    }
    const [vertical, side] = current.quarter.split('-');
    if (vertical === 'top')
        return up ? {action: 'maximize'} : {action: 'half', side};
    return up ? {action: 'half', side} : {action: 'minimize'};
}
