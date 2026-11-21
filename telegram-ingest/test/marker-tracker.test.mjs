import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, haversineKm, initialBearing, processAlarm, processIngest } from '../marker-tracker.mjs';

test('calculates distance and bearing', () => {
  assert.ok(haversineKm({ lat: 50, lon: 30 }, { lat: 50, lon: 31 }) > 70);
  assert.ok(Math.abs(initialBearing({ lat: 50, lon: 30 }, { lat: 50, lon: 31 }) - 89) < 3);
});

test('uses location_name for place, target_point for label, and coordinates for position', () => {
  const target = {
    type: 'БпЛА',
    location_name: 'Бориспіль',
    target_point: 'Київ',
    coordinates: { lat: 50.35, lon: 30.95 },
    region: 'Київська область',
  };
  const result = processIngest(createState(), { channelId: 'location-test', id: 1, ai: { targets: [target] } }, 1_000_000);
  const marker = result.events[0].marker;
  assert.equal(result.events[0].type, 'marker:create');
  assert.equal(marker.location, 'Бориспіль');
  assert.equal(marker.targetPoint, 'Київ');
  assert.deepEqual(marker.position, target.coordinates);
  assert.notDeepEqual(marker.position, { lat: 50.45, lon: 30.52 });
});

test('does not create a marker without coordinates', () => {
  const result = processIngest(createState(), {
    channelId: 'missing-coordinates',
    id: 1,
    ai: { targets: [{ type: 'БпЛА', location_name: 'Бориспіль', target_point: 'Київ', region: 'Київська область' }] },
  }, 1_000_000);
  assert.equal(Object.keys(result.state.markers).length, 0);
  assert.equal(result.events.length, 0);
  assert.match(result.logs[0], /without explicit coordinates/);
});

test('creates, updates and deduplicates a marker', () => {
  const target = { type: 'БпЛА', coordinates: { lat: 50, lon: 30 }, location: 'Київ', region: 'Київська область' };
  let result = processIngest(createState(), { channelId: 'a', id: 1, ai: { targets: [target] } }, 1_000_000);
  assert.equal(result.events[0].type, 'marker:create');
  const id = result.events[0].marker.id;
  result = processIngest(result.state, { channelId: 'b', id: 2, ai: { targets: [{ ...target, coordinates: { lat: 50.01, lon: 30.01 } }] } }, 1_060_000);
  assert.equal(result.events[0].type, 'marker:update');
  assert.equal(Object.keys(result.state.markers).length, 1);
  result = processIngest(result.state, { channelId: 'a', id: 1, ai: { targets: [target] } }, 1_070_000);
  assert.equal(result.events.length, 0);
  assert.equal(result.state.markers[id].speedKmh > 0, true);
});

test('marks stale UAV lost then deletes', () => {
  const result = processIngest(createState(), { channelId: 'a', id: 1, ai: { targets: [{ type: 'БпЛА', coordinates: { lat: 50, lon: 30 }, region: 'Київська область' }] } }, 1_000_000);
  let alarm = processAlarm(result.state, 1_000_000 + 10 * 60_000);
  assert.equal(alarm.events[0].marker.status, 'lost');
  alarm = processAlarm(alarm.state, 1_000_000 + 20 * 60_000);
  assert.equal(alarm.events[0].type, 'marker:delete');
});

test('cancellation requires area and only removes matching type/context', () => {
  let result = processIngest(createState(), { channelId: 'a', id: 1, ai: { targets: [{ type: 'БпЛА', coordinates: { lat: 50, lon: 30 }, region: 'Київська область' }] } }, 1_000_000);
  result = processIngest(result.state, { channelId: 'b', id: 2, ai: { targets: [{ type: 'БпЛА', status: 'відбій', region: 'Київська область' }] } }, 1_001_000);
  assert.equal(result.events[0].type, 'marker:delete');
});
