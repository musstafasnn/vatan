import 'resource:///org/gnome/shell/ui/environment.js';
import {
    formatCountdown, formatDuration, parseTimerCommand,
} from 'resource:///org/gnome/shell/misc/vatanTimer.js';

// Sabit bir yerel "şimdi", saat zamanlı durumları testlerin ne zaman çalıştığından bağımsız kılar.
const NOW = new Date(2026, 9, 5, 17, 0, 0);

describe('parseTimerCommand()', () => {
    it('reads a duration with the label before or after it', () => {
        expect(parseTimerCommand('çay 3 dk', NOW)).toEqual({seconds: 180, label: 'çay', at: null});
        expect(parseTimerCommand('25 dakika odak', NOW)).toEqual({seconds: 1500, label: 'odak', at: null});
    });

    it('adds up units and accepts them glued to the number', () => {
        expect(parseTimerCommand('1 saat 30 dk', NOW).seconds).toBe(5400);
        expect(parseTimerCommand('90sn', NOW).seconds).toBe(90);
        expect(parseTimerCommand('2SAAT', NOW).seconds).toBe(7200);
    });

    it('drops phrasing words but keeps the label as typed', () => {
        expect(parseTimerCommand('10 dk sonra Fırını kapat', NOW).label).toBe('Fırını kapat');
    });

    it('reads a clock time later today or tomorrow', () => {
        expect(parseTimerCommand('18:30 toplantı', NOW)).toEqual({seconds: 5400, label: 'toplantı', at: '18:30'});
        expect(parseTimerCommand('9.05', NOW)).toEqual({seconds: 16 * 3600 + 300, label: '', at: '09:05'});
    });

    it('rejects queries without a usable time', () => {
        expect(parseTimerCommand('çay', NOW)).toBeNull();
        expect(parseTimerCommand('ses 30', NOW)).toBeNull();
        expect(parseTimerCommand('0 dk', NOW)).toBeNull();
        expect(parseTimerCommand('25 saat', NOW)).toBeNull();
        expect(parseTimerCommand('24:00', NOW)).toBeNull();
        expect(parseTimerCommand('18:30 5 dk', NOW)).toBeNull();
    });
});

describe('formatDuration()', () => {
    it('names only the units in use', () => {
        expect(formatDuration(180)).toBe('3 dk');
        expect(formatDuration(5430)).toBe('1 sa 30 dk 30 sn');
        expect(formatDuration(45)).toBe('45 sn');
    });
});

describe('formatCountdown()', () => {
    it('shows hours only when needed', () => {
        expect(formatCountdown(179)).toBe('02:59');
        expect(formatCountdown(3723)).toBe('1:02:03');
    });
});
