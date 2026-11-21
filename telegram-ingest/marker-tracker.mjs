export const TRACKER_CONFIG = Object.freeze({
  maxHistory: 4,
  dedupeWindowMs: 3 * 60_000,
  dedupeRadiusKm: 18,
  mergeRadiusKm: 35,
  maxSegmentSpeedKmh: 4_000,
  stale: Object.freeze({
    uav: Object.freeze({ lostAfterMs: 10 * 60_000, deleteAfterMs: 20 * 60_000 }),
    missile: Object.freeze({ lostAfterMs: 5 * 60_000, deleteAfterMs: 10 * 60_000 }),
    other: Object.freeze({ lostAfterMs: 10 * 60_000, deleteAfterMs: 20 * 60_000 }),
  }),
});

const EARTH_KM = 6371;
const rad = (n) => n * Math.PI / 180;
const finite = (n) => typeof n === 'number' && Number.isFinite(n);

export function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(Math.min(1, x)));
}

export function initialBearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function normalizePosition(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lon = Number(value?.lon ?? value?.lng ?? value?.longitude);
  if (!finite(lat) || !finite(lon) || lat < 43 || lat > 53.5 || lon < 21 || lon > 41.5) return null;
  return { lat, lon };
}

function kindOf(target) {
  const s = String(target?.type ?? target?.category ?? '').toLowerCase();
  if (/бпла|дрон|uav|shahed|fpv|розвід/.test(s)) return 'uav';
  if (/рак|missile|балист|баліст|крилат|калібр|іскандер|кинжал/.test(s)) return 'missile';
  return 'other';
}

function labelType(target) { return String(target?.type ?? target?.category ?? 'інше'); }
function sourceKey(payload) { return `${payload.channelId ?? payload.channel_id ?? payload.chatRef ?? 'unknown'}:${payload.id ?? payload.messageId ?? 'unknown'}`; }
function targetText(target) { return [target?.location_name, target?.location, target?.region, target?.target_point, target?.targetPoint, ...(target?.route || [])].filter(Boolean).join(' ').toLowerCase(); }
function markerText(marker) { return [marker.type, marker.location, marker.region, marker.targetPoint, ...(marker.route || [])].filter(Boolean).join(' ').toLowerCase(); }
function staleConfig(marker) { return TRACKER_CONFIG.stale[marker.kind] || TRACKER_CONFIG.stale.other; }

function event(type, marker) { return { type, marker: structuredClone(marker) }; }
function nextAlarm(state, now) {
  const times = Object.values(state.markers).flatMap((m) => {
    const c = staleConfig(m);
    return [new Date(m.lastSeenAt).getTime() + c.lostAfterMs, new Date(m.lastSeenAt).getTime() + c.deleteAfterMs];
  }).filter((n) => n > now);
  return times.length ? Math.min(...times) : null;
}

export function createState() { return { markers: {}, seenSources: {}, nextId: 1 }; }

function mergeCandidate(state, target, position, publishedAt) {
  const kind = kindOf(target), text = targetText(target);
  return Object.values(state.markers).find((m) => m.kind === kind && haversineKm(m.position, position) <= TRACKER_CONFIG.mergeRadiusKm && (m.lastSeenAt >= publishedAt - TRACKER_CONFIG.dedupeWindowMs || m.status === 'active'));
}

function applyPosition(marker, position, publishedAt, source) {
  const previous = marker.history.at(-1);
  if (previous && publishedAt <= previous.at) return false;
  let speedKmh = marker.speedKmh ?? null, bearing = marker.bearing ?? null;
  if (previous) {
    const hours = (publishedAt - previous.at) / 3_600_000;
    const distance = haversineKm(previous, position);
    const candidate = hours > 0 ? distance / hours : Infinity;
    if (candidate <= TRACKER_CONFIG.maxSegmentSpeedKmh && distance > 0.05) {
      marker.segments = [...(marker.segments || []), { speedKmh: candidate, bearing: initialBearing(previous, position) }].slice(-3);
      speedKmh = marker.segments.reduce((sum, x) => sum + x.speedKmh, 0) / marker.segments.length;
      bearing = marker.segments.reduce((sum, x) => sum + x.bearing, 0) / marker.segments.length % 360;
    }
  }
  marker.position = position;
  marker.history = [...(marker.history || []), { ...position, at: publishedAt, source }].slice(-TRACKER_CONFIG.maxHistory);
  marker.lastSeenAt = publishedAt;
  marker.status = 'active';
  marker.speedKmh = speedKmh;
  marker.bearing = bearing;
  return true;
}

