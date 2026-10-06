const ENTITIES = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', "'"],
]);
const MAX_TITLE_LENGTH = 200;

function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name) => {
        if (name[0] !== '#')
            return ENTITIES.get(name.toLowerCase()) ?? match;
        const code = name[1].toLowerCase() === 'x'
            ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}

function tagText(item, tag) {
    const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
    if (!match)
        return '';
    const cdata = match[1].match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
    const raw = cdata ? cdata[1] : decodeEntities(match[1]);
    return raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

// Feed uzaktan gelen bir girdidir: başlık sınırlanır ve link https olmalıdır ki
// hazırlanmış bir öğe launcher'a file:// ya da özel şemalı bir URI veremesin.
export function parseRssItems(xml, max) {
    const items = [];
    for (const [item] of xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
        const title = tagText(item, 'title').slice(0, MAX_TITLE_LENGTH);
        const link = tagText(item, 'link');
        if (!title || !/^https:\/\/[^\s]+$/i.test(link))
            continue;
        const date = new Date(tagText(item, 'pubDate'));
        items.push({title, link, date: Number.isNaN(date.getTime()) ? null : date});
        if (items.length === max)
            break;
    }
    return items;
}

export function relativeTime(date, now = new Date()) {
    if (!date)
        return '';
    const minutes = Math.floor((now - date) / 60000);
    if (minutes < 1)
        return 'şimdi';
    if (minutes < 60)
        return `${minutes} dk önce`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} sa önce`;
    return hours < 48 ? 'dün' : `${Math.floor(hours / 24)} gün önce`;
}
