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

    return env.ASSETS.fetch(request);
  },
};