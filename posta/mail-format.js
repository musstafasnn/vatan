import GLib from 'gi://GLib';

const MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const FALLBACK_FILENAME = 'ek';
const MAX_FILENAME_LENGTH = 200;

// Posta istemcileri yanıt öneklerini kendi dillerinde yazar; hepsini söküp tek
// bir "Ynt:" koymazsak konu her yanıtta "Ynt: Re: AW: ..." diye büyür.
const PREFIX_RE = /^\s*(?:re|ynt|cvp|aw|sv|fw|fwd|ilt|i̇lt|İlt|ılt|wg|tr)\s*(?:\[\d+\])?\s*:\s*/iu;

// Ad kısmındaki CR/LF başlığa yeni satır olarak sızarsa gönderilen iletiye
// başlık eklenebilir; adresler bu yüzden denetim karakterlerinden arındırılır.
const CONTROL_RE = /[\u0000-\u001f\u007f]/g;
const EMAIL_RE = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+$/;

export function splitAddressList(text) {
    const parts = [];
    let current = '';
    let quoted = false;
    let angle = false;
    for (const ch of text ?? '') {
        if (ch === '"' && !angle)
            quoted = !quoted;
        else if (ch === '<' && !quoted)
            angle = true;
        else if (ch === '>' && !quoted)
            angle = false;
        if ((ch === ',' || ch === ';') && !quoted && !angle) {
            parts.push(current);
            current = '';
            continue;
        }
        current += ch;
    }
    parts.push(current);
    return parts.map(p => p.trim()).filter(p => p.length > 0);
}

function parseOneAddress(token) {
    const clean = token.replace(CONTROL_RE, ' ').trim();
    const angled = /^(.*)<([^<>]*)>\s*$/.exec(clean);
    const name = angled ? angled[1].trim().replace(/^"(.*)"$/, '$1').replace(/\\(.)/g, '$1').trim() : '';
    const email = (angled ? angled[2] : clean).trim();
    return EMAIL_RE.test(email) ? {name, email} : null;
}

export function parseAddressList(text) {
    const addresses = [];
    const invalid = [];
    for (const token of splitAddressList(text)) {
        const address = parseOneAddress(token);
        if (address)
            addresses.push(address);
        else
            invalid.push(token);
    }
    return {addresses, invalid};
}

