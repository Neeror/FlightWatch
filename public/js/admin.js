/* Адмінка FlightWatch: 5 тапів по бренду → пароль → адмін-режим */
(() => {
  const KEY = 'fw_admin';
  const TAPS = 5;
  const GAP = 900;              // максимум між тапами, мс

  let taps = 0, timer = 0, bar = null;

  const stored = () => {
    try {
      const t = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (!t?.token || t.exp < Date.now()) { localStorage.removeItem(KEY); return null; }
      return t;
    } catch { return null; }
  };

  const css = document.createElement('style');
  css.textContent = `
  .fw-gate{position:fixed;inset:0;z-index:2000;display:grid;place-items:center;padding:16px;
    background:oklch(0.225 0.014 55/.42);animation:fwFade .25s ease}
  @keyframes fwFade{from{opacity:0}to{opacity:1}}
  .fw-gate form{width:min(440px,100%);background:var(--panel,#fff);border-radius:22px;padding:22px;
    box-shadow:0 24px 70px oklch(0.225 0.014 55/.28);animation:fwLift .3s cubic-bezier(.16,1,.3,1)}
  @keyframes fwLift{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}
  .fw-gate input{width:100%;padding:15px 18px;border-radius:12px;border:2px solid #3b82f6;
    background:var(--panel,#fff);font-size:1.0625rem;font-weight:600;outline:none}
  .fw-gate input::placeholder{color:var(--ink-3,#94a3b8);font-weight:600}
  .fw-gate input[data-bad]{border-color:var(--sig,#dc2626);animation:fwShake .3s}
  @keyframes fwShake{25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
  .fw-gate .row{display:flex;justify-content:flex-end;gap:12px;margin-top:18px}
  .fw-gate button{padding:12px 22px;border-radius:12px;font-size:.9375rem;font-weight:700;cursor:pointer}
  .fw-gate .no{border:1px solid var(--line,#e2e8f0);color:var(--ink-2,#475569);background:none}
  .fw-gate .yes{border:0;background:#2563eb;color:#fff}
  .fw-gate .yes[disabled]{opacity:.6}
  .fw-adminbar{display:flex;align-items:center;gap:9px;flex:none;padding:4px 6px 4px 12px;border-radius:99px;
 background:oklch(0.225 0.014 55/.94);color:#fff;font-size:.6875rem;font-weight:800;letter-spacing:.1em}
  .fw-adminbar i{width:8px;height:8px;border-radius:50%;background:#22c55e}
  .fw-adminbar button{color:#fff;font-size:.625rem;font-weight:700;letter-spacing:.06em;border:0;
    background:oklch(1 0 0/.15);padding:5px 11px;border-radius:99px;cursor:pointer}
  .fw-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;
    background:var(--ink,#1e293b);color:#fff;padding:10px 18px;border-radius:10px;font-size:.8125rem;
    z-index:2100;pointer-events:none;transition:.28s cubic-bezier(.16,1,.3,1)}
  .fw-toast[data-on]{opacity:1;transform:translateX(-50%) translateY(0)}`;
  document.head.appendChild(css);

  const toast = (text) => {
    const el = document.createElement('div');
    el.className = 'fw-toast';
    el.textContent = text;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.setAttribute('data-on', ''));
    setTimeout(() => { el.removeAttribute('data-on'); setTimeout(() => el.remove(), 400); }, 2200);
  };

  function enter() {
    document.body.classList.add('is-admin');
    if (bar) return;
    bar = document.createElement('div');
    bar.className = 'fw-adminbar';
    bar.innerHTML = `<i></i><span>АДМІН</span><button type="button">Вийти</button>`;
    bar.querySelector('button').onclick = leave;
    const host = document.querySelector('.bar');
    if (host) host.insertBefore(bar, host.querySelector('.stamp')); else document.body.appendChild(bar);
    const live = document.createElement('span');
    live.className = 'fw-online';
    live.textContent = '— онлайн';
    bar.insertBefore(live, bar.querySelector('button'));
    const set = (n) => { live.textContent = n + ' онлайн'; };
    document.addEventListener('fw:online', (e) => set(e.detail));
    if (window.FW?.online != null) set(window.FW.online);
    fetch('/api/admin/online', { headers: { Authorization: 'Bearer ' + stored()?.token } })
       .then((r) => r.ok && r.json()).then((d) => d && set(d.online)).catch(() => {});
  }

  function leave() {
    localStorage.removeItem(KEY);
    document.body.classList.remove('is-admin');
    bar?.remove();
    bar = null;
    toast('Вихід з адмінки');
  }

  function askPassword() {
    if (document.querySelector('.fw-gate')) return;
    const gate = document.createElement('div');
    gate.className = 'fw-gate';
    gate.innerHTML = `<form novalidate>
      <input type="password" placeholder="Пароль" autocomplete="current-password" enterkeyhint="go">
      <div class="row">
        <button type="button" class="no">Скасувати</button>
        <button type="submit" class="yes">Увійти</button>
      </div>
    </form>`;
    const input = gate.querySelector('input');
    const yes = gate.querySelector('.yes');
    const close = () => { gate.remove(); document.removeEventListener('keydown', esc); };
    function esc(e) { if (e.key === 'Escape') close(); }

    gate.querySelector('.no').onclick = close;
    gate.addEventListener('click', (e) => { if (e.target === gate) close(); });
    document.addEventListener('keydown', esc);

    gate.querySelector('form').onsubmit = async (e) => {
      e.preventDefault();
      yes.disabled = true;
      try {
        const r = await fetch('/api/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: input.value }),
        });
        if (!r.ok) throw new Error('nope');
        localStorage.setItem(KEY, JSON.stringify(await r.json()));
        close();
        enter();
        toast('Адмін-режим увімкнено');
      } catch {
        input.value = '';
        input.setAttribute('data-bad', '');
        setTimeout(() => input.removeAttribute('data-bad'), 400);
        input.focus();
      } finally {
        yes.disabled = false;
      }
    };

    document.body.appendChild(gate);
    setTimeout(() => input.focus(), 60);
  }

  // 5 тапів по панельці з логотипом (мишка і тач однаково)
  const zone = document.querySelector('.brand') || document.querySelector('.rail') || document.body;
  zone.style.webkitTouchCallout = 'none';
  zone.addEventListener('click', (e) => {
    if (e.target.closest('a')) return;                      // @flightwatch не ламаємо
    if (document.body.classList.contains('is-admin')) return;
    if (document.querySelector('.fw-gate')) return;
    taps++;
    clearTimeout(timer);
    timer = setTimeout(() => { taps = 0; }, GAP);
    if (taps >= TAPS) { taps = 0; clearTimeout(timer); askPassword(); }
  });

  if (stored()) enter();                                    // сесія живе 12 годин

  window.FW = Object.assign(window.FW || {}, {
    isAdmin: () => Boolean(stored()),
    token: () => stored()?.token || null,
    logout: leave,
  });
})();