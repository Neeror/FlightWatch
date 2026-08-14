export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Проксі для alerts.in.ua
    if (url.pathname.startsWith('/api/alerts')) {
      const apiPath = url.pathname.replace('/api/alerts', '') || '/alerts/active.json';

      const headers = {
        'Authorization': `Bearer ${env.ALERTS_TOKEN}`,
      };

      const ims = request.headers.get('If-Modified-Since');
      if (ims) headers['If-Modified-Since'] = ims;

      try {
        const apiRes = await fetch(
          `https://api.alerts.in.ua/v1${apiPath}`,
          { headers }
        );

        const body = apiRes.status === 304 ? null : await apiRes.text();

        return new Response(body, {
          status: apiRes.status,
          headers: {
            'Content-Type':                'application/json; charset=utf-8',
            'Last-Modified':               apiRes.headers.get('Last-Modified') || '',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control':               'no-store',
          },
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Все інше — статика FlightWatch
    return env.ASSETS.fetch(request);
  },
};