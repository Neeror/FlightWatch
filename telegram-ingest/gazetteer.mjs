import { cities } from '../public/data/locations.js';

// Keep this list in the same order as the exported `cities` groups in locations.js.
// The length assertion below makes a silent group reorder/addition fail at startup.
export const REGION_BY_GROUP_INDEX = Object.freeze([
  'Київська область', 'Житомирська область', 'Чернігівська область', 'Сумська область',
  'Харківська область', 'Дніпропетровська область', 'Запорізька область', 'Херсонська область',
  'Миколаївська область', 'Одеська область', 'Кіровоградська область', 'Черкаська область',
  'Полтавська область', 'Вінницька область', 'Хмельницька область', 'Чернівецька область',
  'Тернопільська область', 'Івано-Франківська область', 'Закарпатська область', 'Волинська область',
  'Рівненська область', 'Львівська область', 'Луганська область', 'Донецька область',
]);
if (cities.length !== REGION_BY_GROUP_INDEX.length) {
  throw new Error(`Gazetteer region mapping mismatch: cities=${cities.length}, regions=${REGION_BY_GROUP_INDEX.length}`);
}

const normalize = (value) => String(value ?? '')
  .toLocaleLowerCase('uk-UA')
  .replace(/[’ʼ`]/g, "'")
  .replace(/ґ/g, 'г')
  .replace(/[–—-]/g, ' ')
  .replace(/[.,]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

export function normalizeName(value) { return normalize(value); }

function parseName(value) {
  const source = String(value ?? '').trim();
  const open = source.indexOf('(');
  if (open < 0) return { base: normalize(source), district: '', community: '' };
  const base = normalize(source.slice(0, open));
  const inside = source.slice(open + 1, source.lastIndexOf(')') > open ? source.lastIndexOf(')') : source.length);
  const parts = inside.split(',').map((part) => normalize(part)).filter(Boolean);
  return { base, district: parts[0] || '', community: parts[1] || '' };
}

function bareBase(value) { return parseName(value).base; }

// Covers common Ukrainian locative/genitive/accusative endings. This is only a
// fallback after exact/parentheses matching and is never allowed to pick ties.
function stemVariants(value) {
  const word = bareBase(value);
  if (!word) return [];
  const variants = new Set([word]);
  for (const suffix of ['ями', 'ами', 'ові', 'еві', 'єві', 'ою', 'ею', 'ами', 'ями', 'ах', 'ях', 'ом', 'ем', 'ою', 'єю', 'а', 'у', 'и', 'і', 'о', 'е', 'ю', 'я']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) variants.add(word.slice(0, -suffix.length));
  }
  // e.g. Борисполя -> Бориспіль; this handles the common -іль/-оля alternation.
  if (word.endsWith('оля') && word.length > 4) variants.add(`${word.slice(0, -3)}іль`);
  return [...variants];
}

function regionKey(value) { return normalize(value).replace(/^м\.\s*/, '').replace(/ область$/, '').trim(); }
function includesRegion(value, wanted) {
  if (!wanted) return true;
  const a = regionKey(value), b = regionKey(wanted);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}
function distanceKm(a, b) {
  const r = Math.PI / 180, dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function deduplicate(entries) {
  const result = [];
  for (const entry of entries) {
    const duplicate = result.find((existing) => existing.base === entry.base && distanceKm(existing.coords, entry.coords) <= 2);
    if (!duplicate) result.push(entry);
  }
  return result;
}

function buildCatalog(groups) {
  const entries = groups.flatMap((group, groupIndex) => (group || []).map((raw) => {
    const parsed = parseName(raw.name);
    return { ...raw, ...parsed, region: REGION_BY_GROUP_INDEX[groupIndex] };
  }));
  return deduplicate(entries);
}

export const GAZETTEER = buildCatalog(cities);

function scopedEntries(entries, region, district, community) {
  return entries.filter((entry) => includesRegion(entry.region, region)
    && (!district || entry.district.includes(normalize(district)) || normalize(district).includes(entry.district))
    && (!community || entry.community.includes(normalize(community)) || normalize(community).includes(entry.community)));
}

function result(entry, method, score = null) {
  const [lat, lon] = entry.coords || [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { ok: true, entry, coordinates: { lat, lon }, matchedName: entry.name, method, score };
}

function failure(reason, name, variants = []) { return { ok: false, reason, name, variants }; }

export function findLocation(name, region, entries = GAZETTEER, context = {}) {
  const query = parseName(name);
  if (!query.base) return failure('empty-name', name);
  const preparedEntries = entries.map((entry) => entry.base ? entry : ({ ...entry, ...parseName(entry.name) }));
  const pool = scopedEntries(preparedEntries, region, context.district || query.district, context.community || query.community);
  if (!pool.length) return failure('not-found', name);

  const full = pool.filter((entry) => normalize(entry.name) === normalize(name));
  if (full.length === 1) return result(full[0], 'exact');
  if (full.length > 1) return failure('ambiguous', name, full);

  const withoutParentheses = pool.filter((entry) => entry.base === query.base);
  if (withoutParentheses.length === 1) return result(withoutParentheses[0], 'without-parentheses');
  if (withoutParentheses.length > 1) return failure('ambiguous', name, withoutParentheses);

  const queryStems = new Set(stemVariants(query.base));
  const stemMatches = pool.filter((entry) => stemVariants(entry.base).some((stem) => queryStems.has(stem)));
  if (stemMatches.length === 1) return result(stemMatches[0], 'stem');
  if (stemMatches.length > 1) return failure('ambiguous', name, stemMatches);

  // High-threshold fuzzy fallback. It cannot resolve a tie.
  const distance = (a, b) => {
    const row = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
      let diagonal = row[0]; row[0] = i;
      for (let j = 1; j <= b.length; j += 1) {
        const old = row[j];
        row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
        diagonal = old;
      }
    }
    return row[b.length];
  };
  const ranked = pool.map((entry) => ({ entry, score: 1 - distance(query.base, entry.base) / Math.max(query.base.length, entry.base.length, 1) }))
    .filter((item) => item.score >= 0.92).sort((a, b) => b.score - a.score);
  if (ranked.length === 1 || (ranked.length > 1 && ranked[0].score > ranked[1].score + 0.03)) return result(ranked[0].entry, 'fuzzy', ranked[0].score);
  return failure(ranked.length ? 'ambiguous' : 'not-found', name, ranked.slice(0, 8).map((item) => item.entry));
}

export function resolveTarget(target, entries = GAZETTEER) {
  const locationName = target?.location_name ?? target?.location;
  const found = findLocation(locationName, target?.region, entries, { district: target?.district, community: target?.community });
  if (!found.ok) return found;
  return found;
}
