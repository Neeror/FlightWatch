// Runtime place resolver. This is the thing that means you never type a coordinate again.
//
// resolvePlace('Чернігів')  -> { name, coords, kind, confidence: 'exact' }
// resolvePlace('чернигів')  -> same, case + apostrophe + typo tolerant
// resolvePlace('ПОХ')        -> { group: [ ...3 records ], centroid: [lat, lon] }
// resolvePlace('с. Гора')     -> strips the settlement-type prefix first
//
// Everything resolves against the locally generated index: instant, offline, no
// rate limits, and no way for a hand-typed wrong number to sneak in.

import { PLACES } from './locations.generated.js';
import { ALIASES, TYPE_PREFIXES } from './place-aliases.js';

// --- normalisation ----------------------------------------------------------
// Ukrainian text arrives with five different apostrophes and inconsistent
// hyphens depending on the source (Telegram, OSM, official registries).
const APOSTROPHES = /['\u2019\u02BC\u0060\u00B4\u2018\u02B9]/g;
const PREFIX_RE = new RegExp(`^(?:${TYPE_PREFIXES.map((p) => p.replace('.', '\\.')).join('|')})\\s+`, 'i');

export function normalise(input) {
  return String(input)
    .normalize('NFC')
    .trim()
    .replace(PREFIX_RE, '')
    .toLowerCase()
    .replace(APOSTROPHES, "'")
    .replace(/[\u2010-\u2015]/g, '-') // en/em dashes typed instead of hyphens
    .replace(/\s+/g, ' ')
    .trim();
}

// --- index ------------------------------------------------------------------
const index = new Map();
const add = (key, rec) => {
  const k = normalise(key);
  if (!k) return;
  if (!index.has(k)) index.set(k, []);
  const bucket = index.get(k);
  if (!bucket.includes(rec)) bucket.push(rec);
};

for (const rec of PLACES) {
  add(rec.name, rec);
  for (const a of rec.aliases ?? []) add(a, rec); // decommunised + alternative names
}

const byName = new Map();
for (const rec of PLACES) if (!byName.has(rec.name)) byName.set(rec.name, rec);

// --- fuzzy fallback ---------------------------------------------------------
// Bounded Levenshtein. Catches the real failure mode in this dataset: a
// transposed or doubled Cyrillic letter ("Гохітва" for "Хохітва").
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1; // whole row already over budget, bail out
    prev = cur;
  }
  return prev[b.length];
}

const keys = [...index.keys()];

function fuzzy(q) {
  // 1 edit for short names, 2 for longer ones. More than that and you are
  // guessing on the user's behalf, which is how bad data gets in.
  const budget = q.length <= 5 ? 1 : 2;
  let best = null, bestD = budget + 1;
  for (const k of keys) {
    const d = editDistance(q, k, budget);
    if (d < bestD) { bestD = d; best = k; if (d === 0) break; }
  }
  return best && bestD <= budget ? { key: best, distance: bestD } : null;
}

// --- public API -------------------------------------------------------------
const centroid = (recs) => [
  Number((recs.reduce((s, r) => s + r.coords[0], 0) / recs.length).toFixed(5)),
  Number((recs.reduce((s, r) => s + r.coords[1], 0) / recs.length).toFixed(5)),
];

export function resolvePlace(input) {
  const q = normalise(input);
  if (!q) return null;

  // 1. Slang / group aliases first, so ПОХ never gets mistaken for a village.
  const aliasKey = Object.keys(ALIASES).find((k) => normalise(k) === q);
  if (aliasKey) {
    const group = ALIASES[aliasKey].map((n) => byName.get(n)).filter(Boolean);
    const missing = ALIASES[aliasKey].filter((n) => !byName.get(n));
    if (missing.length) console.warn(`[resolvePlace] alias "${aliasKey}" points at unknown names: ${missing.join(', ')}`);
    if (!group.length) return null;
    return { query: input, confidence: 'alias', group, centroid: centroid(group) };
  }

  // 2. Exact match on canonical or alternative name.
  const hit = index.get(q);
  if (hit?.length === 1) return { query: input, confidence: 'exact', ...hit[0] };
  if (hit?.length > 1) {
    // Genuinely ambiguous: there are ~30 villages called Іванівка per oblast.
    // Return every candidate and let the caller disambiguate. Silently picking
    // the first is exactly how the old array ended up wrong.
    return { query: input, confidence: 'ambiguous', candidates: hit };
  }

  // 3. Typo tolerance.
  const f = fuzzy(q);
  if (f) {
    const recs = index.get(f.key);
    return recs.length === 1
      ? { query: input, confidence: 'fuzzy', distance: f.distance, ...recs[0] }
      : { query: input, confidence: 'ambiguous', candidates: recs };
  }

  return null;
}

// Convenience for the map layer: always returns markers, never throws.
export function resolveToMarkers(input) {
  const r = resolvePlace(input);
  if (!r) return [];
  if (r.confidence === 'alias') return r.group;
  if (r.confidence === 'ambiguous') return r.candidates;
  return [r];
}

// OPTIONAL online fallback, deliberately OFF and deliberately unimplemented.
//
// Do not point this at the public Nominatim at nominatim.openstreetmap.org.
// Its usage policy caps you at 1 request/second, forbids autocomplete outright,
// forbids systematic queries, and requires caching plus attribution:
//   https://operations.osmfoundation.org/policies/nominatim/
// A live alert feed hitting it per message is exactly the "periodic requests =
// bulk geocoding" pattern the policy prohibits, and you will get blocked.
//
// If you need names outside Kyiv Oblast, either widen the Overpass query in
// tools/build-locations.mjs to cover all of Ukraine (still one build, still zero
// manual coordinates) or run your own Nominatim/Photon instance.
export async function geocodeFallback() {
  throw new Error('No online geocoder configured. Widen the Overpass build instead.');
}
