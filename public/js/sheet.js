(() => {
  const MQ = matchMedia('(max-width:900px)');
  const app = document.querySelector('.app');
  const rail = document.querySelector('.rail');
  const handle = rail?.querySelector('.handle');
  if (!app || !rail || !handle) return;

  const KEY = 'fw_sheet';
  const ORDER = ['peek', 'half', 'full'];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const stops = () => {
    const brand = rail.querySelector('.brand');
    return {
      peek: Math.round(handle.offsetHeight + (brand?.offsetHeight || 56)),
      half: Math.round(innerHeight * 0.44),
      full: Math.round(innerHeight * 0.88),
    };
  };

  let state = localStorage.getItem(KEY) || (innerWidth <= 560 ? 'peek' : 'half');
  let raf = 0;
  const redraw = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; dispatchEvent(new Event('resize')); });
  };

  function apply(next, animate = true) {
    state = ORDER.includes(next) ? next : 'half';
    rail.classList.toggle('dragging', !animate);
    rail.style.setProperty('--sheet-h', stops()[state] + 'px');
    app.dataset.sheet = state;
    handle.setAttribute('aria-expanded', String(state !== 'peek'));
    handle.setAttribute('aria-label', state === 'peek' ? 'Розгорнути панель' : 'Згорнути панель');
    localStorage.setItem(KEY, state);
    if (!animate) requestAnimationFrame(() => rail.classList.remove('dragging'));
    redraw();
  }

  handle.setAttribute('role', 'button');
  handle.tabIndex = 0;

  let sy = 0, sh = 0, drag = false, moved = false;
  handle.addEventListener('pointerdown', (e) => {
    if (!MQ.matches) return;
    drag = true; moved = false; sy = e.clientY; sh = rail.offsetHeight;
    handle.setPointerCapture(e.pointerId);
    rail.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = sy - e.clientY;
    if (Math.abs(dy) > 4) moved = true;
    const s = stops();
    rail.style.setProperty('--sheet-h', clamp(sh + dy, s.peek, s.full) + 'px');
    redraw();
  });
  const finish = (e) => {
    if (!drag) return;
    drag = false;
    handle.releasePointerCapture?.(e.pointerId);
    if (!moved) return apply(state === 'peek' ? 'half' : 'peek');
    const h = rail.offsetHeight, s = stops();
    apply(ORDER.reduce((a, b) => (Math.abs(s[b] - h) < Math.abs(s[a] - h) ? b : a)));
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);

  handle.addEventListener('keydown', (e) => {
    const i = ORDER.indexOf(state);
    if (e.key === 'ArrowUp') { e.preventDefault(); apply(ORDER[Math.min(2, i + 1)]); }
    if (e.key === 'ArrowDown') { e.preventDefault(); apply(ORDER[Math.max(0, i - 1)]); }
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); apply(state === 'peek' ? 'half' : 'peek'); }
  });

  // тап по табу з peek — одразу розгортаємо
  rail.querySelectorAll('.tab').forEach((t) =>
    t.addEventListener('click', () => { if (MQ.matches && state === 'peek') apply('half'); }, true));

  rail.addEventListener('transitionend', (e) => { if (e.propertyName === 'height') redraw(); });

  const sync = () => {
    if (MQ.matches) apply(state, false);
    else { rail.style.removeProperty('--sheet-h'); delete app.dataset.sheet; redraw(); }
  };
  MQ.addEventListener('change', sync);
  addEventListener('orientationchange', () => setTimeout(sync, 250));
  sync();
})();
