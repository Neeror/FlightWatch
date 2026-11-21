import test from 'node:test';
import assert from 'node:assert/strict';
import { cities } from '../../public/data/locations.js';
import { GAZETTEER, REGION_BY_GROUP_INDEX, findLocation, resolveTarget } from '../gazetteer.mjs';

const entries = [
  { name: "Кам'янка(Київський район)", coords: [50, 30], region: 'Київська область' },
  { name: 'Кам’янка(Черкаський район)', coords: [49, 32], region: 'Черкаська область' },
  { name: 'Бориспіль(Бориспільський район)', coords: [50.35, 30.95], region: 'Київська область' },
  { name: 'Цимбалів яр(Житомирський район)', coords: [50.1, 28], region: 'Житомирська область' },
  { name: 'Цимбалів яр(Житомирський район)', coords: [50.11, 28.01], region: 'Житомирська область' },
  { name: 'Цимбалів яр(Інший район)', coords: [51, 29], region: 'Житомирська область' },
  { name: 'Київ', coords: [50.45, 30.52], region: 'Київська область' },
];

test('region mapping is explicit and covers every cities group', () => assert.equal(cities.length, REGION_BY_GROUP_INDEX.length));
test('exact match', () => assert.equal(findLocation('Київ', null, entries).entry.name, 'Київ'));
test('apostrophe and parentheses', () => assert.equal(findLocation("Кам'янка", 'Київська область', entries).entry.name, "Кам'янка(Київський район)"));
test('case inflection fallback', () => assert.equal(resolveTarget({ location_name: 'Борисполя', region: 'Київська область' }, entries).coordinates.lon, 30.95));
test('duplicate within two kilometres is one record', () => assert.equal(findLocation('Цимбалів яр', 'Житомирська область', entries).ok, false));
test('ambiguous name resolved by region', () => assert.equal(resolveTarget({ location_name: 'Кам’янка', region: 'Черкаська область' }, entries).coordinates.lon, 32));
test('ambiguous name without region rejected', () => assert.equal(resolveTarget({ location_name: 'Кам’янка' }, entries).ok, false));
test('unknown name rejected', () => assert.equal(resolveTarget({ location_name: 'Невідоме місце' }, entries).reason, 'not-found'));
test('empty name rejected', () => assert.equal(resolveTarget({ location_name: '' }, entries).reason, 'empty-name'));
test('production catalog is loaded from exported locations data', () => assert.ok(GAZETTEER.length > 1000));
