#!/usr/bin/env node
/**
 * Generates public/data/locations.generated.js from OpenStreetMap.
 * Every coordinate comes from OSM. Nothing is typed by hand, nothing is estimated.
 *
 * Run:  node tools/build-locations.mjs
 *
 * Why Overpass and not a geocoder search API:
 * the Nominatim Usage Policy forbids systematic queries and states
 * "If you need complete sets of data, get it from the OSM planet or an extract."
 * https://operations.osmfoundation.org/policies/nominatim/
 * Overpass is the sanctioned way to pull a complete set for one area.
 *
 * Region codes are ISO 3166-2:UA -> UA-32 = Kyiv Oblast, UA-30 = Kyiv City.
 * https://en.wikipedia.org/wiki/ISO_3166-2:UA
 *
 * Data is ODbL: you must attribute OpenStreetMap in the UI.
 * https://www.openstreetmap.org/copyright
 */
import { writeFile } from 'node:fs/promises';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter', // mirror, tried only if the first fails
];

// Settlement classes per the OSM place key. isolated_dwelling/farm are the
// smallest inhabited units, which is what "nothing left out" actually requires.
// https://wiki.openstreetmap.org/wiki/Key:place
const SETTLEMENT = 'city|town|village|hamlet|isolated_dwelling|farm|allotments';
// Intra-city units: Kyiv masyvy and mikrorayony (Pozniaky, Osokorky, Troieshchyna, DVRZ...)
const URBAN_UNIT = 'borough|suburb|quarter|neighbourhood|city_block';

const QUERY = `
[out:json][timeout:900];
area["ISO3166-2"="UA-32"]->.obl;
area["ISO3166-2"="UA-30"]->.kyiv;
(
  nwr["place"~"^(${SETTLEMENT})$"](area.obl);
  nwr["place"~"^(${SETTLEMENT})$"](area.kyiv);
  nwr["place"~"^(${URBAN_UNIT})$"](area.kyiv);
  // Kyiv administrative districts. The level is queried as a range rather than
  // hardcoded, so a retag upstream cannot silently empty this bucket.
  rel["boundary"="administrative"]["admin_level"~"^(9|10)$"](area.kyiv);
  // Abandoned settlements in the Chornobyl exclusion zone carry a lifecycle
  // prefix, so plain place=* misses them. Pripyat lives here.
  nwr["abandoned:place"](area.obl);
  nwr["was:place"](area.obl);
);
out center tags;
`;

async function overpass() {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // A descriptive User-Agent is required by OSMF operations policy.
          'User-Agent': 'FlightWatch/1.0 (locations build script; github.com/Neeror/FlightWatch)',
        },
        body: new URLSearchParams({ data: QUERY }),
      });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      lastErr = e;
      console.warn(`! ${url} failed: ${e.message}`);
    }
  }
  throw lastErr;
}

const ORDER = ['city', 'town', 'village', 'hamlet', 'isolated_dwelling', 'farm', 'allotments',
  'borough', 'suburb', 'quarter', 'neighbourhood', 'city_block'];
const rank = (k) => (ORDER.indexOf(k) === -1 ? 99 : ORDER.indexOf(k));

const pickName = (t) => t['name:uk'] || t.name || null; // Ukrainian first, never romanised

function kindOf(t) {
  const p = t.place || t['abandoned:place'] || t['was:place'];
  if (p) return p;
  if (t.boundary === 'administrative') return `admin_level_${t.admin_level}`;
  return 'unknown';
}

function centre(el) {
  if (typeof el.lat === 'number') return [el.lat, el.lon];
  if (el.center) return [el.center.lat, el.center.lon];
  return null;
}

const round = (n) => Number(n.toFixed(5)); // ~1 m, plenty for a map marker

const raw = await overpass();
console.log(`Overpass returned ${raw.elements.length} elements (OSM base ${raw.osm3s?.timestamp_osm_base})`);

const byKey = new Map();
let noName = 0, noGeom = 0;

for (const el of raw.elements) {
  const t = el.tags || {};
  const name = pickName(t);
  if (!name) { noName++; continue; }
  const c = centre(el);
  if (!c) { noGeom++; continue; }

  // Dedupe on name + coarse position, so a settlement mapped as both a node and
  // a boundary relation collapses into a single record.
  const key = `${name}|${c[0].toFixed(2)}|${c[1].toFixed(2)}`;
  const kind = kindOf(t);

  const rec = {
    name,
    coords: [round(c[0]), round(c[1])],
    kind,
    // old_name is why decommunised names keep resolving: "Zhovtneve" still works
    // and points at the current official name.
    aliases: [t.old_name, t['old_name:uk'], t.alt_name, t['alt_name:uk'], t.official_name]
      .filter(Boolean).flatMap((v) => v.split(';')).map((v) => v.trim())
      .filter((v) => v && v !== name),
    katotth: t.katotth || t.koatuu || null,
    osm: `${el.type}/${el.id}`,
    lifecycle: t['abandoned:place'] ? 'abandoned' : t['was:place'] ? 'former' : 'active',
  };

  const prev = byKey.get(key);
  if (!prev || rank(rec.kind) < rank(prev.kind)) byKey.set(key, rec);
}

const places = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, 'uk'));
const counts = places.reduce((a, p) => ((a[p.kind] = (a[p.kind] || 0) + 1), a), {});
console.log('By kind:', counts);
console.log(`Skipped: ${noName} unnamed, ${noGeom} without geometry`);

const header = `// GENERATED FILE - DO NOT EDIT BY HAND.
// Regenerate with: node tools/build-locations.mjs
// Source: OpenStreetMap via Overpass API, ODbL. https://www.openstreetmap.org/copyright
// OSM data timestamp: ${raw.osm3s?.timestamp_osm_base ?? 'unknown'}
// Generated: ${new Date().toISOString()}
// Scope: ISO 3166-2 UA-32 (Kyiv Oblast) + UA-30 (Kyiv City), incl. Kyiv districts,
//        named masyvy/mikrorayony, and abandoned settlements in the exclusion zone.
// Records: ${places.length}
`;

await writeFile('public/data/locations.generated.js', `${header}
export const PLACES = ${JSON.stringify(places, null, 1)};

// Drop-in replacement for the old hand-maintained kyivRegion array.
export const kyivRegion = PLACES.map(({ name, coords }) => ({ name, coords }));

export default PLACES;
`, 'utf8');

console.log(`\nWrote public/data/locations.generated.js with ${places.length} records.`);
