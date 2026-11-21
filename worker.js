import { DurableObject } from 'cloudflare:workers';
import { createState, processAlarm, processIngest, serializeMarkers } from './telegram-ingest/marker-tracker.mjs';

const enc = new TextEncoder();

const b64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64u = (s) => Uint8Array.from(
  atob(String(s).replace(/-/g, '+').replace(/_/g, '/')),
  (c) => c.charCodeAt(0)
);

const key = (secret) => crypto.subtle.importKey(
  'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
);

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function signToken(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await key(secret), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}

export async function verifyToken(token, secret) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await key(secret), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

async function sameSecret(received, expected) {
  const a = enc.encode(String(received || '')), b = enc.encode(String(expected || ''));
  const macKey = await key(expected || 'missing');
  const [x, y] = await Promise.all([
    crypto.subtle.sign('HMAC', macKey, a),
    crypto.subtle.sign('HMAC', macKey, b),
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = u.length ^ v.length;
  for (let i = 0; i < u.length; i += 1) diff |= u[i] ^ v[i];
  return diff === 0;
}

const MAX_INGEST_BYTES = 16 * 1024;
const UA_BOUNDS = { minLat: 43, maxLat: 53.5, minLon: 21, maxLon: 41.5 };
function validIngestPayload(payload) {
  if (!payload || typeof payload !== 'object' || !payload.ai || !Array.isArray(payload.ai.targets)) return false;
  return payload.ai.targets.every((target) => {
    const p = target.coordinates || target.position || target;
    if (!p || (p.lat == null && p.latitude == null) || (p.lon == null && p.longitude == null && p.lng == null)) return true;
    const lat = Number(p.lat ?? p.latitude), lon = Number(p.lon ?? p.longitude ?? p.lng);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= UA_BOUNDS.minLat && lat <= UA_BOUNDS.maxLat && lon >= UA_BOUNDS.minLon && lon <= UA_BOUNDS.maxLon;
  });
}

async function samePassword(a, b, secret) {
  if (!a || !b) return false;
  const k = await key(secret);
  const [x, y] = await Promise.all([
    crypto.subtle.sign('HMAC', k, enc.encode(String(a))),
    crypto.subtle.sign('HMAC', k, enc.encode(String(b))),
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = u.length ^ v.length;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // ── проксі alerts.in.ua ───────────────────────────────────────
    if (url.pathname.startsWith('/api/alerts')) {
      const apiPath = url.pathname.replace('/api/alerts', '') || '/alerts/active.json';
      const headers = { Authorization: `Bearer ${env.ALERTS_TOKEN}` };
      const ims = request.headers.get('If-Modified-Since');
      if (ims) headers['If-Modified-Since'] = ims;

      const r = await fetch(`https://api.alerts.in.ua/v1${apiPath}`, { headers });
      return new Response(r.status === 304 ? null : await r.text(), {
        status: r.status,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Last-Modified': r.headers.get('Last-Modified') || '',
          'Cache-Control': 'no-store',
        },
      });
    }

    if (url.pathname === '/ingest') {
      if (request.method !== 'POST' || !await sameSecret((request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, ''), env.INGEST_SECRET)) return json({ error: 'unauthorized' }, 401);
      const length = Number(request.headers.get('Content-Length') || 0);
      if (length > MAX_INGEST_BYTES) return json({ error: 'bad request' }, 400);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_INGEST_BYTES) return json({ error: 'bad request' }, 400);
      let payload;
      try { payload = JSON.parse(raw); } catch { return json({ error: 'bad request' }, 400); }
      if (!validIngestPayload(payload)) return json({ error: 'bad request' }, 400);
      return env.MARKERS.get(env.MARKERS.idFromName('global')).fetch('https://markers/ingest', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/api/markers') {
      if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
      const origin = request.headers.get('Origin');
      if (origin && new URL(origin).origin !== url.origin) return json({ error: 'forbidden' }, 403);
      return env.MARKERS.get(env.MARKERS.idFromName('global')).fetch(request);
    }

    // ── вхід в адмінку ────────────────────────────────────────────
    if (url.pathname === '/api/admin/login') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
      if (!env.ADMIN_PASSWORD || !env.ADMIN_SECRET) return json({ error: 'admin not configured' }, 500);

      let password = '';
      try { ({ password } = await request.json()); } catch {}

      if (!await samePassword(password, env.ADMIN_PASSWORD, env.ADMIN_SECRET)) {
        await new Promise((r) => setTimeout(r, 500));
        return json({ error: 'bad password' }, 401);
      }

      const exp = Date.now() + 12 * 60 * 60 * 1000;
      return json({ token: await signToken({ role: 'admin', exp }, env.ADMIN_SECRET), exp });
    }

    // ── перевірка токена ──────────────────────────────────────────
    if (url.pathname === '/api/admin/check') {
      const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
      const data = env.ADMIN_SECRET ? await verifyToken(token, env.ADMIN_SECRET) : null;
      return data ? json({ ok: true, exp: data.exp }) : json({ ok: false }, 401);
    }
    if (url.pathname === '/api/presence') {
  if (!env.PRESENCE) return json({ error: 'presence not configured' }, 500);
  if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
  return env.PRESENCE.get(env.PRESENCE.idFromName('global')).fetch(request);
}

if (url.pathname === '/api/admin/online') {
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_SECRET || !await verifyToken(token, env.ADMIN_SECRET)) return json({ ok: false }, 401);
  if (!env.PRESENCE) return json({ error: 'presence not configured' }, 500);
  const r = await env.PRESENCE.get(env.PRESENCE.idFromName('global')).fetch('https://presence/count');
  return json(await r.json());
}

    return env.ASSETS.fetch(request);
  },
};



export class MarkerState extends DurableObject {
  async load() { return (await this.ctx.storage.get('state')) || createState(); }
  async save(state, alarmAt) {
    await this.ctx.storage.put('state', state);
    if (alarmAt) await this.ctx.storage.setAlarm(alarmAt); else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ingest') {
      const payload = await request.json();
      const result = processIngest(await this.load(), payload);
      await this.save(result.state, result.nextAlarmAt);
      for (const log of result.logs) console.warn('[markers]', log);
      for (const item of result.events) this.broadcast(item);
      return json({ ok: true, events: result.events.length });
    }
    if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'expected websocket' }, 426);
    if (this.ctx.getWebSockets().length >= 500) return json({ error: 'too many connections' }, 503);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: 'marker:snapshot', markers: serializeMarkers(await this.load()) }));
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(message) {
    const raw = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(raw); } catch {} }
  }
  async alarm() {
    const result = processAlarm(await this.load());
    await this.save(result.state, result.nextAlarmAt);
    for (const item of result.events) this.broadcast(item);
  }
  webSocketMessage() {}
  webSocketClose() {}
  webSocketError() {}
}

export class Presence extends DurableObject {
  async fetch(request) {
    if (new URL(request.url).pathname === '/count') return json({ online: this.online() });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);   // hibernation: не жере CPU між подіями
    this.push();
    return new Response(null, { status: 101, webSocket: client });
  }
  online() { return this.ctx.getWebSockets().length; }
  push() {
    const msg = JSON.stringify({ type: 'online', online: this.online() });
    for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch {} }
  }
  webSocketMessage(ws) { ws.send(JSON.stringify({ type: 'online', online: this.online() })); }
  webSocketClose() { this.push(); }
  webSocketError() { this.push(); }
}