// gjs -m posta/tests/test-mail-format.js
import GLib from 'gi://GLib';
import System from 'system';

import * as F from '../mail-format.js';

let failures = 0;

function test(name, fn) {
    try {
        fn();
        print(`ok   ${name}`);
    } catch (e) {
        failures++;
        print(`FAIL ${name}\n     ${e.message}`);
    }
}

async function testAsync(name, fn) {
    try {
        await fn();
        print(`ok   ${name}`);
    } catch (e) {
        failures++;
        print(`FAIL ${name}\n     ${e.message}`);
    }
}

function eq(actual, expected) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b)
        throw new Error(`beklenen ${b}, gelen ${a}`);
}

const tz = GLib.TimeZone.new_local();
const local = (y, mo, d, h, mi) => GLib.DateTime.new(tz, y, mo, d, h, mi, 0);

test('adres listesi: ad, tırnak içinde virgül, düz adres', () => {
    const {addresses, invalid} = F.parseAddressList('Ayşe Yılmaz <ayse@ornek.test>, "Kaya, Mehmet" <mehmet@ornek.test>; can@ornek.test');
    eq(addresses, [
        {name: 'Ayşe Yılmaz', email: 'ayse@ornek.test'},
        {name: 'Kaya, Mehmet', email: 'mehmet@ornek.test'},
        {name: '', email: 'can@ornek.test'},
    ]);
    eq(invalid, []);
});

test('adres listesi: geçersizler ayrı döner, boş parçalar atlanır', () => {
    const {addresses, invalid} = F.parseAddressList('ayse, , <bozuk>, mehmet@ornek.test,');
    eq(addresses.map(a => a.email), ['mehmet@ornek.test']);
    eq(invalid, ['ayse', '<bozuk>']);
});

test('adres listesi: addaki satır sonu başlığa sızmaz', () => {
    const {addresses} = F.parseAddressList('Kötü\r\nBcc: x@y.z <ayse@ornek.test>');
    eq(addresses[0].name.includes('\n'), false);
    eq(addresses[0].email, 'ayse@ornek.test');
});

test('adres biçimi: özel karakterli ad tırnaklanır', () => {
    eq(F.formatAddress({name: 'Kaya, Mehmet', email: 'm@o.test'}), '"Kaya, Mehmet" <m@o.test>');
    eq(F.formatAddress({name: '', email: 'm@o.test'}), 'm@o.test');
    eq(F.formatAddress({name: 'Ayşe', email: 'a@o.test'}), 'Ayşe <a@o.test>');
    eq(F.formatAddress({name: 'a@o.test', email: 'a@o.test'}), 'a@o.test');
});

test('tümünü yanıtla: kendi adresi Bilgi\'den düşer, tekrarlar elenir', () => {
    const self = {name: 'Ben', email: 'ben@o.test'};
    const r = F.replyRecipients({
        from: [{name: 'Ayşe', email: 'ayse@o.test'}],
        replyTo: [],
        to: [{name: '', email: 'BEN@o.test'}, {name: 'Can', email: 'can@o.test'}],
        cc: [{name: '', email: 'ayse@o.test'}, {name: 'Can', email: 'can@o.test'}],
    }, self, true);
    eq(r.to.map(a => a.email), ['ayse@o.test']);
    eq(r.cc.map(a => a.email), ['can@o.test']);
});

test('yanıtla: Reply-To varsa ona gider, Bilgi boş kalır', () => {
    const r = F.replyRecipients({
        from: [{name: 'Bülten', email: 'bulten@o.test'}],
        replyTo: [{name: '', email: 'yanit@o.test'}],
        to: [], cc: [{name: '', email: 'x@o.test'}],
    }, {name: '', email: 'ben@o.test'}, false);
    eq(r, {to: [{name: '', email: 'yanit@o.test'}], cc: []});
});

test('konu önekleri: yığılmaz, yabancı önekler sökülür', () => {
    eq(F.replySubject('Toplantı'), 'Ynt: Toplantı');
    eq(F.replySubject('Ynt: Re: AW: Toplantı'), 'Ynt: Toplantı');
    eq(F.replySubject('RE[2]: Toplantı'), 'Ynt: Toplantı');
    eq(F.forwardSubject('İlt: Fwd: Bütçe'), 'İlt: Bütçe');
    eq(F.forwardSubject('Re: Bütçe'), 'İlt: Bütçe');
    eq(F.replySubject(''), 'Ynt: ');
    eq(F.replySubject('Recep\'in dosyası'), 'Ynt: Recep\'in dosyası');
});

