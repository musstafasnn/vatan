import 'resource:///org/gnome/shell/ui/environment.js';
import {rankActions} from 'resource:///org/gnome/shell/misc/vatanActions.js';

const ACTIONS = [
    {id: 'theme', title: 'Karanlık moda geç', keywords: 'tema koyu gece'},
    {id: 'focus', title: 'Odak modunu aç', keywords: 'bildirim sessiz rahatsız etme'},
    {id: 'lock', title: 'Ekranı kilitle', keywords: 'kilit oturum'},
];

describe('rankActions()', () => {
    it('orders by score then table order', () => {
        expect(rankActions(ACTIONS, 'mod')).toEqual(['theme', 'focus']);
    });

    it('uses keywords', () => {
        expect(rankActions(ACTIONS, 'sessiz')).toEqual(['focus']);
    });

    it('returns nothing for an empty query', () => {
        expect(rankActions(ACTIONS, '')).toEqual([]);
    });
});
