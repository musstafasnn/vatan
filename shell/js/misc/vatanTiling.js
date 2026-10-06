// Köşeler, seçtikleri çalışma alanı çeyreğinin adıyla anılır.
export const Corner = {
    TOP_LEFT: 'top-left',
    TOP_RIGHT: 'top-right',
    BOTTOM_LEFT: 'bottom-left',
    BOTTOM_RIGHT: 'bottom-right',
};

// area: {x, y, width, height}; size: köşenin alana ne kadar girdiği.
// İşaretçi alanın dışında da olabilir (ada üzerinde ya da ekran kenarında),
// bu yüzden her köşenin yalnızca iç sınırı kontrol edilir.
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

// Tek sayılı boyutlarda fazladan piksel sağ/alt çeyreğe verilir, böylece dört
// çeyrek alanı tam olarak kaplar.
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

// Bir çerçevenin hangi yarıyı doldurduğu, istemci tarafı yuvarlamanın birkaç
// piksellik toleransıyla.
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

// Verilen bir yerleşimden Super+Up/Down: yarı → o tarafın çeyreği, çeyrek
// → yarıya geri (ya da uçlarda büyüt/küçült), insanların Windows'tan zaten
// bildiği yerleştirme (snap) tuşları gibi.
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
