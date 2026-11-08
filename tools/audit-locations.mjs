#!/usr/bin/env node
/**
 * Audits the location data and fails the build when it finds something wrong.
 *
 * Three jobs:
 *
 *   node tools/audit-locations.mjs
 *      Checks the generated index in public/data/locations/ and verifies that
 *      every hand-written alias in place-aliases.js still points at a real name.
 *      This is the one worth running in CI.
 *
 *   node tools/audit-locations.mjs public/data/locations.js
 *      Audits a legacy hand-maintained array on its own: typos, duplicates,
 *      coordinates outside the country, and coordinate ramps.
 *
 *   node tools/audit-locations.mjs public/data/locations.js --diff
 *      The same, plus a diff against the generated index: what is missing, what
 *      is not a place at all, and which coordinates are simply wrong.
 *
 * Exits non-zero on hard errors.
 */
import { readFile } from 'node:fs/promises';
import { openLocations } from '../public/data/locations-db.js';
import { ALIASES, DERIVED_GROUPS } from '../public/data/place-aliases.js';

const args = process.argv.slice(2);
const indexAt = args.indexOf('--index');
const indexDir = indexAt !== -1 ? args[indexAt + 1] : 'public/data/locations';
// --index takes a value, so its argument is not the audit target.
const positional = args.filter((a, i) => !a.startsWith('--') && i !== indexAt + 1);
const target = positional[0] ?? null;
const wantDiff = args.includes('--diff') || Boolean(target);

// Ukraine incl. Crimea, generous by ~0.2 deg on every side.
const BBOX = { minLat: 43.9, maxLat: 52.6, minLon: 21.8, maxLon: 40.4 };

const NBSP = /[\u00A0\u202F\u2007]/;
const APOS = /['\u2019\u02BC\u0060\u00B4\u2018]/g;
// Only letters that do NOT exist in the Ukrainian alphabet. и IS Ukrainian and
// must stay out of this set, otherwise every second village gets flagged.
const NON_UKRAINIAN = /[\u044B\u042B\u044D\u042D\u0451\u0401\u044A\u042A]/;
const norm = (s) => String(s).normalize('NFC').trim().toLowerCase().replace(APOS, "'").replace(/\s+/g, ' ');

const problems = { error: [], warn: [] };
const err = (c, m) => problems.error.push(`[${c}] ${m}`);
const warn = (c, m) => problems.warn.push(`[${c}] ${m}`);

function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function maxSeparationKm(list) {
  let max = 0;
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) max = Math.max(max, haversine(list[i].lat, list[i].lon, list[j].lat, list[j].lon));
  }
  return max;
}

// --- the generated index ----------------------------------------------------
const read = async (file) => JSON.parse(await readFile(`${indexDir}/${file}`, 'utf8'));
// Alias breakage is reported properly below, so do not also relay the loader's
// warning about it and double every line.
const db = await openLocations({ read, onWarn: (m) => { if (!m.includes('alias')) warn('LOAD', m); } });
const stats = db.stats();

console.log(`Index: ${stats.places} places, ${db.regions.length} regions, ${stats.keys} searchable names`);
console.log(`  ${stats.without_coords} without coordinates, ${stats.ambiguous} names shared by 2+ places`);
console.log(`  built ${db.manifest.generated}`);
console.log(`  ${db.attribution}\n`);

if (db.regions.length !== 27) {
  err('REGION_COUNT', `${db.regions.length} regions, expected 27 (24 oblasts + Крим + Київ + Севастополь). The build did not cover the country.`);
}
for (const r of db.manifest.regions) {
  if (!r.count) err('EMPTY_REGION', `${r.name} (${r.code}) has no places`);
  else if (!r.byLevel?.[4] && !r.byLevel?.[5]) warn('NO_SETTLEMENTS', `${r.name} has neither settlements nor city districts`);
}

// Aliases are the only hand-written strings in the project, so they are the only
// thing that can silently rot. Fail the build, do not warn.
for (const [key, names] of Object.entries(ALIASES)) {
  const missing = names.filter((n) => !db.get(n));
  if (!names.length) warn('ALIAS_EMPTY', `"${key}" is declared with no targets`);
  else if (missing.length) err('ALIAS_BROKEN', `"${key}" points at names the index does not have: ${missing.join(', ')}`);
}
for (const [key, spec] of Object.entries(DERIVED_GROUPS)) {
  const missing = spec.members.filter((n) => !db.get(n));
  if (missing.length) err('GROUP_BROKEN', `group "${key}" is missing members: ${missing.join(', ')}`);
  const rec = db.get(key);
  if (!rec) err('GROUP_MISSING', `group "${key}" was never written to the index - rerun the build`);
  else if (!rec.derived) err('GROUP_NOT_DERIVED', `"${key}" exists but is not flagged derived, so something else claimed that name`);
}

