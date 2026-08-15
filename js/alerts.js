/**
 * alerts.js · клієнт alerts.in.ua через Pages-проксі /api/alerts
 *
 * Дає три рівні тривог:
 *   oblast  → заливаємо всі райони області
 *   raion   → заливаємо конкретний район
 *   hromada / city → батьківський район у «частковому» стилі (P)
 *
 * geoBoundaries ADM2 віддає латиничні назви за держстандартом
 * транслітерації, тому матчинг робимо програмно, без таблиці на 136 рядків.
 */

const BASE = '/api/alerts';
const POLL_MS = 15_000;

/* ─── Області: порядок IoT API + офіційні UID ───────────────────────── */

export const OBLAST_ORDER = [
  'Автономна Республіка Крим', 'Волинська область', 'Вінницька область',
  'Дніпропетровська область', 'Донецька область', 'Житомирська область',
  'Закарпатська область', 'Запорізька область', 'Івано-Франківська область',
  'м. Київ', 'Київська область', 'Кіровоградська область', 'Луганська область',
  'Львівська область', 'Миколаївська область', 'Одеська область',
  'Полтавська область', 'Рівненська область', 'м. Севастополь',
  'Сумська область', 'Тернопільська область', 'Харківська область',
  'Херсонська область', 'Хмельницька область', 'Черкаська область',
  'Чернівецька область', 'Чернігівська область',
];

export const OBLAST_UID = {
  3: 'Хмельницька область', 4: 'Вінницька область', 5: 'Рівненська область',
  8: 'Волинська область', 9: 'Дніпропетровська область', 10: 'Житомирська область',
  11: 'Закарпатська область', 12: 'Запорізька область', 13: 'Івано-Франківська область',
  14: 'Київська область', 15: 'Кіровоградська область', 16: 'Луганська область',
  17: 'Миколаївська область', 18: 'Одеська область', 19: 'Полтавська область',
  20: 'Сумська область', 21: 'Тернопільська область', 22: 'Харківська область',
  23: 'Херсонська область', 24: 'Черкаська область', 25: 'Чернігівська область',
  26: 'Чернівецька область', 27: 'Львівська область', 28: 'Донецька область',
  29: 'Автономна Республіка Крим', 30: 'м. Севастополь', 31: 'м. Київ',
};

/** geoBoundaries ADM1 shapeName → назва в alerts.in.ua */
export const GEO_TO_ALERT = {
  Cherkaska: 'Черкаська область', Chernihivska: 'Чернігівська область',
  Chernivetska: 'Чернівецька область', Dnipropetrovska: 'Дніпропетровська область',
  Donetska: 'Донецька область', 'Ivano-Frankivska': 'Івано-Франківська область',
  Kharkivska: 'Харківська область', Khersonska: 'Херсонська область',
  Khmelnytska: 'Хмельницька область', Kirovohradska: 'Кіровоградська область',
  Kyivska: 'Київська область', Luhanska: 'Луганська область',
  Lvivska: 'Львівська область', Mykolaivska: 'Миколаївська область',
  Odeska: 'Одеська область', Poltavska: 'Полтавська область',
  Rivnenska: 'Рівненська область', Sumska: 'Сумська область',
  Ternopilska: 'Тернопільська область', Vinnytska: 'Вінницька область',
  Volynska: 'Волинська область', Zakarpatska: 'Закарпатська область',
  Zaporizka: 'Запорізька область', Zhytomyrska: 'Житомирська область',
  Kyiv: 'м. Київ', Crimea: 'Автономна Республіка Крим',
  Sevastopol: 'м. Севастополь',
};

/* ─── Транслітерація (держстандарт 2010) ────────────────────────────── */

const TR = {
  а:'a', б:'b', в:'v', г:'h', ґ:'g', д:'d', е:'e', є:'ie', ж:'zh', з:'z',
  и:'y', і:'i', ї:'i', й:'i', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p',
  р:'r', с:'s', т:'t', у:'u', ф:'f', х:'kh', ц:'ts', ч:'ch', ш:'sh',
  щ:'shch', ь:'', ю:'iu', я:'ia',
};
/** На початку слова частина літер читається інакше. */
const TR_INIT = { є:'ye', ї:'yi', й:'y', ю:'yu', я:'ya' };

