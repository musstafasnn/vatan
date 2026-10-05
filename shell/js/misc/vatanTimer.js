import {foldTurkish} from './turkishText.js';

const UNIT_SECONDS = new Map([
    ['sn', 1],
    ['saniye', 1],
    ['dk', 60],
    ['dak', 60],
    ['dakika', 60],
    ['sa', 3600],
    ['saat', 3600],
]);
// Words that phrase a timer without naming it: "10 dk sonra", "çay için".
const FILLER = new Set(['sonra', 'icin', 'icinde', 'zamanlayici', 'hatirlat', 'hatirlatici', 'sayac']);
const MAX_SECONDS = 24 * 3600;

export function secondsUntil(hours, minutes, now) {
    const target = new Date(now);
    target.setHours(hours, minutes, 0, 0);
    if (target <= now)
        target.setDate(target.getDate() + 1);
    return Math.round((target - now) / 1000);
}

// Reads "çay 3 dk", "1 saat 30 dk", "90sn", "18:30 toplantı". The label keeps
// the user's own spelling; only the time words are folded for matching.
export function parseTimerCommand(query, now = new Date()) {
    const tokens = query.trim().split(/\s+/).filter(Boolean);
    const label = [];
    let seconds = 0;
    let at = null;

    for (let i = 0; i < tokens.length; i++) {
        const word = foldTurkish(tokens[i]);

        const clock = word.match(/^(\d{1,2})[:.](\d{2})$/);
        if (clock && !at && Number(clock[1]) < 24 && Number(clock[2]) < 60) {
            at = {hours: Number(clock[1]), minutes: Number(clock[2])};
            continue;
        }

        const joined = word.match(/^(\d+)([a-z]+)$/);
        if (joined && UNIT_SECONDS.has(joined[2])) {
            seconds += Number(joined[1]) * UNIT_SECONDS.get(joined[2]);
            continue;
        }

        const unit = i + 1 < tokens.length ? foldTurkish(tokens[i + 1]) : '';
        if (/^\d+$/.test(word) && UNIT_SECONDS.has(unit)) {
            seconds += Number(word) * UNIT_SECONDS.get(unit);
            i++;
            continue;
        }

        if (!FILLER.has(word))
            label.push(tokens[i]);
    }

    // "18:30 5 dk" names two different moments; refuse rather than guess.
    if (at && seconds)
        return null;
    if (at)
        seconds = secondsUntil(at.hours, at.minutes, now);
    if (seconds <= 0 || seconds > MAX_SECONDS)
        return null;

    const pad = n => String(n).padStart(2, '0');
    return {
        seconds,
        label: label.join(' '),
        at: at ? `${pad(at.hours)}:${pad(at.minutes)}` : null,
    };
}

export function formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = seconds % 60;
    return [h && `${h} sa`, m && `${m} dk`, s && `${s} sn`].filter(Boolean).join(' ');
}

export function formatCountdown(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor(seconds % 3600 / 60);
    const s = seconds % 60;
    const pad = n => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
