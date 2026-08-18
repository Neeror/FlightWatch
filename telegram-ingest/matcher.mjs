// ── межі слова, які реально працюють з кирилицею ───────────────
// JS \b рахує тільки [A-Za-z0-9_], тому /\bкаб\b/ НІКОЛИ не матчить "КАБ".
const BS = String.raw`(?<![\p{L}\p{N}_])`;
const BE = String.raw`(?![\p{L}\p{N}_])`;
const w = (body) => new RegExp(BS + body + BE, "iu");

export function normalize(text) {
  return String(text ?? "")
    .replace(/ /g, " ")
    .replace(/[«»"„“”]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ── категорії загроз ───────────────────────────────────
export const CATEGORY_PATTERNS = {
  fpv: [
    w("fpv"),
    /фпв/i,
    /фп[\s-]?в/i,
    /фпішк/i,
    /дрон[\wа-яіїєґ]*\s+камікадзе/i,
    /кам[iі]кадзе[\wа-яіїєґ]*\s+дрон/i,
  ],
  molniya: [
    /молн/i, // молнія, молния, молнії, молній
    /molni/i,
    w("млн"),
    /лютий\s?звір/i,
  ],
  kab: [
    w("каб[аиіїувою]?"),
    w("каб(ами|ів|ом|ах)"),
    /каб[-\s]?\d{2,4}/i,
    w("kab"),
    /умпк/i,
    /керован[\wа-яіїєґ]*\s+(авіа|бомб)/i,
    /авіабомб/i,
    /фаб[-\s]?\d{3}/i,
  ],
  recon: [
    /розв[iі]дн/i, // розвідник, розвідники
    /розв[iі]дувальн/i,
    /дорозв[iі]д/i, // дорозвідка, дорозвідник
    /развед/i,
    w("орлан[а-яіїєґ]*"),
    w("zala"),
    w("зала"),
    /supercam|суперкам/i,
    w("мерл[iі]н[а-яіїєґ]*"),
    w("merlin"),
    w("форпост[а-яіїєґ]*"),
    /елерон|элерон/i,
    w("лел[eе]к[аиу]"),
    /крил[\wа-яіїєґ]*\s+розв[iі]дк/i,
  ],
  shahed: [
    /шахед|shahed|герань|geran|мопед/i,
    /бпла\s+тип[уy]/i,
    // формат Карти повітряних тривог: "✈️Чернігівщина: →Славутич/Київщина;"
    /✈️?[^:]{2,60}:\s*[→➡▶]/u,
    /[→➡▶]\s*[А-ЯІЇЄҐ][а-яіїєґ'’-]+/u,
  ],
  ballistic: [
    /бал[iі]ст/i, // балістика, балістичного озброєння
    w("[iі]скандер[а-яіїєґ]*"),
    w("искандер[а-яіїєґ]*"),
    /кинжал|кінжал/i,
    /цирко[нh]/i,
    w("кн-?2[34]"),
  ],
  // крилаті ракети — ОКРЕМО від балістики (це різні типи цілей)
  cruise: [
    /крилат[\wа-яіїєґ]*\s+ракет/i,
    /х[-\s]?101|kh[-\s]?101/i,
    /х[-\s]?555|х[-\s]?55(?![\d])/i,
    /х[-\s]?(?:22|32|35|59)(?![\d])/i,
    /кал[iі]бр|kalibr/i,
    // "Група КР курсом на Ромни", "2х Групи КР курсом на Гадяч"
    new RegExp(String.raw`груп[аиуой]?\S*\s+кр` + BE, "iu"),
    new RegExp(BS + String.raw`кр` + BE + String.raw`\s*(?:курс|на\s)`, "iu"),
  ],
  banderol: [
    /бандерол/i,
    /banderol/i,
    w("с[-\\s]?8000"),
  ],
};

// ── оновлення / зміна статусу / відбій ──────────────────────
export const STATUS_PATTERNS = [
  /оновлено/i,
  /оновлення/i,
  /❌/,
  /✅/,
  w("чисто"),
  /в[iі]дб[iі]й/i,
  /в[iі]дпочивайте/i,
  /загроза\s+(минула|в[iі]дсутн)/i,
  /без\s+загроз/i,
  /минул/i,
  /зб[iи]т/i,
  /уражен/i,
  w("м[iі]нус"),
  /вийш[ол]/i,
  /залиш[иеє]/i,
  /зникл/i,
  /коригув/i,
  /скасов|відмін/i,
  /не\s+п[iі]дтвердж/i,
  /вже\s+не/i,
];

function compile(re) {
  if (re instanceof RegExp) return re;
  try {
    return new RegExp(re, "iu"); // \p{...} і лукбехайнди з рядків config.json
  } catch {
    return new RegExp(re, "i");
  }
}

function testAny(patterns, text) {
  for (const re of patterns) {
    const hit = compile(re).exec(text);
    if (hit) return hit[0];
  }
  return null;
}

export function detectCategories(text, categories = Object.keys(CATEGORY_PATTERNS), extra = {}) {
  const clean = normalize(text);
  if (!clean) return [];
  const found = [];
  for (const cat of categories) {
    const patterns = [...(CATEGORY_PATTERNS[cat] || []), ...(extra[cat] || [])];
    const hit = testAny(patterns, clean);
    if (hit) found.push({ category: cat, hit });
  }
  return found;
}

export function detectStatus(text, extraPatterns = []) {
  return testAny([...STATUS_PATTERNS, ...extraPatterns], normalize(text));
}

const skip = (reason, status = null) => ({
  matched: false,
  kind: "skip",
  reason,
  categories: [],
  hits: [],
  status,
});

/**
 * chatCfg: { mode, categories, extraPatterns, statusPatterns,
 *            takeEdits=true, takeReplies=true, takeStatusOnly=false }
 * ctx: { isReplyToTracked, isEdit, wasTracked }
 */
export function matchMessage(text, chatCfg = {}, ctx = {}) {
  const clean = normalize(text);

  // канал, де правки повідомлень не цікавлять (flight_watch)
  if (ctx.isEdit && chatCfg.takeEdits === false) return skip("edits-disabled", detectStatus(clean));

  if (chatCfg.mode === "all") {
    return { matched: true, kind: "all", reason: "mode=all", categories: [], hits: [], status: detectStatus(clean) };
  }

  const cats = chatCfg.categories?.length ? chatCfg.categories : Object.keys(CATEGORY_PATTERNS);
  const found = detectCategories(clean, cats, chatCfg.extraPatterns || {});
  const status = detectStatus(clean, chatCfg.statusPatterns || []);

  // будь-яка відповідь на залогований алерт або правка залогованого
  const isReply = ctx.isReplyToTracked && chatCfg.takeReplies !== false;
  if (isReply || (ctx.isEdit && ctx.wasTracked)) {
    return {
      matched: true,
      kind: ctx.isEdit ? "edit" : "followup",
      reason: ctx.isEdit ? "edit-of-tracked" : "reply-to-tracked",
      categories: found.map((f) => f.category),
      hits: found.map((f) => f.hit),
      status,
    };
  }

  if (found.length > 0) {
    return {
      matched: true,
      kind: "alert",
      reason: "category",
      categories: found.map((f) => f.category),
      hits: found.map((f) => f.hit),
      status,
    };
  }

  // самостійні "Чисто" / "Відбій ... Відпочивайте" без назви цілі
  if (status && chatCfg.takeStatusOnly) {
    return { matched: true, kind: "status", reason: "status-only", categories: [], hits: [status], status };
  }

  return skip("no-match", status);
}