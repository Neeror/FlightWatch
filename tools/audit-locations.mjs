#!/usr/bin/env node
/**
 * Audits a hand-maintained locations array and, when the generated index exists,
 * diffs against it to answer "what did I miss and what is wrong".
 *
 * Run:  node tools/audit-locations.mjs public/data/locations.js
 *       node tools/audit-locations.mjs public/data/locations.js --reference ../public/data/locations.generated.js
 *
 * Exits non-zero on hard errors, so it doubles as a CI gate.
 */
import { readFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? 'public/data/locations.js';
const refFlag = args.indexOf('--reference');
const refPath = refFlag !== -1 ? args[refFlag + 1] : null;

// Kyiv Oblast + Kyiv City bounding box, generous by ~0.1 deg on every side.
const BBOX = { minLat: 49.10, maxLat: 51.65, minLon: 29.15, maxLon: 32.30 };

const NBSP = /[\u00A0\u202F\u2007]/;
const APOS = /['\u2019\u02BC\u0060\u00B4\u2018]/g;
// Only letters that do NOT exist in the Ukrainian alphabet. Note that и IS
// Ukrainian and must stay out of this set, otherwise every second village here
// gets flagged.
const NON_UKRAINIAN = /[\u044B\u042B\u044D\u042D\u0451\u0401\u044A\u042A]/;
const norm = (s) => String(s).normalize('NFC').trim().toLowerCase().replace(APOS, "'").replace(/\s+/g, ' ');

// Tolerant parser: the real file has ragged whitespace, mixed quote styles, and
// trailing spaces inside name strings.
function parse(src) {
  const re = /\{\s*name\s*:\s*("([^"]*)"|'([^']*)')\s*,\s*coords\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*\}/g;
  const out = [];
  let m, i = 0;
  while ((m = re.exec(src))) out.push({ i: i++, raw: m[2] ?? m[3], lat: parseFloat(m[4]), lon: parseFloat(m[5]) });
  return out;
}

const entries = parse(await readFile(target, 'utf8'));
console.log(`Parsed ${entries.length} entries from ${target}\n`);

const problems = { error: [], warn: [] };
const err = (c, m) => problems.error.push(`[${c}] ${m}`);
const warn = (c, m) => problems.warn.push(`[${c}] ${m}`);

// 1. Dirty names -------------------------------------------------------------
for (const e of entries) {
  if (e.raw !== e.raw.trim()) warn('WHITESPACE', `"${e.raw}" has leading/trailing whitespace`);
  if (NBSP.test(e.raw)) warn('NBSP', `"${e.raw}" contains a non-breaking space`);
  if (/(\u0456\u0456|\u0430\u0430|\u0432\u0432|\u0435\u0435)/.test(e.raw))
    warn('DOUBLED', `"${e.raw}" has a doubled letter, likely a typo`);
  if (NON_UKRAINIAN.test(e.raw)) warn('NON_UKRAINIAN', `"${e.raw}" contains a letter that does not exist in Ukrainian`);
}

// 2. Duplicate names ---------------------------------------------------------
const byName = new Map();
for (const e of entries) {
  const k = norm(e.raw);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(e);
}
for (const [, list] of byName) {
  if (list.length < 2) continue;
  const distinct = new Set(list.map((e) => `${e.lat},${e.lon}`));
  if (distinct.size === 1) {
    err('DUP_EXACT', `"${list[0].raw}" x${list.length} identical entries (indexes ${list.map((e) => e.i).join(', ')})`);
  } else {
    // The dangerous case: same name, different coordinates. At most one is right.
    err('DUP_CONFLICT', `"${list[0].raw}" x${list.length} with DIFFERENT coords, ${maxSeparationKm(list).toFixed(1)} km apart -> ${list.map((e) => `[${e.lat},${e.lon}]`).join(' vs ')}`);
  }
}

// 3. Different names sharing one coordinate ----------------------------------
const byCoord = new Map();
for (const e of entries) {
  const k = `${e.lat.toFixed(4)},${e.lon.toFixed(4)}`;
  if (!byCoord.has(k)) byCoord.set(k, []);
  byCoord.get(k).push(e);
}
for (const [k, list] of byCoord) {
  if (new Set(list.map((e) => norm(e.raw))).size > 1)
    err('COORD_COLLISION', `${[...new Set(list.map((e) => e.raw))].join(' + ')} all sit on ${k} - copy-paste error, these are different places`);
}

// 4. Outside the region / placeholder precision -------------------------------
for (const e of entries) {
  if (e.lat < BBOX.minLat || e.lat > BBOX.maxLat || e.lon < BBOX.minLon || e.lon > BBOX.maxLon)
    err('OUT_OF_REGION', `"${e.raw}" [${e.lat}, ${e.lon}] is outside Kyiv Oblast`);
  if (Number.isInteger(e.lat) || Number.isInteger(e.lon))
    warn('LOW_PRECISION', `"${e.raw}" has a whole-number coordinate, almost certainly a placeholder`);
}

// 5. Synthesised coordinate ramps -------------------------------------------
// The tell of machine-invented coordinates: consecutive entries whose lat AND lon
// both advance by a near-constant step. Real settlements never line up on an
// arithmetic grid. This is the most important check in the file.
function findRamps(list, minRun = 4, tol = 0.0006) {
  const ramps = [];
  let start = 0;
  for (let i = 1; i < list.length; i++) {
    const dLat = list[i].lat - list[i - 1].lat, dLon = list[i].lon - list[i - 1].lon;
    const pLat = i >= 2 ? list[i - 1].lat - list[i - 2].lat : null;
    const pLon = i >= 2 ? list[i - 1].lon - list[i - 2].lon : null;
    const constant = pLat !== null && Math.abs(dLat - pLat) < tol && Math.abs(dLon - pLon) < tol
      && (Math.abs(dLat) > 1e-6 || Math.abs(dLon) > 1e-6);
    if (!constant) {
      if (i - start >= minRun) ramps.push(list.slice(start, i));
      start = i - 1;
    }
  }
  if (list.length - start >= minRun) ramps.push(list.slice(start));
  return ramps;
}
for (const run of findRamps(entries)) {
  err('SYNTHETIC_RAMP', `${run.length} consecutive entries on a straight arithmetic line (step ${(run[1].lat - run[0].lat).toFixed(4)} lat / ${(run[1].lon - run[0].lon).toFixed(4)} lon) - these coordinates were generated, not looked up:\n        ${run.map((e) => `${e.raw} [${e.lat}, ${e.lon}]`).join('\n        ')}`);
}

// 6. Diff against the generated reference -----------------------------------
if (refPath) {
  const { PLACES } = await import(new URL(refPath, `file://${process.cwd()}/`).href);
  const refByName = new Map();
  for (const p of PLACES) {
    refByName.set(norm(p.name), p);
    for (const a of p.aliases ?? []) refByName.set(norm(a), p);
  }
  const have = new Set(entries.map((e) => norm(e.raw)));
  const missing = PLACES.filter((p) => !have.has(norm(p.name)) && !(p.aliases ?? []).some((a) => have.has(norm(a))));

  console.log(`\n=== MISSING (${missing.length}) ===`);
  console.log('Paste-ready, every coordinate straight from OSM:\n');
  for (const p of missing)
    console.log(` { name: "${p.name}", coords: [ ${p.coords[0]}, ${p.coords[1]} ]}, // ${p.kind}${p.lifecycle !== 'active' ? ' ' + p.lifecycle : ''} ${p.osm}`);

  const unknown = entries.filter((e) => !refByName.has(norm(e.raw)));
  console.log(`\n=== NOT IN OSM AS A PLACE (${unknown.length}) ===`);
  console.log('Either a typo, a decommunised name, or infrastructure that belongs in place-aliases.js:\n');
  for (const e of unknown) console.log(`  ${e.raw}  [${e.lat}, ${e.lon}]`);

  console.log('\n=== WRONG COORDINATES (>3 km from OSM) ===');
  let wrong = 0;
  for (const e of entries) {
    const ref = refByName.get(norm(e.raw));
    if (!ref) continue;
    const km = haversine(e.lat, e.lon, ref.coords[0], ref.coords[1]);
    if (km > 3) { wrong++; console.log(`  ${e.raw}: yours [${e.lat}, ${e.lon}] vs OSM [${ref.coords[0]}, ${ref.coords[1]}] = ${km.toFixed(1)} km off`); }
  }
  if (!wrong) console.log('  none');
}

function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function maxSeparationKm(list) {
  let max = 0;
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++)
    max = Math.max(max, haversine(list[i].lat, list[i].lon, list[j].lat, list[j].lon));
  return max;
}

console.log(`\n=== ERRORS (${problems.error.length}) ===`);
problems.error.forEach((p) => console.log('  ' + p));
console.log(`\n=== WARNINGS (${problems.warn.length}) ===`);
problems.warn.forEach((p) => console.log('  ' + p));
console.log(`\n${entries.length} entries, ${problems.error.length} errors, ${problems.warn.length} warnings`);
process.exit(problems.error.length ? 1 : 0);
