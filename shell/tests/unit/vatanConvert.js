import 'resource:///org/gnome/shell/ui/environment.js';
import {
    convertCurrency, convertUnits, formatAmount, parseConversion, parseTcmbRates, parseTurkishNumber,
} from 'resource:///org/gnome/shell/misc/vatanConvert.js';

describe('parseTurkishNumber()', () => {
    it('reads Turkish thousands and decimal separators', () => {
        expect(parseTurkishNumber('1.000')).toBe(1000);
        expect(parseTurkishNumber('1.250,75')).toBe(1250.75);
        expect(parseTurkishNumber('1,5')).toBe(1.5);
        expect(parseTurkishNumber('2.5')).toBe(2.5);
        expect(parseTurkishNumber('abc')).toBeNull();
        expect(parseTurkishNumber('-5')).toBeNull();
    });
});

describe('parseConversion()', () => {
    it('reads money with or without a target', () => {
        expect(parseConversion('100 dolar kaç tl')).toEqual({amount: 100, from: 'USD', to: 'TRY'});
        expect(parseConversion('50 Euro')).toEqual({amount: 50, from: 'EUR', to: 'TRY'});
        expect(parseConversion('1.000 tl dolar')).toEqual({amount: 1000, from: 'TRY', to: 'USD'});
    });

    it('reads units of the same kind', () => {
        expect(parseConversion('5 km kaç mil')).toEqual({amount: 5, from: 'km', to: 'mi'});
        expect(parseConversion('100 F C')).toEqual({amount: 100, from: 'F', to: 'C'});
    });

    it('rejects mixed kinds and non-conversions', () => {
        expect(parseConversion('5 km kg')).toBeNull();
        expect(parseConversion('5 kg dolar')).toBeNull();
        expect(parseConversion('5 km')).toBeNull();
        expect(parseConversion('100 tl')).toBeNull();
        expect(parseConversion('ses 30')).toBeNull();
        expect(parseConversion('çay 3 dk')).toBeNull();
    });
});

describe('convertUnits()', () => {
    it('converts lengths, masses and temperatures', () => {
        expect(convertUnits(5, 'km', 'mi')).toBeCloseTo(3.10686, 4);
        expect(convertUnits(1, 'lb', 'g')).toBeCloseTo(453.59237, 4);
        expect(convertUnits(100, 'F', 'C')).toBeCloseTo(37.7778, 3);
        expect(convertUnits(0, 'C', 'K')).toBeCloseTo(273.15, 6);
    });
});

describe('TCMB rates', () => {
    const XML = `<Tarih_Date Tarih="05.10.2026" Date="10/05/2026">
        <Currency CrossOrder="0" Kod="USD" CurrencyCode="USD"><Unit>1</Unit>
            <ForexBuying>41.5</ForexBuying><ForexSelling>41.6</ForexSelling></Currency>
        <Currency CrossOrder="5" Kod="JPY" CurrencyCode="JPY"><Unit>100</Unit>
            <ForexSelling>31.2</ForexSelling></Currency>
        <Currency Kod="XDR" CurrencyCode="XDR"><Unit>1</Unit><ForexSelling></ForexSelling></Currency>
    </Tarih_Date>`;

    it('reads selling rates per single unit and the bulletin date', () => {
        const {date, rates} = parseTcmbRates(XML);
        expect(date).toBe('05.10.2026');
        expect(rates.get('USD')).toBe(41.6);
        expect(rates.get('JPY')).toBeCloseTo(0.312, 6);
        expect(rates.has('XDR')).toBeFalse();
    });

    it('converts through lira in both directions', () => {
        const {rates} = parseTcmbRates(XML);
        expect(convertCurrency(100, 'USD', 'TRY', rates)).toBeCloseTo(4160, 6);
        expect(convertCurrency(416, 'TRY', 'USD', rates)).toBeCloseTo(10, 6);
        expect(convertCurrency(1, 'USD', 'GBP', rates)).toBeNull();
    });
});

describe('formatAmount()', () => {
    it('uses Turkish separators', () => {
        expect(formatAmount(4160, true)).toBe('4.160,00');
        expect(formatAmount(3.106856, false)).toBe('3,1069');
    });
});