test('yanıt alıntısı: her satır alıntılanır, iç içe alıntı korunur', () => {
    const text = F.quoteReply('Merhaba,\r\n> eski\n\nAyşe\n\n', 'Ayşe Yılmaz', local(2026, 10, 3, 14, 5));
    eq(text, '\n\n3 Eki 2026 14:05 tarihinde Ayşe Yılmaz şunu yazdı:\n> Merhaba,\n>> eski\n>\n> Ayşe\n');
});

test('tarih: bugün saatli, dün, bu yıl gün-ay, eski yıl yıllı', () => {
    const now = local(2026, 10, 6, 15, 0);
    eq(F.formatListDate(local(2026, 10, 6, 14, 5), now), 'bugün 14:05');
    eq(F.formatListDate(local(2026, 10, 6, 0, 0), now), 'bugün 00:00');
    eq(F.formatListDate(local(2026, 10, 5, 23, 59), now), 'dün');
    eq(F.formatListDate(local(2026, 10, 3, 9, 0), now), '3 Eki');
    eq(F.formatListDate(local(2025, 12, 31, 9, 0), now), '31 Ara 2025');
});

test('tarih: yılbaşında dün geçen yıla düşer', () => {
    eq(F.formatListDate(local(2025, 12, 31, 22, 0), local(2026, 1, 1, 8, 0)), 'dün');
});

test('dosya adı: yol ayırıcı ve .. temizlenir', () => {
    eq(F.sanitizeFilename('../../bütçe 2026.csv'), 'bütçe 2026.csv');
    eq(F.sanitizeFilename('..\\..\\Windows\\win.ini'), 'win.ini');
    eq(F.sanitizeFilename('..'), 'ek');
    eq(F.sanitizeFilename('/etc/'), 'ek');
    eq(F.sanitizeFilename('.bashrc'), 'bashrc');
    eq(F.sanitizeFilename('a\u0000b\nc.txt'), 'abc.txt');
    eq(F.sanitizeFilename(null), 'ek');
});

test('dosya adı: uzun ad uzantısıyla kısaltılır', () => {
    const name = F.sanitizeFilename(`${'a'.repeat(300)}.pdf`);
    eq(name.length, 200);
    eq(name.endsWith('.pdf'), true);
});

test('sıralama: yeni üstte, eşit tarihte uid sayısal ve azalan', () => {
    const items = [
        {uid: '9', date: 100}, {uid: '10', date: 100}, {uid: '2', date: 300}, {uid: '11', date: 50},
    ];
    eq(items.sort(F.compareMessages).map(i => i.uid), ['2', '10', '9', '11']);
});

test('arama: Türkçe büyük-küçük harf, konu ve gönderen', () => {
    const item = {subject: 'İSTANBUL toplantısı', sender: 'Işık Demir'};
    eq(F.matchesQuery(item, 'istanbul'), true);
    eq(F.matchesQuery(item, 'ışık'), true);
    eq(F.matchesQuery(item, 'ankara'), false);
    eq(F.matchesQuery(item, '  '), true);
});

test('HTML: CSP doctype\'tan sonra, başka yerde değil', () => {
    const out = F.prepareHtml('<!DOCTYPE html><html><body>x</body></html>', false);
    eq(out.startsWith('<!DOCTYPE html><meta http-equiv="Content-Security-Policy"'), true);
    eq(out.includes("img-src data:;"), true);
    eq(F.prepareHtml('<p>x</p>', true).includes('img-src data: https: http:'), true);
});

test('HTML: uzak içerik algılama, bağlantılar sayılmaz', () => {
    eq(F.hasRemoteContent('<img src="https://example.com/a.png">'), true);
    eq(F.hasRemoteContent('<img src=//cdn.example.com/a.png>'), true);
    eq(F.hasRemoteContent('<td background="http://x.test/b.gif">'), true);
    eq(F.hasRemoteContent('<div style="background:url( \'https://x.test/c.png\')">'), true);
    eq(F.hasRemoteContent('<a href="https://pardus.org.tr">bağlantı</a><img src="data:image/png;base64,AAAA">'), false);
});

test('HTML → düz metin: betik ve stil atılır, varlıklar çözülür', () => {
    eq(F.htmlToText('<style>p{}</style><p>Merhaba&nbsp;<b>dünya</b></p><script>x()</script>a &amp; b'), 'Merhaba dünya\na & b');
});

