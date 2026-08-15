/**
 * FlightWatch · Cloudflare Pages Function
 * Проксі до api.alerts.in.ua
 *
 * Маршрут:  /api/alerts/*  ->  https://api.alerts.in.ua/v1/*
 * Без шляху: /api/alerts    ->  .../v1/alerts/active.json
 *
 * Токен живе тільки на edge і ніколи не потрапляє в браузер.
 */

const UPSTREAM = 'https://api.alerts.in.ua/v1';
const DEFAULT_PATH = 'alerts/active.json';

/** Білий список шляхів — щоб через проксі не можна було смикати що завгодно. */
const ALLOWED = new Set([
  'alerts/active.json',
  'iot/active_air_raid_alerts_by_oblast.json',
  'iot/active_air_raid_alerts.json',
]);

const SOFT_TTL_MS = 5_000;         // м'який кеш: гасить бурсти, береже rate limit
const UPSTREAM_TIMEOUT_MS = 8_000; // не висимо на мертвому upstream

/** Кеш у памʼяті ізоляту: path -> { body, lastModified, at } */
const memo = new Map();

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'If-Modified-Since, Content-Type',
  'Access-Control-Max-Age': '86400',
};

const BASE_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
  ...CORS,
};

const fail = (error, status, extra = {}) =>
  new Response(JSON.stringify({ error, ...extra }), { status, headers: BASE_HEADERS });

export const onRequestOptions = () => new Response(null, { status: 204, headers: CORS });

export async function onRequest({ request, params, env }) {
  const isHead = request.method === 'HEAD';
  if (request.method !== 'GET' && !isHead) {
    return fail('method_not_allowed', 405, { allow: 'GET, HEAD, OPTIONS' });
  }

  if (!env.ALERTS_TOKEN) {
    return fail('missing_token', 500, {
      hint: 'Додай ALERTS_TOKEN: локально у .env, на проді у Pages > Settings > Variables and Secrets',
    });
  }

  const segments = [].concat(params.path ?? []).filter(Boolean);
  const path = segments.length ? segments.join('/') : DEFAULT_PATH;
  if (!ALLOWED.has(path)) return fail('forbidden_path', 403, { path });

  const clientIMS = request.headers.get('If-Modified-Since');
  const cached = memo.get(path);

  // 1. Свіжий мʼякий кеш — вгору не йдемо взагалі.
  if (cached && Date.now() - cached.at < SOFT_TTL_MS) {
    return serve(cached, clientIMS, isHead, 'HIT');
  }

  // 2. Ревалідація. Використовуємо власний Last-Modified, якщо він є.
  let upstream;
  try {
    upstream = await callUpstream(path, cached?.lastModified ?? clientIMS, env.ALERTS_TOKEN);
  } catch (err) {
    if (cached) return serve(cached, clientIMS, isHead, 'STALE');
    return fail('upstream_unreachable', 502, { detail: String(err?.message ?? err) });
  }

  // 304 від upstream: дані не змінились.
  if (upstream.status === 304) {
    if (cached) {
      cached.at = Date.now();
      return serve(cached, clientIMS, isHead, 'REVALIDATED');
    }
    return new Response(null, {
      status: 304,
      headers: { ...BASE_HEADERS, ...lastModified(upstream.lastModified), 'X-Proxy-Cache': 'CLIENT-304' },
    });
  }

  if (upstream.ok) {
    const entry = { body: upstream.body, lastModified: upstream.lastModified, at: Date.now() };
    memo.set(path, entry);
    return serve(entry, clientIMS, isHead, 'MISS');
  }

  // Upstream дав помилку. На 429/5xx краще старі дані, ніж порожня мапа.
  if (cached && (upstream.status === 429 || upstream.status >= 500)) {
    return serve(cached, clientIMS, isHead, `STALE-${upstream.status}`);
  }

  return new Response(JSON.stringify({
    error: upstream.status === 401 ? 'invalid_token'
         : upstream.status === 429 ? 'rate_limited'
         : 'upstream_error',
    status: upstream.status,
  }), { status: upstream.status, headers: BASE_HEADERS });
}

/* ─── helpers ─────────────────────────────────────────────────────────── */

async function callUpstream(path, ims, token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'FlightWatch/1.0',
  };
  if (ims) headers['If-Modified-Since'] = ims;

  const res = await fetch(`${UPSTREAM}/${path}`, {
    headers,
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    cf: { cacheTtl: 0, cacheEverything: false },
  });

  return {
    status: res.status,
    ok: res.ok,
    lastModified: res.headers.get('Last-Modified'),
    body: res.status === 304 ? null : await res.text(),
  };
}

function serve(entry, clientIMS, isHead, cacheState) {
  const headers = {
    ...BASE_HEADERS,
    ...lastModified(entry.lastModified),
    'X-Proxy-Cache': cacheState,
  };

  // Клієнт уже має цю саму версію.
  if (clientIMS && entry.lastModified && clientIMS === entry.lastModified) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(isHead ? null : entry.body, { status: 200, headers });
}

const lastModified = (v) => (v ? { 'Last-Modified': v } : {});