// Every place that has a coordinate should be inside the country.
for (const p of db.places) {
  if (!p.coords) continue;
  const [lat, lon] = p.coords;
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lon < BBOX.minLon || lon > BBOX.maxLon) {
    err('OUT_OF_COUNTRY', `"${p.name}" [${lat}, ${lon}] is outside Ukraine`);
  }
}

// The ambiguity report. This is the number to watch: nationwide, a bare village
// name often is not an answer, and the resolver needs a region hint to do better.
const shared = new Map();
for (const p of db.places) {
  const k = norm(p.name);
  if (!shared.has(k)) shared.set(k, []);
  shared.get(k).push(p);
}
const worst = [...shared.values()].filter((l) => l.length > 1).sort((a, b) => b.length - a.length).slice(0, 15);
if (worst.length) {
  console.log('=== MOST AMBIGUOUS NAMES ===');
  console.log('A bare name here resolves to "ambiguous". Pass the alert text as context so the oblast can be read from it.\n');
  for (const l of worst) {
    const regions = [...new Set(l.map((p) => db.manifest.regions.find((r) => r.code === p.region)?.name ?? '?'))];
    console.log(`  ${l[0].name} x${l.length}  ${regions.slice(0, 6).join(', ')}${regions.length > 6 ? `, +${regions.length - 6}` : ''}`);
  }
  console.log('');
}

