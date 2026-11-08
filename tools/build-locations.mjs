#!/usr/bin/env node
/**
 * Builds the nationwide place index in public/data/locations/.
 *
 * Run: node tools/build-locations.mjs
 *      node tools/build-locations.mjs --katottg vendor/ua-geo/data/out/katottg.csv
 *      node tools/build-locations.mjs --skip-urban     # register only, no Overpass
 *
 * Two sources, and the split is the whole point:
 *
 * 1. KATOTTH, the state register, already joined to OSM geometry by ua-geo. It
 *    is the only source carrying the hierarchy: 27 oblasts -> 136 raions ->
 *    1772 hromadas -> 29701 settlements -> 108 districts inside cities, every
 *    row naming its parent by code.
 *    Plain Overpass returns points whose parent you have to guess, which is why
 *    a name like Ivanivka was unanswerable before: there are dozens of them and
 *    nothing said which oblast each one sat in.
 *    https://github.com/alexbabintsev/ua-geo
 *
 * 2. Overpass, only for units the register cannot contain: masyvy and
 *    mikrorayony (Pozniaky, Osokorky, Troieshchyna, DVRZ). People name these in
 *    alerts constantly, they are not administrative units, so no state register
 *    will ever list them.
 *
 * Still nothing typed by hand. The only hand-written file is
 * public/data/place-aliases.js and it carries no coordinates: groups declared
 * there get their point averaged from members found in the sources.
 *
 * Licences: KATOTTH is open data (Mindev). All geometry traces back to
 * OpenStreetMap, ODbL 1.0 - attribute OSM in the UI and share alike.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DERIVED_GROUPS } from '../public/data/place-aliases.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.indexOf(n) !== -1 ? args[args.indexOf(n) + 1] : d);

const OUT_DIR = opt('--out', 'public/data/locations');
const CACHE_DIR = opt('--cache', 'data/cache');
const SKIP_URBAN = flag('--skip-urban');

// Pin the register by tag or commit for a reproducible build; main is the moving edge.
const UA_GEO_REF = opt('--ua-geo-ref', process.env.UA_GEO_REF || 'main');
const KATOTTH_LOCAL = opt('--katottg', process.env.KATOTTH_CSV || null);
const KATOTTH_URL = `https://raw.githubusercontent.com/alexbabintsev/ua-geo/${UA_GEO_REF}/data/out/katottg.csv`;

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter', // mirror, only if the first fails
];

// Register categories, straight from the codifier's own category column.
// Unknown letters throw rather than default to something plausible: a silent
// mislabel here would put a village in the wrong bucket forever.
const CATEGORY = {
  O: { kind: 'oblast', level: 1 },
  K: { kind: 'city_special', level: 1 },  // Kyiv, Sevastopol
  P: { kind: 'raion', level: 2 },
  H: { kind: 'hromada', level: 3 },
  M: { kind: 'city', level: 4 },
  T: { kind: 'urban_town', level: 4 },    // smt
  C: { kind: 'village', level: 4 },       // selo
  X: { kind: 'settlement', level: 4 },    // selyshche
  B: { kind: 'city_district', level: 5 }, // raion u misti
};

// place=* values that name a part of a city rather than a settlement.
const URBAN_UNIT = 'borough|suburb|quarter|neighbourhood|city_block';

// Ukraine incl. Crimea, generous by ~0.2 deg. Anything outside is a bad join.
const BBOX = { minLat: 43.9, maxLat: 52.6, minLon: 21.8, maxLon: 40.4 };

const round = (n) => Number(Number(n).toFixed(5)); // ~1 m, plenty for a marker
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function haversine(a1, o1, a2, o2) {
  const R = 6371, r = Math.PI / 180;
  const dA = (a2 - a1) * r, dO = (o2 - o1) * r;
  const h = Math.sin(dA / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// --- tiny CSV reader --------------------------------------------------------
// The register has quoted fields containing commas, so split(',') is not an option.
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift().map((h) => h.trim());
  return rows
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FlightWatch/2.0 (locations build; github.com/Neeror/FlightWatch)' },
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

async function cached(name, produce) {
  await mkdir(CACHE_DIR, { recursive: true });
  const file = `${CACHE_DIR}/${name}`;
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'));
  const data = await produce();
  await writeFile(file, JSON.stringify(data), 'utf8');
  return data;
}

async function overpass(query) {
  let lastErr;
  for (const url of OVERPASS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            // OSMF operations policy requires a descriptive User-Agent.
            'User-Agent': 'FlightWatch/2.0 (locations build; github.com/Neeror/FlightWatch)',
          },
          body: new URLSearchParams({ data: query }),
        });
        // 429 = no free slot, 504 = the query outran the server. Both are worth
        // waiting out; anything else is our bug and should surface immediately.
        if (res.status === 429 || res.status === 504) throw new Error(`HTTP ${res.status} (retryable)`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (e) {
        lastErr = e;
        console.warn(`  ! ${url} attempt ${attempt}: ${e.message}`);
        await sleep(attempt * 5000);
      }
    }
  }
  throw lastErr;
}

// --- 1. the register --------------------------------------------------------
console.log('Reading KATOTTH...');
const csv = KATOTTH_LOCAL ? await readFile(KATOTTH_LOCAL, 'utf8') : await fetchText(KATOTTH_URL);
const rows = parseCsv(csv);
console.log(`  ${rows.length} register rows from ${KATOTTH_LOCAL ?? KATOTTH_URL}`);

const unknownCats = [...new Set(rows.map((r) => r.category).filter((c) => c && !CATEGORY[c]))];
if (unknownCats.length) {
  throw new Error(`Unknown KATOTTH categories: ${unknownCats.join(', ')}. ` +
    'The codifier gained a category. Add it to CATEGORY rather than letting these rows through unlabelled.');
}

const regions = new Map(); // region_code -> { code, name, iso, places: [] }
const nameByCode = new Map(rows.map((r) => [r.code, r.name]));

let noGeometry = 0, outOfBox = 0;
const places = [];

for (const r of rows) {
  const cat = CATEGORY[r.category];
  if (!cat) continue;

  const lat = r.lat === '' ? NaN : Number(r.lat);
  const lon = r.lon === '' ? NaN : Number(r.lon);
  const hasGeom = Number.isFinite(lat) && Number.isFinite(lon);
  const inBox = hasGeom &&
    lat >= BBOX.minLat && lat <= BBOX.maxLat && lon >= BBOX.minLon && lon <= BBOX.maxLon;

  if (!hasGeom) noGeometry++;
  if (hasGeom && !inBox) {
    // A point outside the country means the name matched the wrong OSM object.
    // Drop the coordinate, keep the place: a named record with no point is
    // honest, a record pointing at Poland is not.
    console.warn(`  ! ${r.name} (${r.code}) at [${lat}, ${lon}] is outside Ukraine, coordinate dropped`);
    outOfBox++;
  }

  places.push({
    name: r.name,
    full_name: r.full_name && r.full_name !== r.name ? r.full_name : undefined,
    coords: inBox ? [round(lat), round(lon)] : null,
    kind: cat.kind,
    level: cat.level,
    code: r.code,
    region: r.region_code || r.code,
    raion: r.raion_code || null,
    hromada: r.hromada_code || null,
    parent: r.parent_code || null,
    koatuu: r.koatuu || null,
    osm: r.osm_id ? `${(r.osm_type || 'N').toLowerCase()}/${r.osm_id}` : null,
    // match tells you which rule found the geometry. Anything other than the
    // register's own code on the OSM object is a name guess, so flag it and let
    // the UI decide how much to trust the pin.
    approx: r.match && r.match !== 'code' ? r.match : undefined,
    source: 'katottg',
  });

  const rc = r.region_code || r.code;
  if (!regions.has(rc)) {
    regions.set(rc, { code: rc, name: nameByCode.get(rc) ?? r.name, iso: null, places: [] });
  }
}

console.log(`  ${places.length} places, ${noGeometry} without geometry, ${outOfBox} outside Ukraine`);
console.log(`  ${regions.size} regions`);

// --- 2. Overpass: masyvy and mikrorayony ------------------------------------
// A register-only index cannot resolve Pozniaky. These are not administrative
// units and never will be, so they come straight from OSM.
const stripRegionSuffix = (s) => String(s)
  .replace(/\s*(\u043e\u0431\u043b\u0430\u0441\u0442\u044c|\u043e\u0431\u043b\.?)\s*$/iu, '')
  .replace(/^\s*\u0410\u0432\u0442\u043e\u043d\u043e\u043c\u043d\u0430 \u0420\u0435\u0441\u043f\u0443\u0431\u043b\u0456\u043a\u0430\s+/iu, '')
  .trim();

if (!SKIP_URBAN) {
  console.log('\nOverpass: listing regions by ISO code...');
  const isoRaw = await cached('overpass-regions.json', () => overpass(`
[out:json][timeout:300];
rel(60199); map_to_area->.ua;
rel["ISO3166-2"~"^UA-"](area.ua);
out tags;
`));

  // Match OSM regions to register regions by name. A hardcoded ISO -> KATOTTH
  // table is the kind of thing that rots silently; the names are stable.
  const regionByName = new Map([...regions.values()].map((r) => [stripRegionSuffix(r.name).toLowerCase(), r]));
  const isoRegions = [];
  for (const el of isoRaw.elements ?? []) {
    const t = el.tags || {};
    const iso = t['ISO3166-2'];
    const hit = [t['name:uk'], t.name].filter(Boolean)
      .map((n) => regionByName.get(stripRegionSuffix(n).toLowerCase()))
      .find(Boolean);
    if (!hit) { console.warn(`  ! ${iso} (${t['name:uk'] ?? t.name}) has no register region, skipped`); continue; }
    hit.iso = iso;
    isoRegions.push({ iso, region: hit });
  }
  const unmatched = [...regions.values()].filter((r) => !r.iso).map((r) => r.name);
  if (unmatched.length) console.warn(`  ! no ISO code for: ${unmatched.join(', ')}`);
  console.log(`  ${isoRegions.length} regions matched to ISO codes`);

  let urbanCount = 0;
  for (const { iso, region } of isoRegions) {
    // One request per region, cached on disk, so a failure halfway through costs
    // you the rest of the run rather than the whole thing.
    const data = await cached(`overpass-urban-${iso}.json`, async () => {
      console.log(`  ${iso} ${region.name}...`);
      const out = await overpass(`
[out:json][timeout:600];
area["ISO3166-2"="${iso}"]->.a;
(
  nwr["place"~"^(${URBAN_UNIT})$"](area.a);
  nwr["abandoned:place"](area.a);
  nwr["was:place"](area.a);
);
out center tags;
`);
      await sleep(2000); // be a decent Overpass citizen
      return out;
    });

    // Register districts are already in; an OSM duplicate within ~2 km is the
    // same ground mapped twice.
    const existing = places.filter((p) => p.region === region.code && p.coords);
    for (const el of data.elements ?? []) {
      const t = el.tags || {};
      const name = t['name:uk'] || t.name;
      if (!name) continue;
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (typeof lat !== 'number' || typeof lon !== 'number') continue;
      if (existing.some((p) => p.name === name && haversine(p.coords[0], p.coords[1], lat, lon) < 2)) continue;

      const former = Boolean(t['abandoned:place'] || t['was:place']);
      places.push({
        name,
        coords: [round(lat), round(lon)],
        kind: former ? 'former_settlement' : `urban_${t.place}`,
        level: 6, // below the register: informal, still the name people use
        code: null,
        region: region.code,
        raion: null,
        hromada: null,
        parent: null,
        aliases: [t.old_name, t['old_name:uk'], t.alt_name, t['alt_name:uk']]
          .filter(Boolean).flatMap((v) => v.split(';')).map((v) => v.trim())
          .filter((v) => v && v !== name),
        osm: `${el.type}/${el.id}`,
        lifecycle: t['abandoned:place'] ? 'abandoned' : t['was:place'] ? 'former' : 'active',
        source: 'osm',
      });
      urbanCount++;
    }
  }
  console.log(`  +${urbanCount} masyvy / mikrorayony / former settlements`);
} else {
  console.log('\nSkipping Overpass (--skip-urban): no masyvy, so Pozniaky will not resolve.');
}

// --- 3. derived groups ------------------------------------------------------
// POKh and friends: declared by name in place-aliases.js, positioned here by
// averaging their members. That is why the aliases file holds no coordinates and
// never needs one.
const byName = new Map();
for (const p of places) if (p.coords && !byName.has(p.name)) byName.set(p.name, p);

for (const [name, spec] of Object.entries(DERIVED_GROUPS)) {
  const members = spec.members.map((m) => byName.get(m)).filter(Boolean);
  const missing = spec.members.filter((m) => !byName.get(m));
  if (missing.length) console.warn(`  ! group "${name}" is missing members: ${missing.join(', ')}`);
  if (members.length < 2) { console.warn(`  ! group "${name}" skipped, needs 2+ located members`); continue; }

  const lat = members.reduce((s, m) => s + m.coords[0], 0) / members.length;
  const lon = members.reduce((s, m) => s + m.coords[1], 0) / members.length;
  const spread = Math.max(...members.map((m) => haversine(lat, lon, m.coords[0], m.coords[1])));

  places.push({
    name,
    coords: [round(lat), round(lon)],
    kind: spec.kind ?? 'group',
    level: 6,
    code: null,
    region: members[0].region,
    raion: members[0].raion,
    hromada: members[0].hromada,
    parent: null,
    members: spec.members,
    // The mean of three massifs is a convenience marker, not a place. radius_km
    // says how far the real ground stretches from it, so the map can draw a
    // circle instead of pretending to a street corner.
    derived: true,
    radius_km: Number(spread.toFixed(2)),
    note: spec.note,
    source: 'derived',
  });
  console.log(`  group "${name}": ${members.length} members, centre [${round(lat)}, ${round(lon)}], spread ${spread.toFixed(1)} km`);
}

// --- 4. write shards -------------------------------------------------------
// One file per region. The map can load the country, an alert feed can load just
// the oblast it is talking about, and nobody ships 5 MB to read one name.
await mkdir(OUT_DIR, { recursive: true });
for (const p of places) regions.get(p.region)?.places.push(p);

const orphans = places.filter((p) => !regions.has(p.region));
if (orphans.length) throw new Error(`${orphans.length} places with an unknown region, first: ${orphans[0].name}`);

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const manifestRegions = [];

for (const r of [...regions.values()].sort((a, b) => a.code.localeCompare(b.code))) {
  const file = `${r.code.slice(0, 4).toLowerCase()}.json`;
  const sorted = r.places.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'uk'));
  await writeFile(`${OUT_DIR}/${file}`, JSON.stringify({
    region: { code: r.code, name: r.name, iso: r.iso },
    places: sorted.map(clean),
  }), 'utf8');
  const byLevel = sorted.reduce((a, p) => ((a[p.level] = (a[p.level] || 0) + 1), a), {});
  manifestRegions.push({ code: r.code, name: r.name, iso: r.iso, file, count: sorted.length, byLevel });
  console.log(`  ${file}  ${String(sorted.length).padStart(5)}  ${r.name}`);
}

await writeFile(`${OUT_DIR}/manifest.json`, JSON.stringify({
  generated: new Date().toISOString(),
  sources: {
    katottg: KATOTTH_LOCAL ?? KATOTTH_URL,
    ua_geo_ref: UA_GEO_REF,
    overpass: SKIP_URBAN ? null : OVERPASS[0],
  },
  licence: 'KATOTTH: open data, Mindev of Ukraine. Geometry: OpenStreetMap contributors, ODbL 1.0.',
  attribution: '(c) OpenStreetMap contributors, ODbL 1.0 + KATOTTH (Mindev)',
  levels: {
    1: 'oblast', 2: 'raion', 3: 'hromada', 4: 'settlement',
    5: 'district in a city', 6: 'masyv / mikrorayon / group',
  },
  total: places.length,
  without_coords: places.filter((p) => !p.coords).length,
  regions: manifestRegions,
}, null, 1), 'utf8');

console.log(`\nWrote ${places.length} places across ${manifestRegions.length} regions to ${OUT_DIR}/`);
console.log('locations.generated.js is superseded: delete it once the app imports locations-db.js.');
