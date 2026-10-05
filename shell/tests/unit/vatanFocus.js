import 'resource:///org/gnome/shell/ui/environment.js';
import {inFocusWindow, parseClock} from 'resource:///org/gnome/shell/misc/vatanFocus.js';

// 5 Ekim 2026 bir Pazartesi'dir.
const at = (day, hours, minutes = 0) => new Date(2026, 9, day, hours, minutes);

describe('parseClock()', () => {
    it('reads HH:MM and rejects the rest', () => {
        expect(parseClock('09:00')).toBe(540);
        expect(parseClock(' 7:30 ')).toBe(450);
        expect(parseClock('24:00')).toBeNull();
        expect(parseClock('9.00')).toBeNull();
    });
});

describe('inFocusWindow()', () => {
    it('covers a daytime window, end exclusive', () => {
        expect(inFocusWindow(at(5, 9), '09:00', '17:00', false)).toBeTrue();
        expect(inFocusWindow(at(5, 16, 59), '09:00', '17:00', false)).toBeTrue();
        expect(inFocusWindow(at(5, 17), '09:00', '17:00', false)).toBeFalse();
    });

    it('skips weekends when asked', () => {
        expect(inFocusWindow(at(10, 10), '09:00', '17:00', true)).toBeFalse();
        expect(inFocusWindow(at(10, 10), '09:00', '17:00', false)).toBeTrue();
    });

    it('runs past midnight and keeps Friday night', () => {
        expect(inFocusWindow(at(5, 23), '22:00', '07:00', false)).toBeTrue();
        expect(inFocusWindow(at(6, 6, 59), '22:00', '07:00', false)).toBeTrue();
        expect(inFocusWindow(at(10, 3), '22:00', '07:00', true)).toBeTrue();
        expect(inFocusWindow(at(11, 3), '22:00', '07:00', true)).toBeFalse();
    });

    it('treats bad or empty windows as off', () => {
        expect(inFocusWindow(at(5, 10), '10:00', '10:00', false)).toBeFalse();
        expect(inFocusWindow(at(5, 10), 'sabah', '17:00', false)).toBeFalse();
    });
});
