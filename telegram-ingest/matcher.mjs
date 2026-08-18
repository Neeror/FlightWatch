export function normalize(text) {
  return String(text ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// ── категорії загроз ───────────────────────────────────────────────
export const CATEGORY_PATTERNS = {
  fpv: [
    /\bfpv\b/i,
    /фпв/i,
    /фп[\s-]?в/i,
    /фпішк/i,
    /дрон[\wа-яіїєґ]*\s+камікадзе/i,
    /кам[iі]кадзе[\wа-яіїєґ]*\s+дрон/i,
  ],
  molniya: [
    /молн/i,              // молнія, молния, молнії, молній
    /molni/i,
    /\bмлн\b/i,
    /лютий\s?звір/i,
  ],
  kab: [
    /\bкаб[иіїув]?\b/i,
    /\bкаб[-\s]?\d{2,4}/i,
    /\bкаб(ами|ів|ом|ах)\b/i,
    /\bkab\b/i,
    /умпк/i,
    /керован[\wа-яіїєґ]*\s+(авіа|бомб)/i,
    /авіабомб/i,
    /\bфаб[-\s]?\d{3}/i,
    /скид[\wа-яіїєґ]*\s+кab?/i,
  ],
  recon: [
    /розв[iі]дн/i,           // розвідник, розвідники
    /розв[iі]дувальн/i,
    /дорозв[iі]дк/i,
    /развед/i,
    /\bорлан\b/i,
    /\bzala\b/i,
    /\bзала\b/i,
    /supercam|суперкам/i,
    /\bмерл[iі]н\b|\bmerlin\b/i,
    /\bфорпост\b/i,
    /елерон|элерон/i,
    /\bлел[eе]ка\b/i,
    /крил[\wа-яіїєґ]*\s+розв[iі]дк/i,
  ],
  shahed: [
    /шахед|shahed|герань|geran/i,
    /бпла\s+тип[уy]/i,
  ],
  ballistic: [
    /бал[iі]ст/i,
    /\bкрилат[\wа-яіїєґ]*\s+ракет/i,
    /\bіскандер\b|\bискандер\b/i,
    /кинжал/i,
  ],
};

// ── оновлення / зміна статусу ─────────────────────────────────────
export const STATUS_PATTERNS = [
  /оновлено/i,
  /оновлення/i,
  /❌/,
  /✅/,
  /\bчисто\b/i,
  /в[iі]дб[iі]й/i,
  /загроза\s+минула/i,
  /\bминул/i,
  /зб[iи]т/i,
  /уражен/i,
  /\bм[iі]нус\b/i,
  /вийш[ол]/i,
  /залиш[иеє]/i,
  /зникл/i,
  /коригув/i,
  /скасов|відмін/i,
  /не\s+п[iі]дтвердж/i,
  /вже\s+не/i,
];

function testAny(patterns, text) {
  for (const re of patterns) {
    const rx = re instanceof RegExp ? re : new RegExp(re, "i");
    const hit = rx.exec(text);
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

/**
 * ctx: { isReplyToTracked, isEdit, wasTracked }
 */
export function matchMessage(text, chatCfg = {}, ctx = {}) {
  const clean = normalize(text);
  if (chatCfg.mode === "all") {
    return { matched: true, kind: "all", categories: [], hits: [], status: detectStatus(clean) };
  }

  const cats = chatCfg.categories?.length ? chatCfg.categories : Object.keys(CATEGORY_PATTERNS);
  const found = detectCategories(clean, cats, chatCfg.extraPatterns || {});
  const status = detectStatus(clean, chatCfg.statusPatterns || []);

  // відповідь на залогований алерт або правка залогованого — беремо завжди
  if (ctx.isReplyToTracked || (ctx.isEdit && ctx.wasTracked)) {
    return {
      matched: true,
      kind: ctx.isEdit ? "edit" : "followup",
      categories: found.map((f) => f.category),
      hits: found.map((f) => f.hit),
      status,
    };
  }

  if (found.length > 0) {
    return {
      matched: true,
      kind: "alert",
      categories: found.map((f) => f.category),
      hits: found.map((f) => f.hit),
      status,
    };
  }

  return { matched: false, kind: "skip", categories: [], hits: [], status };
}