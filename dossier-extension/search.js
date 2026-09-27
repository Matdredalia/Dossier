// Dossier search. Pure functions (no DOM, no fetch) so the same rules can be tested in Node.
//
// ⚠️ The server plugin (dossier-server/index.js) contains a copy of these matching functions,
// used for "search all dossiers". Keep the two in sync; test/parity-test.mjs checks they agree.
//
// Rules: case- and accent-insensitive; several words = all of them must appear somewhere in the
// item (title/label or body), in any order. Title hits rank above body hits.

export function normalize(text) {
    return String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function parseTerms(query) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    return [...new Set(terms)];
}

/** Text around the first hit in `body`, for the results list. */
export function makeSnippet(body, terms, width = 150) {
    const text = String(body ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const hay = normalize(text);
    let at = -1;
    if (hay.length === text.length) {
        for (const term of terms) {
            const i = hay.indexOf(term);
            if (i !== -1 && (at === -1 || i < at)) at = i;
        }
    }
    if (at === -1) return text.length > width ? `${text.slice(0, width).trimEnd()}…` : text;
    const start = Math.max(0, at - Math.floor(width / 3));
    const end = Math.min(text.length, start + width);
    return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/**
 * @returns {{score: number, snippet: string}|null}  null when the item does not match every term
 */
export function scoreItem(title, body, terms) {
    if (!terms.length) return null;
    const t = normalize(title);
    const b = normalize(body);
    let score = 0;
    for (const term of terms) {
        const inTitle = t.includes(term);
        const inBody = b.includes(term);
        if (!inTitle && !inBody) return null;
        score += (inTitle ? 10 : 0) + (inBody ? 3 : 0);
    }
    if (terms.length > 1 && t.includes(terms.join(' '))) score += 20;
    return { score, snippet: makeSnippet(body, terms) };
}

const CATEGORIES = ['canon', 'headcanon', 'altverse', 'samples'];

/** Search one dossier's data (the meta.json shape). Returns unsorted result objects. */
export function searchMeta(meta, terms, dossierName = meta.displayName) {
    const out = [];
    const add = (type, item, title, body, category) => {
        const hit = scoreItem(title, body, terms);
        if (!hit) return;
        out.push({
            type, category: category || null, id: item.id, title: title || '(untitled)', snippet: hit.snippet,
            score: hit.score, updatedAt: item.updatedAt || item.createdAt || '',
            dossierKey: meta.key, dossierName,
        });
    };
    for (const category of CATEGORIES) {
        for (const n of (meta.notes && meta.notes[category]) || []) add('note', n, n.title || '', n.content || '', category);
    }
    for (const i of meta.images || []) add('image', i, i.label || i.originalName || '', i.label && i.originalName && i.label !== i.originalName ? i.originalName : '');
    for (const l of meta.links || []) add('link', l, l.label || l.url || '', l.url || '');
    for (const s of meta.sounds || []) add('sound', s, s.originalName || '', '');
    return out;
}

export function sortResults(results) {
    return results.sort((a, b) => b.score - a.score || String(b.updatedAt).localeCompare(String(a.updatedAt)) || a.title.localeCompare(b.title));
}