// --- a legacy hand-maintained array -----------------------------------------
if (target) {
  // Tolerant parser: the real file has ragged whitespace, mixed quote styles and
  // trailing spaces inside name strings.
  const re = /\{\s*name\s*:\s*("([^"]*)"|'([^']*)')\s*,\s*coords\s*:\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]\s*\}/g;
  const src = await readFile(target, 'utf8');
  const entries = [];
  let m, i = 0;
  while ((m = re.exec(src))) entries.push({ i: i++, raw: m[2] ?? m[3], lat: parseFloat(m[4]), lon: parseFloat(m[5]) });
  console.log(`Parsed ${entries.length} entries from ${target}\n`);

  // 1. dirty names
  for (const e of entries) {
    if (e.raw !== e.raw.trim()) warn('WHITESPACE', `"${e.raw}" has leading/trailing whitespace`);
    if (NBSP.test(e.raw)) warn('NBSP', `"${e.raw}" contains a non-breaking space`);
    if (/(\u0456\u0456|\u0430\u0430|\u0432\u0432|\u0435\u0435)/.test(e.raw)) warn('DOUBLED', `"${e.raw}" has a doubled letter, likely a typo`);
    if (NON_UKRAINIAN.test(e.raw)) warn('NON_UKRAINIAN', `"${e.raw}" contains a letter that does not exist in Ukrainian`);
  }

  // 2. duplicate names
  const byName = new Map();
  for (const e of entries) {
    const k = norm(e.raw);
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(e);
  }
  for (const [, list] of byName) {
    if (list.length < 2) continue;
    const distinct = new Set(list.map((e) => `${e.lat},${e.lon}`));
    if (distinct.size === 1) err('DUP_EXACT', `"${list[0].raw}" x${list.length} identical entries (indexes ${list.map((e) => e.i).join(', ')})`);
    // The dangerous case: same name, different coordinates. At most one is right.
    else err('DUP_CONFLICT', `"${list[0].raw}" x${list.length} with DIFFERENT coords, ${maxSeparationKm(list).toFixed(1)} km apart -> ${list.map((e) => `[${e.lat},${e.lon}]`).join(' vs ')}`);
  }

  // 3. different names sharing one coordinate
  const byCoord = new Map();
  for (const e of entries) {
    const k = `${e.lat.toFixed(4)},${e.lon.toFixed(4)}`;
    if (!byCoord.has(k)) byCoord.set(k, []);
    byCoord.get(k).push(e);
  }
  for (const [k, list] of byCoord) {
    if (new Set(list.map((e) => norm(e.raw))).size > 1) {
      err('COORD_COLLISION', `${[...new Set(list.map((e) => e.raw))].join(' + ')} all sit on ${k} - copy-paste error, these are different places`);
    }
  }

  // 4. outside the country / placeholder precision
  for (const e of entries) {
    if (e.lat < BBOX.minLat || e.lat > BBOX.maxLat || e.lon < BBOX.minLon || e.lon > BBOX.maxLon) {
      err('OUT_OF_COUNTRY', `"${e.raw}" [${e.lat}, ${e.lon}] is outside Ukraine`);
    }
    if (Number.isInteger(e.lat) || Number.isInteger(e.lon)) {
      warn('LOW_PRECISION', `"${e.raw}" has a whole-number coordinate, almost certainly a placeholder`);
    }
  }

  // 5. synthesised coordinate ramps
  // The tell of machine-invented coordinates: consecutive entries whose lat AND
  // lon both advance by a near-constant step. Real settlements never line up on
  // an arithmetic grid. This is the most important check in the file.
  const findRamps = (list, minRun = 4, tol = 0.0006) => {
    const ramps = [];
    let start = 0;
    for (let j = 1; j < list.length; j++) {
      const dLat = list[j].lat - list[j - 1].lat, dLon = list[j].lon - list[j - 1].lon;
      const pLat = j >= 2 ? list[j - 1].lat - list[j - 2].lat : null;
      const pLon = j >= 2 ? list[j - 1].lon - list[j - 2].lon : null;
      const constant = pLat !== null && Math.abs(dLat - pLat) < tol && Math.abs(dLon - pLon) < tol &&
        (Math.abs(dLat) > 1e-6 || Math.abs(dLon) > 1e-6);
      if (!constant) {
        if (j - start >= minRun) ramps.push(list.slice(start, j));
        start = j - 1;
      }
    }
    if (list.length - start >= minRun) ramps.push(list.slice(start));
    return ramps;
  };
  for (const run of findRamps(entries)) {
    err('SYNTHETIC_RAMP', `${run.length} consecutive entries on a straight arithmetic line (step ${(run[1].lat - run[0].lat).toFixed(4)} lat / ${(run[1].lon - run[0].lon).toFixed(4)} lon) - these coordinates were generated, not looked up:\n    ${run.map((e) => `${e.raw} [${e.lat}, ${e.lon}]`).join('\n    ')}`);
  }

  // 6. diff against the generated index
  if (wantDiff) {
    const regionName = (code) => db.manifest.regions.find((r) => r.code === code)?.name ?? '?';
    const have = new Set(entries.map((e) => norm(e.raw)));
    const missing = db.places.filter((p) => p.level === 4 && p.coords && !have.has(norm(p.name)));
    console.log(`=== MISSING (${missing.length} settlements) ===`);
    console.log('Every coordinate below comes from the index, so nothing here needs typing:\n');
    for (const p of missing.slice(0, 200)) {
      console.log(`  { name: "${p.name}", coords: [ ${p.coords[0]}, ${p.coords[1]} ]}, // ${p.kind}, ${regionName(p.region)}`);
    }
    if (missing.length > 200) console.log(`  ... and ${missing.length - 200} more. Import the index instead of pasting.`);

    const unknown = entries.filter((e) => !db.resolve(e.raw));
    console.log(`\n=== NOT A KNOWN PLACE (${unknown.length}) ===`);
    console.log('A typo, or infrastructure that belongs in place-aliases.js:\n');
    for (const e of unknown) console.log(`  ${e.raw} [${e.lat}, ${e.lon}]`);

    console.log('\n=== WRONG COORDINATES (>3 km from the index) ===');
    let wrong = 0;
    for (const e of entries) {
      const r = db.resolve(e.raw);
      if (!r?.coords) continue;
      const km = haversine(e.lat, e.lon, r.coords[0], r.coords[1]);
      if (km > 3) {
        wrong++;
        console.log(`  ${e.raw}: yours [${e.lat}, ${e.lon}] vs index [${r.coords[0]}, ${r.coords[1]}] = ${km.toFixed(1)} km off${r.confidence === 'ambiguous' ? ' (ambiguous name, may be a different namesake)' : ''}`);
      }
    }
    if (!wrong) console.log('  none');
  }
}

console.log(`\n=== ERRORS (${problems.error.length}) ===`);
problems.error.forEach((p) => console.log('  ' + p));
console.log(`\n=== WARNINGS (${problems.warn.length}) ===`);
problems.warn.forEach((p) => console.log('  ' + p));
console.log(`\n${problems.error.length} errors, ${problems.warn.length} warnings`);
process.exit(problems.error.length ? 1 : 0);
