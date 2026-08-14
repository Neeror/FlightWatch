/**
 * alerts-api.js
 * Клієнт API alerts.in.ua через Cloudflare Worker проксі.
 */

const BASE = '/api/alerts';

// ─── Порядок областей в IoT API (index → title) ───────────────────────────
export const OBLAST_ORDER = [
  'Автономна Республіка Крим',
  'Волинська область',
  'Вінницька область',
  'Дніпропетровська область',
  'Донецька область',
  'Житомирська область',
  'Закарпатська область',
  'Запорізька область',
  'Івано-Франківська область',
  'м. Київ',
  'Київська область',
  'Кіровоградська область',
  'Луганська область',
  'Львівська область',
  'Миколаївська область',
  'Одеська область',
  'Полтавська область',
  'Рівненська область',
  'м. Севастополь',
  'Сумська область',
  'Тернопільська область',
  'Харківська область',
  'Херсонська область',
  'Хмельницька область',
  'Черкаська область',
  'Чернівецька область',
  'Чернігівська область',
];

// ─── Mapping: geoBoundaries shapeName → alerts.in.ua назва ────────────────
export const GEO_TO_ALERT = {
  'Cherkaska':         'Черкаська область',
  'Chernihivska':      'Чернігівська область',
  'Chernivetska':      'Чернівецька область',
  'Dnipropetrovska':   'Дніпропетровська область',
  'Donetska':          'Донецька область',
  'Ivano-Frankivska':  'Івано-Франківська область',
  'Kharkivska':        'Харківська область',
  'Khersonska':        'Херсонська область',
  'Khmelnytska':       'Хмельницька область',
  'Kirovohradska':     'Кіровоградська область',
  'Kyivska':           'Київська область',
  'Luhanska':          'Луганська область',
  'Lvivska':           'Львівська область',
  'Mykolaivska':       'Миколаївська область',
  'Odeska':            'Одеська область',
  'Poltavska':         'Полтавська область',
  'Rivnenska':         'Рівненська область',
  'Sumska':            'Сумська область',
  'Ternopilska':       'Тернопільська область',
  'Vinnytska':         'Вінницька область',
  'Volynska':          'Волинська область',
  'Zakarpatska':       'Закарпатська область',
  'Zaporizka':         'Запорізька область',
  'Zhytomyrska':       'Житомирська область',
  'Kyiv':              'м. Київ',
  'Crimea':            'Автономна Республіка Крим',
  'Sevastopol':        'м. Севастополь',
};

// ─── Внутрішній стан ──────────────────────────────────────────────────────
let _lastModified = null;
/** @type {Map<string, object>} location_title → alert object */
const _alerts = new Map();

// ─── Публічне API ─────────────────────────────────────────────────────────

/**
 * Завантажити активні тривоги з API.
 * Автоматично кешує через If-Modified-Since.
 * @returns {Promise<Map<string, object>>}
 */
export async function fetchAlerts() {
  const headers = {};
  if (_lastModified) headers['If-Modified-Since'] = _lastModified;

  try {
    const res = await fetch(`${BASE}/alerts/active.json`, { headers });

    if (res.status === 304) {
      console.log('[alerts] 304 — без змін');
      return _alerts;
    }

    if (res.status === 401) {
      console.error('[alerts] ❌ Невірний токен!');
      return _alerts;
    }

    if (res.status === 429) {
      console.warn('[alerts] ⚠️ Rate limit — почекай хвилину');
      return _alerts;
    }

    if (!res.ok) {
      console.error('[alerts] HTTP помилка:', res.status);
      return _alerts;
    }

    const lm = res.headers.get('Last-Modified');
    if (lm) _lastModified = lm;

    const data = await res.json();

    _alerts.clear();
    for (const a of (data.alerts ?? [])) {
      // Тільки активні повітряні тривоги
      if (a.alert_type !== 'air_raid') continue;
      if (a.finished_at) continue;

      _alerts.set(a.location_title, {
        id:         a.id,
        uid:        a.location_uid,
        type:       a.location_type,     // 'oblast' | 'raion' | 'hromada' | 'city'
        title:      a.location_title,
        oblast:     a.location_oblast,
        raion:      a.location_raion,
        startedAt:  new Date(a.started_at),
        calculated: a.calculated,
      });
    }

    console.log(`[alerts] ✅ ${_alerts.size} активних тривог`);
    return _alerts;

  } catch (e) {
    console.error('[alerts] Помилка fetch:', e);
    return _alerts;
  }
}

/** Поточний стан тривог (без запиту) */
export const getAlerts = () => _alerts;

/** Чи є тривога в регіоні? */
export const hasAlarm = (title) => _alerts.has(title);

/** Чи є хоч якась тривога в цій області (область або райони)? */
export function oblastHasAnyAlarm(oblastTitle) {
  for (const [, a] of _alerts) {
    if (a.title === oblastTitle || a.oblast === oblastTitle) return true;
  }
  return false;
}

/** Тривоги рівня "область" */
export const oblastAlarms = () =>
  [..._alerts.values()].filter(a => a.type === 'oblast');

/** Тривоги рівня "район/громада" */
export const raionAlarms = () =>
  [..._alerts.values()].filter(a => a.type === 'raion' || a.type === 'hromada' || a.type === 'city');