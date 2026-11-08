#!/usr/bin/env node
/**
 * Offline smoke test for the resolver. Runs against fixtures, not the real index,
 * so it needs no network and is safe as a CI gate:
 *
 *   node tools/test-locations.mjs
 *
 * It covers the cases that actually broke before: a name that exists in several
 * oblasts, a typo, a settlement-type prefix, and ПОХ both as a group and as the
 * single averaged marker the build script writes.
 */
import { openLocations } from '../public/data/locations-db.js';

const P = (name, coords, kind, extra = {}) => ({
  name, coords, kind, level: kind === 'city' || kind === 'village' ? 4 : 6,
  code: null, region: extra.region ?? 'UA80000000000093317', raion: null, hromada: null, ...extra,
});

const KYIV = 'UA80000000000093317';
const KYIV_OBL = 'UA32000000000030281';
const SUMY = 'UA59000000000057109';

// Coordinates below are real OSM values for the three massifs, so the averaged
// ПОХ centre in the assertions is the number the build script will produce.
const FIXTURES = {
  'manifest.json': {
    attribution: '(c) OpenStreetMap contributors, ODbL 1.0 + KATOTTH',
    regions: [
      { code: KYIV, name: 'Київ', iso: 'UA-30', file: 'ua80.json' },
      { code: KYIV_OBL, name: 'Київська', iso: 'UA-32', file: 'ua32.json' },
      { code: SUMY, name: 'Сумська', iso: 'UA-59', file: 'ua59.json' },
    ],
  },
  'ua80.json': { region: { code: KYIV, name: 'Київ' }, places: [
    P('Київ', [50.4501, 30.5234], 'city_special', { level: 1 }),
    P('Позняки', [50.3966, 30.6338], 'urban_neighbourhood'),
    P('Осокорки', [50.3777, 30.6153], 'urban_neighbourhood'),
    P('Харківський масив', [50.4045, 30.6553], 'urban_neighbourhood'),
    P('Дарницький район', [50.4, 30.65], 'city_district', { level: 5 }),
    // What the build script writes for a DERIVED_GROUPS entry.
    P('ПОХ', [50.39293, 30.6348], 'masyv_group', {
      derived: true, radius_km: 2.1, members: ['Позняки', 'Осокорки', 'Харківський масив'],
    }),
  ] },
  'ua32.json': { region: { code: KYIV_OBL, name: 'Київська' }, places: [
    P('Біла Церква', [49.7959, 30.1147], 'city', { region: KYIV_OBL }),
    P('Гора', [50.2733, 30.7211], 'village', { region: KYIV_OBL }),
    P('Іванівка', [50.2, 30.9], 'village', { region: KYIV_OBL }),
    P('Хохітва', [49.7, 30.9], 'village', { region: KYIV_OBL }),
  ] },
  'ua59.json': { region: { code: SUMY, name: 'Сумська' }, places: [
    P('Іванівка', [50.6, 34.7], 'village', { region: SUMY }),
    P('Суми', [50.9077, 34.7981], 'city', { region: SUMY }),
  ] },
};

const read = async (file) => structuredClone(FIXTURES[file] ?? (() => { throw new Error(`no fixture ${file}`); })());

let failed = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};

const db = await openLocations({ read, onWarn: () => {} });

check('loads every region', db.places.length, 12);
check('exact match', db.resolve('Суми').coords, [50.9077, 34.7981]);
check('case and apostrophe insensitive', db.resolve('  суми ').confidence, 'exact');
check('strips settlement prefix', db.resolve('с. Гора').name, 'Гора');
check('typo tolerance', [db.resolve('Гохітва').name, db.resolve('Гохітва').confidence], ['Хохітва', 'fuzzy']);
check('nonsense resolves to nothing', db.resolve('ЩокавськеЗапоріжжя'), null);

// The whole point of the rewrite: one name, several oblasts.
const amb = db.resolve('Іванівка');
check('bare ambiguous name returns all candidates', [amb.confidence, amb.candidates.length], ['ambiguous', 2]);
check('oblast in the text narrows it', db.resolve('Іванівка Сумської області').coords, [50.6, 34.7]);
check('slang oblast works too', db.resolve('Іванівка на Сумщині').coords, [50.6, 34.7]);
check('hint can come from the alert text', db.resolve('Іванівка', { context: 'Загроза для Київщини, безпека!' }).coords, [50.2, 30.9]);

// ПОХ twice over: three pins from the alias, one averaged pin from the record.
const poh = db.resolve('ПОХ');
check('ПОХ returns three massifs', poh.group.map((r) => r.name), ['Позняки', 'Осокорки', 'Харківський масив']);
check('ПОХ centroid is the mean of the three', poh.centroid, [50.39293, 30.6348]);
check('ПОХ markers', db.markers('ПОХ').length, 3);
check('пох in lowercase', db.resolve('пох').group.length, 3);
check('Позняки alone', db.resolve('Позняки').coords, [50.3966, 30.6338]);
check('Дарниця alias hits the district', db.resolve('Дарниця').name, 'Дарницький район');

// Loading one oblast must not drag in the rest.
const only = await openLocations({ read, regions: ['UA-59'], onWarn: () => {} });
check('single-region load', [only.places.length, only.resolve('Суми').confidence], [2, 'exact']);
check('single-region load cannot see other oblasts', only.resolve('Біла Церква'), null);

console.log(`\n${failed ? `${failed} FAILED` : 'all good'}`);
process.exit(failed ? 1 : 0);