export function translit(input = '') {
  return String(input)
    .toLowerCase()
    .replace(/[ʼ'’`]/g, '')
    .split(/([^а-яіїєґ]+)/u)
    .map((word) => {
      if (!/^[а-яіїєґ]/u.test(word)) return word;
      let out = '';
      for (let i = 0; i < word.length; i++) {
        // зг → zgh, інакше «зг» і «ж» злилися б в одне
        if (word[i] === 'з' && word[i + 1] === 'г') { out += 'zgh'; i++; continue; }
        out += (i === 0 && TR_INIT[word[i]]) || TR[word[i]] || word[i];
      }
      return out;
    })
    .join('');
}

/** Слова-типи, які треба зрізати перед матчингом. */
const STRIP = /\s*(район|міська|сільська|селищна|територіальна|громада|обл\.|область|м\.|місто|смт)\s*/gu;

/** Стабільний ключ: латиниця без службових суфіксів. */
export function key(name = '') {
  const latin = /[а-яіїєґ]/iu.test(name) ? translit(String(name).replace(STRIP, ' ')) : String(name).toLowerCase();
  return latin
    .replace(/[^a-z]/g, '')
    .replace(/(skyi|skyy|skiy|skyj|sky|ska|ske|skoho|skoi)$/, 'sk')
    .replace(/(yi|yy|iy|j)$/, '');
}

const oblastKey = (name) => key(String(name).replace(/^м\.\s*/u, ''));
/** Райони з однаковими назвами в різних областях розводимо префіксом. */
const scoped = (oblast, raion) => `${oblastKey(oblast)}|${key(raion)}`;

/* ─── Стан ──────────────────────────────────────────────────────────── */

let lastModified = null;
let lastError = null;
let lastSync = null;

const byTitle = new Map();       // location_title → alert
const fullOblasts = new Set();   // oblastKey, тривога на всю область
const fullRaions = new Set();    // scoped key, тривога на весь район
const partialRaions = new Set(); // scoped key, тривога в громаді/місті всередині
const looseRaions = new Set();   // key без області, фолбек

/* ─── Завантаження ──────────────────────────────────────────────────── */

export async function fetchAlerts() {
  const headers = {};
  if (lastModified) headers['If-Modified-Since'] = lastModified;

  let res;
  try {
    res = await fetch(`${BASE}/alerts/active.json`, { headers });
  } catch (e) {
    lastError = 'network';
    return snapshot();
  }

  if (res.status === 304) { lastError = null; lastSync = new Date(); return snapshot(); }

  if (!res.ok) {
    lastError = res.status === 401 ? 'token' : res.status === 429 ? 'ratelimit' : `http_${res.status}`;
    console.warn('[alerts]', lastError);
    return snapshot();
  }

  const lm = res.headers.get('Last-Modified');
  if (lm) lastModified = lm;

  let data;
  try { data = await res.json(); } catch { lastError = 'parse'; return snapshot(); }

  ingest(data.alerts ?? []);
  lastError = null;
  lastSync = new Date();
  return snapshot();
}

function ingest(list) {
  byTitle.clear(); fullOblasts.clear(); fullRaions.clear();
  partialRaions.clear(); looseRaions.clear();

  for (const a of list) {
    if (a.alert_type !== 'air_raid') continue;
    if (a.finished_at) continue;

    const alert = {
      id: a.id,
      uid: a.location_uid,
      level: a.location_type,          // oblast | raion | hromada | city | unknown
      title: a.location_title,
      oblast: a.location_oblast || a.location_title,
      raion: a.location_raion || null,
      notes: a.notes || '',
      startedAt: a.started_at ? new Date(a.started_at) : null,
      calculated: !!a.calculated,
    };
    byTitle.set(alert.title, alert);

    if (alert.level === 'oblast') {
      fullOblasts.add(oblastKey(alert.title));
      continue;
    }

    if (alert.level === 'raion') {
      fullRaions.add(scoped(alert.oblast, alert.title));
      looseRaions.add(key(alert.title));
      continue;
    }

    // hromada / city / unknown: точних полігонів немає,
    // тому позначаємо батьківський район як часткову тривогу
    const parent = alert.raion || alert.title;
    partialRaions.add(scoped(alert.oblast, parent));
    looseRaions.add(key(parent));
  }
}

/** Запускає опитування і повертає stop(). */
export function startPolling(onUpdate, ms = POLL_MS) {
  let alive = true;
  const tick = async () => {
    if (!alive) return;
    const s = await fetchAlerts();
    if (alive) onUpdate?.(s);
  };
  tick();
  const id = setInterval(tick, Math.max(10_000, ms));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  return () => { alive = false; clearInterval(id); };
}

/* ─── Читання стану ─────────────────────────────────────────────────── */

const snapshot = () => ({ alerts: byTitle, error: lastError, syncedAt: lastSync });

export const getAlerts = () => byTitle;
export const getError = () => lastError;
export const getSyncedAt = () => lastSync;
export const hasAlarm = (title) => byTitle.has(title);

/**
 * Статус району на мапі.
 * @param {{name:string, oblastUa:string}} region
 * @returns {'full'|'partial'|'none'}
 */
export function raionStatus(region) {
  if (!region) return 'none';
  const ok = oblastKey(region.oblastUa || '');
  if (ok && fullOblasts.has(ok)) return 'full';

  const s = `${ok}|${key(region.name)}`;
  if (fullRaions.has(s)) return 'full';
  if (partialRaions.has(s)) return 'partial';

  // фолбек, якщо область для полігона не визначилась
  if (!ok && looseRaions.has(key(region.name))) return 'partial';
  return 'none';
}

/** 'A' — вся область, 'P' — частково, 'N' — тихо. */
export function oblastStatus(title) {
  const ok = oblastKey(title);
  if (fullOblasts.has(ok)) return 'A';
  for (const a of byTitle.values()) {
    if (a.level !== 'oblast' && oblastKey(a.oblast) === ok) return 'P';
  }
  return 'N';
}

export const oblastHasAnyAlarm = (title) => oblastStatus(title) !== 'N';

/** Усе для сайдбару, згруповано за рівнем. */
export function alarmSummary() {
  const all = [...byTitle.values()];
  const pick = (...levels) => all
    .filter((a) => levels.includes(a.level))
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));

  const oblasts = OBLAST_ORDER.map((title) => ({ title, status: oblastStatus(title) }));
  return {
    oblasts,
    oblastAlarms: pick('oblast'),
    raionAlarms: pick('raion'),
    hromadaAlarms: pick('hromada', 'city', 'unknown'),
    countFull: oblasts.filter((o) => o.status === 'A').length,
    countPartial: oblasts.filter((o) => o.status === 'P').length,
    total: all.length,
  };
}

/** Що з'явилось / зникло з минулого разу — для стрічки «Ефір». */
let prevKeys = new Set();
export function diffAlarms() {
  const now = new Set(byTitle.keys());
  const started = [...now].filter((k) => !prevKeys.has(k));
  const ended = [...prevKeys].filter((k) => !now.has(k));
  prevKeys = now;
  return { started, ended };
}