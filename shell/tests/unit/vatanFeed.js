import 'resource:///org/gnome/shell/ui/environment.js';
import {parseRssItems, relativeTime} from 'resource:///org/gnome/shell/misc/vatanFeed.js';

const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>TRT Haber</title>
<item><title><![CDATA[TUSAŞ ve ROKETSAN imzaları attı]]></title>
  <link>https://www.trthaber.com/haber/1.html</link>
  <pubDate>Mon, 05 Oct 2026 14:00:00 +0300</pubDate></item>
<item><title>Ekonomi &amp; Piyasa &#8220;rekor&#8221;</title>
  <link>https://www.trthaber.com/haber/2.html</link></item>
<item><title>Yerel dosya</title><link>file:///etc/passwd</link></item>
<item><title></title><link>https://www.trthaber.com/haber/4.html</link></item>
<item><title>Dördüncü</title><link>https://www.trthaber.com/haber/5.html</link></item>
</channel></rss>`;

describe('parseRssItems()', () => {
    it('reads titles from CDATA and decodes entities', () => {
        const [first, second] = parseRssItems(FEED, 10);
        expect(first.title).toBe('TUSAŞ ve ROKETSAN imzaları attı');
        expect(first.date.toISOString()).toBe('2026-10-05T11:00:00.000Z');
        expect(second.title).toBe('Ekonomi & Piyasa “rekor”');
        expect(second.date).toBeNull();
    });

    it('drops items without a title or an https link', () => {
        expect(parseRssItems(FEED, 10).map(i => i.title))
            .toEqual(['TUSAŞ ve ROKETSAN imzaları attı', 'Ekonomi & Piyasa “rekor”', 'Dördüncü']);
    });

    it('stops at max and survives garbage', () => {
        expect(parseRssItems(FEED, 1).length).toBe(1);
        expect(parseRssItems('<html>not a feed</html>', 5)).toEqual([]);
    });
});

describe('relativeTime()', () => {
    const now = new Date('2026-10-05T12:00:00Z');

    it('speaks Turkish at each scale', () => {
        expect(relativeTime(new Date('2026-10-05T11:59:40Z'), now)).toBe('şimdi');
        expect(relativeTime(new Date('2026-10-05T11:35:00Z'), now)).toBe('25 dk önce');
        expect(relativeTime(new Date('2026-10-05T09:00:00Z'), now)).toBe('3 sa önce');
        expect(relativeTime(new Date('2026-10-04T10:00:00Z'), now)).toBe('dün');
        expect(relativeTime(new Date('2026-10-01T12:00:00Z'), now)).toBe('4 gün önce');
        expect(relativeTime(null, now)).toBe('');
    });
});
