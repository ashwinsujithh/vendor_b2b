/**
 * Fuzzy category matching.
 *
 * Goal: "Fruits & Vegetables", "fruits and vegetables", "Vegitable Fruits and
 * Strawberry" … should all resolve to ONE existing category instead of each
 * vendor spawning near-duplicate rows.
 *
 * Strategy:
 *   1. normalize(name)  — lowercase, strip punctuation, collapse spaces,
 *                         singularize each word (vegetables→vegetable,
 *                         strawberries→strawberry, berries→berry …).
 *   2. score(query, existing) —
 *        100  exact normalized equality
 *         90  token subset (every word of the query appears in the existing name)
 *         80  reverse subset (existing name's words all appear in the query)
 *        0–70 word-overlap ratio (shared significant words / union)
 *   3. matchCategory(query, list) → { category, score, kind } | null
 *      kind: 'exact' | 'contains' | 'similar'
 */

const STOP_WORDS = new Set(['and', 'or', 'the', 'of', '&', 'other', 'others']);

/** irregular plurals that the mechanical rules mangle */
const IRREGULAR = new Map([
  ['berries', 'berry'],
  ['strawberries', 'strawberry'],
  ['blackberries', 'blackberry'],
  ['raspberries', 'raspberry'],
  ['blueberries', 'blueberry'],
  ['leaves', 'leaf'],
  ['loaves', 'loaf'],
  ['knives', 'knife'],
  ['potatoes', 'potato'],
  ['tomatoes', 'tomato'],
  ['mangoes', 'mango'],
  ['people', 'person'],
]);

function singularize(word) {
  if (IRREGULAR.has(word)) return IRREGULAR.get(word);
  if (word.length <= 3) return word;
  if (word.endsWith('ies') && word.length > 4) return word.slice(0, -3) + 'y';
  if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('ches') || word.endsWith('shes')) {
    return word.slice(0, -2);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
  return word;
}

/** "  Fruits &  Vegetables!! " → ["fruit", "vegetable"] */
function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !STOP_WORDS.has(w))
    .map(singularize)
    .filter(Boolean);
}

/** Levenshtein distance for typo tolerance (vegitable ~ vegetable). */
function lev(a, b) {
  if (a === b) return 0;
  const m0 = a.length, n0 = b.length;
  if (!m0 || !n0) return m0 + n0;
  let prev = Array.from({ length: n0 + 1 }, (_, i) => i);
  for (let i = 1; i <= m0; i++) {
    const cur = [i];
    for (let j = 1; j <= n0; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n0];
}

/** A query word "exists" in the target set if exact or one typo away (len >= 4). */
function wordIn(word, set) {
  if (set.has(word)) return true;
  if (word.length >= 4) {
    for (const e of set) if (lev(word, e) <= 1) return true;
  }
  return false;
}
function scoreTokens(queryWords, existingWords) {
  if (!queryWords.length || !existingWords.length) return 0;
  const q = queryWords.join(' ');
  const e = existingWords.join(' ');
  if (q === e) return 100;

  const qSet = new Set(queryWords);
  const eSet = new Set(existingWords);
  const queryCovered = queryWords.every((w) => wordIn(w, eSet));
  const existingCovered = existingWords.every((w) => wordIn(w, qSet));
  if (queryCovered || existingCovered) return 90; // one name fully inside the other

  // partial overlap, typo-tolerant: shared significant words / longer name
  const shared = queryWords.filter((w) => wordIn(w, eSet)).length;
  return Math.round((shared / Math.max(queryWords.length, existingWords.length)) * 80);
}

/**
 * @param {string} query    raw text typed by the vendor
 * @param {Array<{category_id:number, category:string}>} list existing categories
 * @returns {{ category_id:number, category:string, match:string }|null}
 */
function matchCategory(query, list) {
  const qWords = normalize(query);
  if (!qWords.length) return null;

  let best = null;
  for (const row of list || []) {
    const eWords = normalize(row.category);
    if (!eWords.length) continue;
    const score = scoreTokens(qWords, eWords);
    if (score > (best ? best.score : 0)) {
      best = { row, score };
    }
  }
  if (!best || best.score < 40) return null;

  const kind = best.score >= 100 ? 'exact' : best.score >= 80 ? 'contains' : 'similar';
  return { category_id: best.row.category_id, category: best.row.category, match: kind, score: best.score };
}

/** Title-case for newly created categories ("fruits and vegetables" → "Fruits and Vegetables"). */
function titleCase(name) {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

module.exports = { normalize, matchCategory, titleCase };
