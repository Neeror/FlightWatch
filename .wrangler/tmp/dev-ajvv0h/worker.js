var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
import { DurableObject } from "cloudflare:workers";

// telegram-ingest/marker-tracker.mjs
var TRACKER_CONFIG = Object.freeze({
  maxHistory: 4,
  dedupeWindowMs: 3 * 6e4,
  dedupeRadiusKm: 18,
  mergeRadiusKm: 35,
  maxSegmentSpeedKmh: 4e3,
  stale: Object.freeze({
    uav: Object.freeze({ lostAfterMs: 10 * 6e4, deleteAfterMs: 20 * 6e4 }),
    missile: Object.freeze({ lostAfterMs: 5 * 6e4, deleteAfterMs: 10 * 6e4 }),
    other: Object.freeze({ lostAfterMs: 10 * 6e4, deleteAfterMs: 20 * 6e4 })
  })
});
var EARTH_KM = 6371;
var rad = /* @__PURE__ */ __name((n) => n * Math.PI / 180, "rad");
var finite = /* @__PURE__ */ __name((n) => typeof n === "number" && Number.isFinite(n), "finite");
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(Math.min(1, x)));
}
__name(haversineKm, "haversineKm");
function initialBearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
__name(initialBearing, "initialBearing");
function normalizePosition(value) {
  const lat = Number(value?.lat ?? value?.latitude);
  const lon = Number(value?.lon ?? value?.lng ?? value?.longitude);
  if (!finite(lat) || !finite(lon) || lat < 43 || lat > 53.5 || lon < 21 || lon > 41.5) return null;
  return { lat, lon };
}
__name(normalizePosition, "normalizePosition");
function kindOf(target) {
  const s = String(target?.type ?? target?.category ?? "").toLowerCase();
  if (/бпла|дрон|uav|shahed|fpv|розвід/.test(s)) return "uav";
  if (/рак|missile|балист|баліст|крилат|калібр|іскандер|кинжал/.test(s)) return "missile";
  return "other";
}
__name(kindOf, "kindOf");
function labelType(target) {
  return String(target?.type ?? target?.category ?? "\u0456\u043D\u0448\u0435");
}
__name(labelType, "labelType");
function sourceKey(payload) {
  return `${payload.channelId ?? payload.channel_id ?? payload.chatRef ?? "unknown"}:${payload.id ?? payload.messageId ?? "unknown"}`;
}
__name(sourceKey, "sourceKey");
function targetText(target) {
  return [target?.location_name, target?.location, target?.region, target?.target_point, target?.targetPoint, ...target?.route || []].filter(Boolean).join(" ").toLowerCase();
}
__name(targetText, "targetText");
function markerText(marker) {
  return [marker.type, marker.location, marker.region, marker.targetPoint, ...marker.route || []].filter(Boolean).join(" ").toLowerCase();
}
__name(markerText, "markerText");
function staleConfig(marker) {
  return TRACKER_CONFIG.stale[marker.kind] || TRACKER_CONFIG.stale.other;
}
__name(staleConfig, "staleConfig");
function event(type, marker) {
  return { type, marker: structuredClone(marker) };
}
__name(event, "event");
function nextAlarm(state, now) {
  const times = Object.values(state.markers).flatMap((m) => {
    const c = staleConfig(m);
    return [new Date(m.lastSeenAt).getTime() + c.lostAfterMs, new Date(m.lastSeenAt).getTime() + c.deleteAfterMs];
  }).filter((n) => n > now);
  return times.length ? Math.min(...times) : null;
}
__name(nextAlarm, "nextAlarm");
function createState() {
  return { markers: {}, seenSources: {}, nextId: 1 };
}
__name(createState, "createState");
function mergeCandidate(state, target, position, publishedAt) {
  const kind = kindOf(target), text = targetText(target);
  return Object.values(state.markers).find((m) => m.kind === kind && haversineKm(m.position, position) <= TRACKER_CONFIG.mergeRadiusKm && (m.lastSeenAt >= publishedAt - TRACKER_CONFIG.dedupeWindowMs || m.status === "active"));
}
__name(mergeCandidate, "mergeCandidate");
function applyPosition(marker, position, publishedAt, source) {
  const previous = marker.history.at(-1);
  if (previous && publishedAt <= previous.at) return false;
  let speedKmh = marker.speedKmh ?? null, bearing = marker.bearing ?? null;
  if (previous) {
    const hours = (publishedAt - previous.at) / 36e5;
    const distance = haversineKm(previous, position);
    const candidate = hours > 0 ? distance / hours : Infinity;
    if (candidate <= TRACKER_CONFIG.maxSegmentSpeedKmh && distance > 0.05) {
      marker.segments = [...marker.segments || [], { speedKmh: candidate, bearing: initialBearing(previous, position) }].slice(-3);
      speedKmh = marker.segments.reduce((sum, x) => sum + x.speedKmh, 0) / marker.segments.length;
      bearing = marker.segments.reduce((sum, x) => sum + x.bearing, 0) / marker.segments.length % 360;
    }
  }
  marker.position = position;
  marker.history = [...marker.history || [], { ...position, at: publishedAt, source }].slice(-TRACKER_CONFIG.maxHistory);
  marker.lastSeenAt = publishedAt;
  marker.status = "active";
  marker.speedKmh = speedKmh;
  marker.bearing = bearing;
  return true;
}
__name(applyPosition, "applyPosition");
function cancellationMatches(marker, target) {
  const context = targetText(target);
  if (!context) return false;
  const type = kindOf(target);
  return marker.kind === type && markerText(marker).split(" ").some((part) => part.length >= 3 && context.includes(part));
}
__name(cancellationMatches, "cancellationMatches");
function processIngest(inputState, payload, now = Date.now()) {
  const state = structuredClone(inputState || createState());
  const events = [], logs = [];
  const source = sourceKey(payload);
  if (state.seenSources[source]) return { state, events, logs: ["duplicate source ignored"], nextAlarmAt: nextAlarm(state, now) };
  state.seenSources[source] = now;
  for (const [key2, value] of Object.entries(state.seenSources)) if (value < now - TRACKER_CONFIG.dedupeWindowMs * 4) delete state.seenSources[key2];
  const targets = Array.isArray(payload.ai?.targets) ? payload.ai.targets : [];
  for (const target of targets) {
    const position = normalizePosition(target.coordinates || target.position);
    const cancelled = Boolean(target.is_cancelled || /відбій|чисто|збит|знищ/i.test(String(target.status || "")));
    if (cancelled) {
      if (!target.region && !target.location_name && !target.location && !target.target_point && !target.targetPoint) {
        logs.push("cancellation without area ignored");
        continue;
      }
      for (const marker2 of Object.values(state.markers)) {
        if (cancellationMatches(marker2, target)) {
          delete state.markers[marker2.id];
          events.push({ type: "marker:delete", id: marker2.id, reason: "cancelled" });
        }
      }
      continue;
    }
    if (!position) {
      logs.push(`target without explicit coordinates: ${source}`);
      continue;
    }
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
      events.push(event("marker:update", marker));
    } else {
      const id = `m-${state.nextId++}`;
      const created = { id, kind, type: labelType(target), status: "active", position, history: [], segments: [], speedKmh: null, bearing: null, location: target.location_name || target.location || null, region: target.region || payload.region || null, route: target.route || [], targetPoint: target.target_point || target.targetPoint || null, directionText: target.direction || null, createdAt: now, lastSeenAt: now, updatedAt: now };
      applyPosition(created, position, now, { channelId: payload.channelId, messageId: payload.id, chat: payload.chat });
      state.markers[id] = created;
      events.push(event("marker:create", created));
    }
  }
  return { state, events, logs, nextAlarmAt: nextAlarm(state, now) };
}
__name(processIngest, "processIngest");
function processAlarm(inputState, now = Date.now()) {
  const state = structuredClone(inputState || createState()), events = [];
  for (const marker of Object.values(state.markers)) {
    const age = now - marker.lastSeenAt, c = staleConfig(marker);
    if (age >= c.deleteAfterMs) {
      delete state.markers[marker.id];
      events.push({ type: "marker:delete", id: marker.id, reason: "timeout" });
    } else if (age >= c.lostAfterMs && marker.status === "active") {
      marker.status = "lost";
      events.push(event("marker:update", marker));
    }
  }
  return { state, events, nextAlarmAt: nextAlarm(state, now) };
}
__name(processAlarm, "processAlarm");
function serializeMarkers(state) {
  return Object.values(state?.markers || {}).filter((m) => m.status !== "deleted").map((m) => structuredClone(m));
}
__name(serializeMarkers, "serializeMarkers");