export function formatAddress({name, email}) {
    if (!name || name === email)
        return email;
    const needsQuotes = /[",;<>@()[\]:\\]/.test(name);
    return needsQuotes ? `"${name.replace(/(["\\])/g, '\\$1')}" <${email}>` : `${name} <${email}>`;
}

export function displayName({name, email}) {
    return name || email;
}

function sameEmail(a, b) {
    return a.email.toLowerCase() === b.email.toLowerCase();
}

function uniqueAddresses(list, exclude) {
    const result = [];
    for (const address of list) {
        if (exclude.some(e => sameEmail(e, address)) || result.some(r => sameEmail(r, address)))
            continue;
        result.push(address);
    }
    return result;
}

export function replyRecipients({from, replyTo, to, cc}, self, all) {
    const target = replyTo?.length ? replyTo : from;
    const replyToList = uniqueAddresses(target, []);
    if (!all)
        return {to: replyToList, cc: []};
    // Kendi adresimiz yalnızca Bilgi'den düşer; kendi gönderdiğimiz bir iletiyi
    // yanıtlarken Kime'de kalması gerekir, yoksa yanıt kimseye gitmez.
    const others = uniqueAddresses([...to, ...cc], [...replyToList, self]);
    return {to: replyToList, cc: others};
}

function stripPrefixes(subject) {
    let rest = (subject ?? '').trim();
    let previous;
    do {
        previous = rest;
        rest = rest.replace(PREFIX_RE, '');
    } while (rest !== previous);
    return rest;
}

export function replySubject(subject) {
    return `Ynt: ${stripPrefixes(subject)}`;
}

export function forwardSubject(subject) {
    return `İlt: ${stripPrefixes(subject)}`;
}

export function formatFullDate(dateTime) {
    const minutes = String(dateTime.get_minute()).padStart(2, '0');
    const hours = String(dateTime.get_hour()).padStart(2, '0');
    return `${dateTime.get_day_of_month()} ${MONTHS[dateTime.get_month() - 1]} ${dateTime.get_year()} ${hours}:${minutes}`;
}

function sameDay(a, b) {
    return a.get_year() === b.get_year() && a.get_day_of_year() === b.get_day_of_year();
}

export function formatListDate(dateTime, now) {
    const time = `${String(dateTime.get_hour()).padStart(2, '0')}:${String(dateTime.get_minute()).padStart(2, '0')}`;
    if (sameDay(dateTime, now))
        return `bugün ${time}`;
    if (sameDay(dateTime, now.add_days(-1)))
        return 'dün';
    const dayMonth = `${dateTime.get_day_of_month()} ${MONTHS[dateTime.get_month() - 1]}`;
    return dateTime.get_year() === now.get_year() ? dayMonth : `${dayMonth} ${dateTime.get_year()}`;
}

export function dateTimeFromUnix(seconds) {
    return GLib.DateTime.new_from_unix_local(seconds);
}

export function quoteReply(text, sender, dateTime) {
    const lines = (text ?? '').replace(/\r\n/g, '\n').trimEnd().split('\n');
    const quoted = lines.map(line => (line.startsWith('>') ? `>${line}` : `> ${line}`).trimEnd());
    return `\n\n${formatFullDate(dateTime)} tarihinde ${sender} şunu yazdı:\n${quoted.join('\n')}\n`;
}

export function forwardBody(text, {from, to, subject, dateTime}) {
    const header = [
        '---------- İletilen ileti ----------',
        `Kimden: ${from}`,
        `Tarih: ${formatFullDate(dateTime)}`,
        `Konu: ${subject}`,
        `Kime: ${to}`,
    ].join('\n');
    return `\n\n${header}\n\n${(text ?? '').replace(/\r\n/g, '\n').trimEnd()}\n`;
}

export function sanitizeFilename(name) {
    const base = (name ?? '').split(/[/\\]/).pop();
    const cleaned = base.replace(CONTROL_RE, '').replace(/^[.\s]+/, '').trim();
    if (cleaned.length === 0)
        return FALLBACK_FILENAME;
    if (cleaned.length <= MAX_FILENAME_LENGTH)
        return cleaned;
    const dot = cleaned.lastIndexOf('.');
    const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
    return cleaned.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
}

export function formatSize(bytes) {
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}

function compareUids(a, b) {
    if (/^\d+$/.test(a) && /^\d+$/.test(b))
        return Number(a) - Number(b);
    return a < b ? -1 : a > b ? 1 : 0;
}

export function compareMessages(a, b) {
    return b.date - a.date || compareUids(b.uid, a.uid);
}

export function matchesQuery(item, query) {
    const needle = query.trim().toLocaleLowerCase('tr');
    if (!needle)
        return true;
    return [item.subject, item.sender].some(field => (field ?? '').toLocaleLowerCase('tr').includes(needle));
}

// Uzak içerik iki yoldan engellenir: WebKit ayarlarında betik kapalı ve bu
// CSP yalnızca satır içi stile ve data: görsellerine izin verir. CSP, iletinin
// kendi <meta> etiketleriyle gevşetilemez; birden çok politika kesişir.
const CSP_BLOCKED = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'";
const CSP_REMOTE = "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src data:; form-action 'none'; base-uri 'none'";

export function prepareHtml(html, allowRemote) {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${allowRemote ? CSP_REMOTE : CSP_BLOCKED}">`;
    const doctype = /^\s*<!doctype[^>]*>/i.exec(html);
    // <head> dışındaki CSP meta'sı yok sayılır; doctype'tan hemen sonra gelen
    // meta ise ayrıştırıcının kendiliğinden açtığı head'e düşer.
    if (doctype)
        return doctype[0] + meta + html.slice(doctype[0].length);
    return meta + html;
}

export function hasRemoteContent(html) {
    return /\b(?:src|srcset|background|poster|href)\s*=\s*["']?\s*(?:https?:)?\/\//i.test(html.replace(/<a\b[^>]*>/gi, '')) ||
        /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html);
}

export function htmlToText(html) {
    return html
        .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// RFC 3501 5.1.3: klasör adları IMAP'te değiştirilmiş UTF-7 ile gider; "Arşiv"
// gibi bir ad olduğu gibi gönderilirse sunucu klasörü bulamaz.
export function encodeImapUtf7(name) {
    let out = '';
    let pending = [];
    const flush = () => {
        if (pending.length === 0)
            return;
        const bytes = new Uint8Array(pending.length * 2);
        pending.forEach((unit, i) => {
            bytes[i * 2] = unit >> 8;
            bytes[i * 2 + 1] = unit & 0xff;
        });
        out += `&${GLib.base64_encode(bytes).replace(/=+$/, '').replace(/\//g, ',')}-`;
        pending = [];
    };
    for (let i = 0; i < name.length; i++) {
        const unit = name.charCodeAt(i);
        if (unit >= 0x20 && unit <= 0x7e) {
            flush();
            out += unit === 0x26 ? '&-' : name[i];
        } else {
            pending.push(unit);
        }
    }
    flush();
    return out;
}

export function decodeImapUtf7(name) {
    return name.replace(/&([^-]*)-/g, (_match, encoded) => {
        if (encoded === '')
            return '&';
        const padded = encoded.replace(/,/g, '/') + '==='.slice((encoded.length + 3) % 4);
        const bytes = GLib.base64_decode(padded);
        let text = '';
        for (let i = 0; i + 1 < bytes.length; i += 2)
            text += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
        return text;
    });
}

function unquoteImap(text) {
    return text.startsWith('"') ? text.slice(1, -1).replace(/\\(.)/g, '$1') : text;
}

// LIST yanıtındaki ad ya tırnaklı dizgedir ya da çıplak bir atom; literal
// ({n}) biçimini Dovecot ve Gmail klasör adlarında kullanmıyor.
export function parseListLine(line) {
    const match = /^\* LIST \(([^)]*)\) (NIL|"(?:[^"\\]|\\.)") (.+)$/i.exec(line);
    if (!match)
        return null;
    const separator = match[2] === 'NIL' ? null : match[2].slice(1, -1).replace(/\\(.)/g, '$1');
    const rawName = unquoteImap(match[3].trim());
    const decoded = decodeImapUtf7(rawName);
    return {
        rawName,
        attributes: match[1].split(/\s+/).filter(Boolean).map(a => a.toLowerCase()),
        separator,
        fullName: separator && separator !== '/' ? decoded.split(separator).join('/') : decoded,
        displayName: separator ? decoded.split(separator).pop() : decoded,
    };
}

export function parseStatusLine(line) {
    const match = /^\* STATUS ("(?:[^"\\]|\\.)*"|\S+) \(([^)]*)\)/i.exec(line);
    if (!match)
        return null;
    const items = match[2].trim().split(/\s+/);
    const counts = {};
    for (let i = 0; i + 1 < items.length; i += 2)
        counts[items[i].toLowerCase()] = Number(items[i + 1]);
    return {rawName: unquoteImap(match[1]), messages: counts.messages ?? 0, unseen: counts.unseen ?? 0};
}

// Tırnaklı IMAP dizgisi satır sonu taşıyamaz; taşırsa komut bölünür ve
// devamı sunucuya ayrı bir komut olarak gider.
export function imapQuote(text) {
    if (/[\r\n\0]/.test(text))
        throw new Error('IMAP quoted string cannot contain CR, LF or NUL');
    return `"${text.replace(/(["\\])/g, '\\$1')}"`;
}
