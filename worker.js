export default {
  async fetch(request, env) {
    const url = new URL(request.url);
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
    return env.ASSETS.fetch(request);
  },
};