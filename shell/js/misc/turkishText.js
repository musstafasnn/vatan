const LEVEL_TARGETS = new Map([
    ['parlaklik', 'brightness'],
    ['isik', 'brightness'],
    ['ses', 'volume'],
]);

// 'tr' locale ile küçük harfe çevirmek I→ı ve İ→i eşler; ardından ı→i katlamak
// "isik" aramasının "ışık"ı bulmasını sağlarken "İzmir"in yine "izmir"e
// katlanmasını sağlar.
export function foldTurkish(text) {
    return text.toLocaleLowerCase('tr')
        .replaceAll('ı', 'i')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '');
}

export function matchScore(title, keywords, query) {
    const q = foldTurkish(query.trim());
    if (!q)
        return 0;

    const t = foldTurkish(title);
    if (t.startsWith(q))
        return 4;
    if (t.split(/[\s:]+/).some(word => word.startsWith(q)))
        return 3;
    if (t.includes(q))
        return 2;
    return foldTurkish(keywords).split(/\s+/).some(word => word && word.startsWith(q)) ? 1.5 : 0;
}

export function parseLevelCommand(query) {
    const match = foldTurkish(query.trim()).match(/^(parlaklik|isik|ses)\s*%?\s*(\d{1,3})\s*%?$/);
    if (!match)
        return null;
    return {target: LEVEL_TARGETS.get(match[1]), percent: Math.min(Number(match[2]), 100)};
}
