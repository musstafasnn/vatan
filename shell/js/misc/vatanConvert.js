import {foldTurkish} from './turkishText.js';

// Her türün temel birimine çarpanlar: metre, kilogram, litre.
const UNITS = new Map([
    ['km', {kind: 'length', factor: 1000, name: 'km'}],
    ['m', {kind: 'length', factor: 1, name: 'm'}],
    ['cm', {kind: 'length', factor: 0.01, name: 'cm'}],
    ['mm', {kind: 'length', factor: 0.001, name: 'mm'}],
    ['mi', {kind: 'length', factor: 1609.344, name: 'mil'}],
    ['yd', {kind: 'length', factor: 0.9144, name: 'yarda'}],
    ['ft', {kind: 'length', factor: 0.3048, name: 'ft'}],
    ['in', {kind: 'length', factor: 0.0254, name: 'inç'}],
    ['t', {kind: 'mass', factor: 1000, name: 'ton'}],
    ['kg', {kind: 'mass', factor: 1, name: 'kg'}],
    ['g', {kind: 'mass', factor: 0.001, name: 'g'}],
    ['lb', {kind: 'mass', factor: 0.45359237, name: 'lb'}],
    ['oz', {kind: 'mass', factor: 0.028349523125, name: 'ons'}],
    ['l', {kind: 'volume', factor: 1, name: 'L'}],
    ['ml', {kind: 'volume', factor: 0.001, name: 'mL'}],
    ['gal', {kind: 'volume', factor: 3.785411784, name: 'galon'}],
    ['C', {kind: 'temperature', name: '°C'}],
    ['F', {kind: 'temperature', name: '°F'}],
    ['K', {kind: 'temperature', name: 'K'}],
]);

const CURRENCY_NAMES = new Map([
    ['TRY', 'TL'], ['USD', 'dolar'], ['EUR', 'euro'], ['GBP', 'sterlin'],
    ['CHF', 'İsviçre frangı'], ['JPY', 'yen'], ['SAR', 'riyal'], ['AZN', 'manat'],
    ['RUB', 'ruble'], ['CNY', 'yuan'],
]);

// İnsanların yazdığı katlanmış (folded) yazımlar; birim ya da ISO para birimi
// koduna eşlenir.
const ALIASES = new Map(Object.entries({
    km: 'km', kilometre: 'km', m: 'm', metre: 'm', cm: 'cm', santim: 'cm', santimetre: 'cm',
    mm: 'mm', milimetre: 'mm', mil: 'mi', mile: 'mi', yarda: 'yd', yd: 'yd',
    ft: 'ft', feet: 'ft', ayak: 'ft', inc: 'in', inch: 'in',
    ton: 't', kg: 'kg', kilo: 'kg', kilogram: 'kg', g: 'g', gr: 'g', gram: 'g',
    lb: 'lb', libre: 'lb', pound: 'lb', ons: 'oz', oz: 'oz',
    l: 'l', lt: 'l', litre: 'l', ml: 'ml', mililitre: 'ml', galon: 'gal', gal: 'gal',
    c: 'C', santigrat: 'C', celsius: 'C', f: 'F', fahrenhayt: 'F', fahrenheit: 'F', kelvin: 'K',
    tl: 'TRY', try: 'TRY', lira: 'TRY',
    dolar: 'USD', usd: 'USD', $: 'USD',
    euro: 'EUR', avro: 'EUR', eur: 'EUR', '€': 'EUR',
    sterlin: 'GBP', gbp: 'GBP', '£': 'GBP',
    frank: 'CHF', chf: 'CHF', yen: 'JPY', jpy: 'JPY', riyal: 'SAR', sar: 'SAR',
    manat: 'AZN', azn: 'AZN', ruble: 'RUB', rub: 'RUB', yuan: 'CNY', cny: 'CNY',
}));
const LINK_WORDS = new Set(['kac', 'ne', 'kadar', 'eder', 'to', '=', '->', 'in']);

export function isCurrency(code) {
    return CURRENCY_NAMES.has(code);
}

export function unitName(code) {
    return CURRENCY_NAMES.get(code) ?? UNITS.get(code)?.name ?? code;
}

// Türkçede "1.000" bin, "1,5" bir buçuktur; arkasında üç haneden farklı sayıda
// rakam olan tek bir nokta ondalık ayraç olarak okunur.
export function parseTurkishNumber(text) {
    let normalized = text;
    if (text.includes(','))
        normalized = text.replaceAll('.', '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(text))
        normalized = text.replaceAll('.', '');
    if (!/^\d+(\.\d+)?$/.test(normalized))
        return null;
    return Number(normalized);
}

export function parseConversion(query) {
    const tokens = foldTurkish(query.trim()).split(/\s+/).filter(t => !LINK_WORDS.has(t));
    if (tokens.length < 2 || tokens.length > 3)
        return null;

    const amount = parseTurkishNumber(tokens[0]);
    const from = ALIASES.get(tokens[1]);
    if (amount === null || !from)
        return null;

    let to = tokens.length === 3 ? ALIASES.get(tokens[2]) : null;
    if (tokens.length === 3 && !to)
        return null;
    if (!to) {
        // Yalın bir tutar yalnızca para için anlamlıdır: "100 dolar" lira karşılığı demektir.
        if (!isCurrency(from) || from === 'TRY')
            return null;
        to = 'TRY';
    }
    if (from === to || isCurrency(from) !== isCurrency(to))
        return null;
    if (!isCurrency(from) && UNITS.get(from).kind !== UNITS.get(to).kind)
        return null;
    return {amount, from, to};
}

function toCelsius(value, unit) {
    if (unit === 'F')
        return (value - 32) * 5 / 9;
    return unit === 'K' ? value - 273.15 : value;
}

function fromCelsius(value, unit) {
    if (unit === 'F')
        return value * 9 / 5 + 32;
    return unit === 'K' ? value + 273.15 : value;
}

export function convertUnits(amount, from, to) {
    if (UNITS.get(from).kind === 'temperature')
        return fromCelsius(toCelsius(amount, from), to);
    return amount * UNITS.get(from).factor / UNITS.get(to).factor;
}

// rates: her para biriminin bir birimi için lira; TRY örtüktür.
export function convertCurrency(amount, from, to, rates) {
    const rate = code => code === 'TRY' ? 1 : rates.get(code);
    if (!rate(from) || !rate(to))
        return null;
    return amount * rate(from) / rate(to);
}

// TCMB bazı para birimlerini 100 birim için kotalar (JPY); Unit elemanı kaç
// olduğunu söyler.
export function parseTcmbRates(xml) {
    const rates = new Map();
    for (const [block, code] of xml.matchAll(/<Currency\b[^>]*CurrencyCode="([A-Z]{3})"[^>]*>[\s\S]*?<\/Currency>/g)) {
        const unit = Number(block.match(/<Unit>(\d+)<\/Unit>/)?.[1]);
        const selling = Number(block.match(/<ForexSelling>([\d.]+)<\/ForexSelling>/)?.[1]);
        if (unit > 0 && selling > 0)
            rates.set(code, selling / unit);
    }
    const date = xml.match(/<Tarih_Date\b[^>]*Tarih="([\d.]+)"/)?.[1] ?? null;
    return {date, rates};
}

export function formatAmount(value, isMoney) {
    return value.toLocaleString('tr-TR', {
        minimumFractionDigits: isMoney ? 2 : 0,
        maximumFractionDigits: isMoney ? 2 : 4,
    });
}