// worker.js
var enc = new TextEncoder();
var b64u = /* @__PURE__ */ __name((b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "b64u");
var unb64u = /* @__PURE__ */ __name((s) => Uint8Array.from(
  atob(String(s).replace(/-/g, "+").replace(/_/g, "/")),
  (c) => c.charCodeAt(0)
), "unb64u");
var key = /* @__PURE__ */ __name((secret) => crypto.subtle.importKey(
  "raw",
  enc.encode(secret),
  { name: "HMAC", hash: "SHA-256" },
  false,
  ["sign", "verify"]
), "key");
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
}), "json");
async function signToken(payload, secret) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body));
  return `${body}.${b64u(sig)}`;
}
__name(signToken, "signToken");
async function verifyToken(token, secret) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), unb64u(sig), enc.encode(body));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(unb64u(body)));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}
__name(verifyToken, "verifyToken");
async function sameSecret(received, expected) {
  const a = enc.encode(String(received || "")), b = enc.encode(String(expected || ""));
  const macKey = await key(expected || "missing");
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", macKey, a),
    crypto.subtle.sign("HMAC", macKey, b)
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = u.length ^ v.length;
  for (let i = 0; i < u.length; i += 1) diff |= u[i] ^ v[i];
  return diff === 0;
}
__name(sameSecret, "sameSecret");
var MAX_INGEST_BYTES = 16 * 1024;
var UA_BOUNDS = { minLat: 43, maxLat: 53.5, minLon: 21, maxLon: 41.5 };
function validIngestPayload(payload) {
  if (!payload || typeof payload !== "object" || !payload.ai || !Array.isArray(payload.ai.targets)) return false;
  return payload.ai.targets.every((target) => {
    const p = target.coordinates || target.position || target;
    if (!p || p.lat == null && p.latitude == null || p.lon == null && p.longitude == null && p.lng == null) return true;
    const lat = Number(p.lat ?? p.latitude), lon = Number(p.lon ?? p.longitude ?? p.lng);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= UA_BOUNDS.minLat && lat <= UA_BOUNDS.maxLat && lon >= UA_BOUNDS.minLon && lon <= UA_BOUNDS.maxLon;
  });
}
__name(validIngestPayload, "validIngestPayload");
async function samePassword(a, b, secret) {
  if (!a || !b) return false;
  const k = await key(secret);
  const [x, y] = await Promise.all([
    crypto.subtle.sign("HMAC", k, enc.encode(String(a))),
    crypto.subtle.sign("HMAC", k, enc.encode(String(b)))
  ]);
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = u.length ^ v.length;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}
__name(samePassword, "samePassword");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/alerts")) {
      const apiPath = url.pathname.replace("/api/alerts", "") || "/alerts/active.json";
      const headers = { Authorization: `Bearer ${env.ALERTS_TOKEN}` };
      const ims = request.headers.get("If-Modified-Since");
      if (ims) headers["If-Modified-Since"] = ims;
      const r = await fetch(`https://api.alerts.in.ua/v1${apiPath}`, { headers });
      return new Response(r.status === 304 ? null : await r.text(), {
        status: r.status,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Last-Modified": r.headers.get("Last-Modified") || "",
          "Cache-Control": "no-store"
        }
      });
    }
    if (url.pathname === "/ingest") {
      if (request.method !== "POST" || !await sameSecret((request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""), env.INGEST_SECRET)) return json({ error: "unauthorized" }, 401);
      const length = Number(request.headers.get("Content-Length") || 0);
      if (length > MAX_INGEST_BYTES) return json({ error: "bad request" }, 400);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > MAX_INGEST_BYTES) return json({ error: "bad request" }, 400);
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        return json({ error: "bad request" }, 400);
      }
      if (!validIngestPayload(payload)) return json({ error: "bad request" }, 400);
      return env.MARKERS.get(env.MARKERS.idFromName("global")).fetch("https://markers/ingest", { method: "POST", body: JSON.stringify(payload), headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname === "/api/markers") {
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected websocket" }, 426);
      const origin = request.headers.get("Origin");
      if (origin && new URL(origin).origin !== url.origin) return json({ error: "forbidden" }, 403);
      return env.MARKERS.get(env.MARKERS.idFromName("global")).fetch(request);
    }
    if (url.pathname === "/api/admin/login") {
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
      if (!env.ADMIN_PASSWORD || !env.ADMIN_SECRET) return json({ error: "admin not configured" }, 500);
      let password = "";
      try {
        ({ password } = await request.json());
      } catch {
      }
      if (!await samePassword(password, env.ADMIN_PASSWORD, env.ADMIN_SECRET)) {
        await new Promise((r) => setTimeout(r, 500));
        return json({ error: "bad password" }, 401);
      }
      const exp = Date.now() + 12 * 60 * 60 * 1e3;
      return json({ token: await signToken({ role: "admin", exp }, env.ADMIN_SECRET), exp });
    }
    if (url.pathname === "/api/admin/check") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      const data = env.ADMIN_SECRET ? await verifyToken(token, env.ADMIN_SECRET) : null;
      return data ? json({ ok: true, exp: data.exp }) : json({ ok: false }, 401);
    }
    if (url.pathname === "/api/presence") {
      if (!env.PRESENCE) return json({ error: "presence not configured" }, 500);
      if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected websocket" }, 426);
      return env.PRESENCE.get(env.PRESENCE.idFromName("global")).fetch(request);
    }
    if (url.pathname === "/api/admin/online") {
      const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      if (!env.ADMIN_SECRET || !await verifyToken(token, env.ADMIN_SECRET)) return json({ ok: false }, 401);
      if (!env.PRESENCE) return json({ error: "presence not configured" }, 500);
      const r = await env.PRESENCE.get(env.PRESENCE.idFromName("global")).fetch("https://presence/count");
      return json(await r.json());
    }
    return env.ASSETS.fetch(request);
  }
};
var MarkerState = class extends DurableObject {
  static {
    __name(this, "MarkerState");
  }
  async load() {
    return await this.ctx.storage.get("state") || createState();
  }
  async save(state, alarmAt) {
    await this.ctx.storage.put("state", state);
    if (alarmAt) await this.ctx.storage.setAlarm(alarmAt);
    else await this.ctx.storage.deleteAlarm();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/ingest") {
      const payload = await request.json();
      const result = processIngest(await this.load(), payload);
      await this.save(result.state, result.nextAlarmAt);
      for (const log of result.logs) console.warn("[markers]", log);
      for (const item of result.events) this.broadcast(item);
      return json({ ok: true, events: result.events.length });
    }
    if (request.headers.get("Upgrade") !== "websocket") return json({ error: "expected websocket" }, 426);
    if (this.ctx.getWebSockets().length >= 500) return json({ error: "too many connections" }, 503);
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.send(JSON.stringify({ type: "marker:snapshot", markers: serializeMarkers(await this.load()) }));
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(message) {
    const raw = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(raw);
      } catch {
      }
    }
  }
  async alarm() {
    const result = processAlarm(await this.load());
    await this.save(result.state, result.nextAlarmAt);
    for (const item of result.events) this.broadcast(item);
  }
  webSocketMessage() {
  }
  webSocketClose() {
  }
  webSocketError() {
  }
};
var Presence = class extends DurableObject {
  static {
    __name(this, "Presence");
  }
  async fetch(request) {
    if (new URL(request.url).pathname === "/count") return json({ online: this.online() });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    this.push();
    return new Response(null, { status: 101, webSocket: client });
  }
  online() {
    return this.ctx.getWebSockets().length;
  }
  push() {
    const msg = JSON.stringify({ type: "online", online: this.online() });
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(msg);
      } catch {
      }
    }
  }
  webSocketMessage(ws) {
    ws.send(JSON.stringify({ type: "online", online: this.online() }));
  }
  webSocketClose() {
    this.push();
  }
  webSocketError() {
    this.push();
  }
};

// ../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-STMYMl/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../../AppData/Roaming/npm/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-STMYMl/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  MarkerState,
  Presence,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default,
  verifyToken
};
//# sourceMappingURL=worker.js.map