test('IMAP UTF-7: Türkçe ad ve & işareti', () => {
    eq(F.encodeImapUtf7('INBOX'), 'INBOX');
    eq(F.encodeImapUtf7('Arşiv'), 'Ar&AV8-iv');
    eq(F.encodeImapUtf7('Gönderilmiş Öğeler'), 'G&APY-nderilmi&AV8- &ANYBHw-eler');
    eq(F.encodeImapUtf7('A&B'), 'A&-B');
});

test('IMAP UTF-7 çözme: kodlamanın tersi', () => {
    for (const name of ['INBOX', 'Arşiv', 'Gönderilmiş Öğeler', 'A&B', 'çöp/İş'])
        eq(F.decodeImapUtf7(F.encodeImapUtf7(name)), name);
});

test('LIST satırı: özel kullanım, ayırıcı, tırnaklı ve kodlu ad', () => {
    eq(F.parseListLine('* LIST (\\HasNoChildren \\Trash) "." Trash'),
        {rawName: 'Trash', attributes: ['\\hasnochildren', '\\trash'], separator: '.', fullName: 'Trash', displayName: 'Trash'});
    eq(F.parseListLine('* LIST (\\HasNoChildren) "/" "Ar&AV8-iv/2025"').fullName, 'Arşiv/2025');
    eq(F.parseListLine('* LIST (\\HasNoChildren) "." "Proje.Ar&AV8-iv"').fullName, 'Proje/Arşiv');
    eq(F.parseListLine('* LIST (\\HasNoChildren) "." "Proje.Ar&AV8-iv"').displayName, 'Arşiv');
    eq(F.parseListLine('* LIST (\\Noselect) "/" ""').attributes, ['\\noselect']);
    eq(F.parseListLine('* OK bitti'), null);
});

test('STATUS satırı: tırnaklı ve çıplak ad', () => {
    eq(F.parseStatusLine('* STATUS "Ar&AV8-iv" (MESSAGES 10000 UNSEEN 12)'), {rawName: 'Ar&AV8-iv', messages: 10000, unseen: 12});
    eq(F.parseStatusLine('* STATUS INBOX (UNSEEN 0 MESSAGES 3)'), {rawName: 'INBOX', messages: 3, unseen: 0});
    eq(F.parseStatusLine('* LIST () "/" INBOX'), null);
});

test('IMAP tırnaklama', () => {
    eq(F.imapQuote('a"b\\c'), '"a\\"b\\\\c"');
    for (const bad of ['a\r\nA2 DELETE INBOX', 'a\nb', 'a\0b']) {
        let threw = false;
        try {
            F.imapQuote(bad);
        } catch {
            threw = true;
        }
        eq(threw, true);
    }
});

test('boyut biçimi', () => {
    eq(F.formatSize(512), '512 B');
    eq(F.formatSize(2048), '2 KB');
    eq(F.formatSize(1572864), '1,5 MB');
});

await testAsync('LatestOnly: yeni iş öncekini iptal eder, işler üst üste binmez', async () => {
    const makeToken = () => ({cancelled: false, cancel() { this.cancelled = true; }, is_cancelled() { return this.cancelled; }});
    const q = new F.LatestOnly(makeToken);
    let running = 0, maxRunning = 0;
    const started = [];
    const task = name => async token => {
        started.push(name);
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise(r => GLib.timeout_add(GLib.PRIORITY_DEFAULT, 20, () => { r(); return GLib.SOURCE_REMOVE; }));
        running--;
        return token.is_cancelled() ? 'iptal' : name;
    };
    const a = q.run(task('a'));
    const b = q.run(task('b'));
    const c = q.run(task('c'));
    eq([await a, await b, await c], [null, null, 'c']);
    eq(started, ['c']);
    eq(maxRunning, 1);
    const d = q.run(task('d'));
    await new Promise(r => GLib.idle_add(GLib.PRIORITY_DEFAULT, () => { r(); return GLib.SOURCE_REMOVE; }));
    const e = q.run(task('e'));
    eq([await d, await e], ['iptal', 'e']);
    eq(maxRunning, 1);
    let failed = false;
    try { await q.run(async () => { throw new Error('x'); }); } catch { failed = true; }
    eq(failed, true);
    eq(await q.run(async () => 'sonra'), 'sonra');
});

if (failures > 0) {
    print(`\n${failures} test başarısız`);
    System.exit(1);
}
print('\ntüm testler geçti');