function cancellationMatches(marker, target) {
  const context = targetText(target);
  if (!context) return false;
  const type = kindOf(target);
  return marker.kind === type && markerText(marker).split(' ').some((part) => part.length >= 3 && context.includes(part));
}

export function processIngest(inputState, payload, now = Date.now()) {
  const state = structuredClone(inputState || createState());
  const events = [], logs = [];
  const source = sourceKey(payload);
  if (state.seenSources[source]) return { state, events, logs: ['duplicate source ignored'], nextAlarmAt: nextAlarm(state, now) };
  state.seenSources[source] = now;
  for (const [key, value] of Object.entries(state.seenSources)) if (value < now - TRACKER_CONFIG.dedupeWindowMs * 4) delete state.seenSources[key];

  const targets = Array.isArray(payload.ai?.targets) ? payload.ai.targets : [];
  for (const target of targets) {
    const position = normalizePosition(target.coordinates || target.position);
    const cancelled = Boolean(target.is_cancelled || /відбій|чисто|збит|знищ/i.test(String(target.status || '')));
    if (cancelled) {
      if (!target.region && !target.location_name && !target.location && !target.target_point && !target.targetPoint) { logs.push('cancellation without area ignored'); continue; }
      for (const marker of Object.values(state.markers)) {
        if (cancellationMatches(marker, target)) { delete state.markers[marker.id]; events.push({ type: 'marker:delete', id: marker.id, reason: 'cancelled' }); }
      }
      continue;
    }
    if (!position) { logs.push(`target without explicit coordinates: ${source}`); continue; }
    const kind = kindOf(target);
    const duplicate = Object.values(state.markers).find((m) => m.kind === kind && now - m.lastSeenAt <= TRACKER_CONFIG.dedupeWindowMs && haversineKm(m.position, position) <= TRACKER_CONFIG.dedupeRadiusKm);
    const marker = duplicate || mergeCandidate(state, target, position, now);
    if (marker) {
      if (!applyPosition(marker, position, now, { channelId: payload.channelId, messageId: payload.id, chat: payload.chat })) continue;
      marker.location = target.location_name || target.location || marker.location || null;
      marker.region = target.region || payload.region || marker.region || null;
      marker.route = target.route || marker.route || [];
      marker.targetPoint = target.target_point || target.targetPoint || marker.targetPoint || null;
      marker.directionText = target.direction || marker.directionText || null;
      marker.updatedAt = now;
      events.push(event('marker:update', marker));
    } else {
      const id = `m-${state.nextId++}`;
      const created = { id, kind, type: labelType(target), status: 'active', position, history: [], segments: [], speedKmh: null, bearing: null, location: target.location_name || target.location || null, region: target.region || payload.region || null, route: target.route || [], targetPoint: target.target_point || target.targetPoint || null, directionText: target.direction || null, createdAt: now, lastSeenAt: now, updatedAt: now };
      applyPosition(created, position, now, { channelId: payload.channelId, messageId: payload.id, chat: payload.chat });
      state.markers[id] = created;
      events.push(event('marker:create', created));
    }
  }
  return { state, events, logs, nextAlarmAt: nextAlarm(state, now) };
}

export function processAlarm(inputState, now = Date.now()) {
  const state = structuredClone(inputState || createState()), events = [];
  for (const marker of Object.values(state.markers)) {
    const age = now - marker.lastSeenAt, c = staleConfig(marker);
    if (age >= c.deleteAfterMs) { delete state.markers[marker.id]; events.push({ type: 'marker:delete', id: marker.id, reason: 'timeout' }); }
    else if (age >= c.lostAfterMs && marker.status === 'active') { marker.status = 'lost'; events.push(event('marker:update', marker)); }
  }
  return { state, events, nextAlarmAt: nextAlarm(state, now) };
}

export function serializeMarkers(state) { return Object.values(state?.markers || {}).filter((m) => m.status !== 'deleted').map((m) => structuredClone(m)); }
