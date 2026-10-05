import 'resource:///org/gnome/shell/ui/environment.js';
import {
    Corner, cornerAt, halfRect, halfSideOf, nextPlacement, quarterRect,
} from 'resource:///org/gnome/shell/misc/vatanTiling.js';

// A 1280x800 screen with the island taking the bottom 80 px.
const AREA = {x: 0, y: 0, width: 1281, height: 720};

describe('cornerAt()', () => {
    it('finds the four corners, also past the area edge', () => {
        expect(cornerAt(5, 5, AREA, 48)).toBe(Corner.TOP_LEFT);
        expect(cornerAt(1279, 10, AREA, 48)).toBe(Corner.TOP_RIGHT);
        expect(cornerAt(3, 790, AREA, 48)).toBe(Corner.BOTTOM_LEFT);
        expect(cornerAt(1270, 700, AREA, 48)).toBe(Corner.BOTTOM_RIGHT);
    });

    it('ignores edges away from corners', () => {
        expect(cornerAt(2, 360, AREA, 48)).toBeNull();
        expect(cornerAt(640, 2, AREA, 48)).toBeNull();
    });
});

describe('quarterRect() and halfRect()', () => {
    it('tile the area exactly, odd pixel to the right and bottom', () => {
        expect(quarterRect(AREA, Corner.TOP_LEFT)).toEqual({x: 0, y: 0, width: 640, height: 360});
        expect(quarterRect(AREA, Corner.BOTTOM_RIGHT)).toEqual({x: 640, y: 360, width: 641, height: 360});
        expect(halfRect(AREA, 'right')).toEqual({x: 640, y: 0, width: 641, height: 720});
    });

    it('recognizes a half within the rounding tolerance', () => {
        expect(halfSideOf({x: 1, y: 0, width: 639, height: 720}, AREA)).toBe('left');
        expect(halfSideOf({x: 640, y: 0, width: 641, height: 720}, AREA)).toBe('right');
        expect(halfSideOf({x: 100, y: 0, width: 640, height: 720}, AREA)).toBeNull();
    });
});

describe('nextPlacement()', () => {
    it('steps half → quarter → half like the Windows snap keys', () => {
        expect(nextPlacement({half: 'left'}, true)).toEqual({action: 'quarter', corner: 'top-left'});
        expect(nextPlacement({half: 'right'}, false)).toEqual({action: 'quarter', corner: 'bottom-right'});
        expect(nextPlacement({quarter: 'top-left'}, false)).toEqual({action: 'half', side: 'left'});
        expect(nextPlacement({quarter: 'bottom-right'}, true)).toEqual({action: 'half', side: 'right'});
    });

    it('leaves the ends to maximize and minimize', () => {
        expect(nextPlacement({quarter: 'top-left'}, true)).toEqual({action: 'maximize'});
        expect(nextPlacement({quarter: 'bottom-left'}, false)).toEqual({action: 'minimize'});
        expect(nextPlacement(null, true)).toEqual({action: 'maximize'});
        expect(nextPlacement(null, false)).toEqual({action: 'unmaximize'});
    });
});
