(() => {
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/presence';
  let ws, tries = 0, beat = 0;
  const connect = () => {
    ws = new WebSocket(url);
    ws.onopen = () => { tries = 0; beat = setInterval(() => ws.readyState === 1 && ws.send('p'), 25000); };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        if (d.type !== 'online') return;
        window.FW = Object.assign(window.FW || {}, { online: d.online });
        document.dispatchEvent(new CustomEvent('fw:online', { detail: d.online }));
      } catch {}
    };
    ws.onclose = () => { clearInterval(beat); setTimeout(connect, Math.min(30000, 1000 * 2 ** tries++)); };
  };
  connect();
  addEventListener('pagehide', () => { try { ws.close(); } catch {} });
})();