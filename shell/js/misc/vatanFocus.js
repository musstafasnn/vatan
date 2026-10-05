// "HH:MM" → minutes after midnight, or null for anything else.
export function parseClock(text) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
    if (!match)
        return null;
    const [hours, minutes] = [Number(match[1]), Number(match[2])];
    return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

// A window like 22:00–07:00 runs past midnight; it belongs to the day it
// started on, so "weekdays only" keeps Friday night but drops Saturday's.
export function inFocusWindow(now, start, end, weekdaysOnly) {
    const from = parseClock(start);
    const to = parseClock(end);
    if (from === null || to === null || from === to)
        return false;

    const minute = now.getHours() * 60 + now.getMinutes();
    const overnight = from > to;
    const inside = overnight ? minute >= from || minute < to : minute >= from && minute < to;
    if (!inside || !weekdaysOnly)
        return inside;

    const startedYesterday = overnight && minute < to;
    const day = (now.getDay() + (startedYesterday ? 6 : 0)) % 7;
    return day >= 1 && day <= 5;
}
