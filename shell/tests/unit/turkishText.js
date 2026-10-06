import 'resource:///org/gnome/shell/ui/environment.js';
import {foldTurkish, matchScore, parseLevelCommand} from 'resource:///org/gnome/shell/misc/turkishText.js';

describe('foldTurkish()', () => {
    it('lowercases with Turkish dotted/dotless rules', () => {
        expect(foldTurkish('IŞIK')).toBe('isik');
        expect(foldTurkish('İzmir')).toBe('izmir');
    });

    it('drops diacritics so ASCII queries match', () => {
        expect(foldTurkish('Parlaklık Göz Çağrı Ünlü')).toBe('parlaklik goz cagri unlu');
    });
});

describe('matchScore()', () => {
    it('ranks title prefix over word prefix over substring', () => {
        expect(matchScore('Karanlık moda geç', '', 'kar')).toBe(4);
        expect(matchScore('Odak modunu aç', '', 'mod')).toBe(3);
        expect(matchScore('Uçbirim', '', 'bir')).toBe(2);
    });

    it('falls back to keywords', () => {
        expect(matchScore('Uçbirim', 'terminal konsol', 'term')).toBe(1.5);
    });

    it('returns 0 for no match and for blank queries', () => {
        expect(matchScore('Dosyalar', 'klasör', 'xyz')).toBe(0);
        expect(matchScore('Dosyalar', '', '   ')).toBe(0);
    });

    it('matches without Turkish characters', () => {
        expect(matchScore('Gece ışığını aç', '', 'gece isi')).toBe(4);
    });
});

describe('parseLevelCommand()', () => {
    it('parses brightness and volume with optional percent sign', () => {
        expect(parseLevelCommand('parlaklık 40')).toEqual({target: 'brightness', percent: 40});
        expect(parseLevelCommand('Işık %25')).toEqual({target: 'brightness', percent: 25});
        expect(parseLevelCommand('ses 30%')).toEqual({target: 'volume', percent: 30});
    });

    it('clamps to 100', () => {
        expect(parseLevelCommand('ses 250')).toEqual({target: 'volume', percent: 100});
    });

    it('rejects anything else', () => {
        expect(parseLevelCommand('ses')).toBeNull();
        expect(parseLevelCommand('ses -5')).toBeNull();
        expect(parseLevelCommand('parlaklık 4000')).toBeNull();
        expect(parseLevelCommand('dosyalar')).toBeNull();
    });
});
