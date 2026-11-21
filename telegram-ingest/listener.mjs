import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import telegram from "telegram";
import sessions from "telegram/sessions/index.js";
import events from "telegram/events/index.js";
import editedMod from "telegram/events/EditedMessage.js";
import connections from "telegram/network/connection/index.js";
import input from "input";
import { matchMessage } from "./matcher.mjs";
import { analyzeMessage, isAiEnabled, validateAiConfig } from "./ai-processor.mjs";
import { resolveTarget } from "./gazetteer.mjs";

const { TelegramClient } = telegram;
const { StringSession } = sessions;
const { NewMessage } = events;
const { EditedMessage } = editedMod;
const { ConnectionTCPObfuscated } = connections;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
}
const configPath = path.join(__dirname, "config.json");

if (!fs.existsSync(configPath)) {
  console.error("Немає config.json. Скопіюй config.sample.json → config.json.");
  process.exit(1);
}

const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
const apiId = Number(cfg.apiId);
const apiHash = String(cfg.apiHash || "").trim();
const phone = String(cfg.phone || "").trim();
if (!apiId || !apiHash || !phone) {
  console.error("В config.json потрібні apiId, apiHash і phone.");
  process.exit(1);
}

validateAiConfig();

const chats = Array.isArray(cfg.chats) ? cfg.chats : [];
if (!chats.length) {
  console.error("Порожній chats у config.json.");
  process.exit(1);
}

const sessionFile = path.join(__dirname, String(cfg.sessionFile || "session.string"));
const logFile = path.join(__dirname, String(cfg.logFile || "shahed-messages.log"));
const aiLogFile = path.join(__dirname, String(cfg.aiLogFile || "deepseek-results.log"));
// У production усі канали проходять через один realtime ingest без вибіркового testMode.
const activeChats = chats;

const TRACK_TTL_MS = Number(cfg.trackTtlMinutes || 240) * 60_000;
const ingestUrl = String(process.env.FLIGHTWATCH_INGEST_URL || '').trim();
const ingestSecret = String(process.env.INGEST_SECRET || '').trim();
const ingestTimeoutMs = Math.min(10_000, Math.max(5_000, Number(process.env.INGEST_TIMEOUT_MS || 8_000)));
const dryRun = process.env.DRY_RUN === '1';
const logsDir = path.join(__dirname, 'logs');
const unresolvedLogFile = path.join(logsDir, 'unresolved-locations.jsonl');
const resolvedLogFile = path.join(logsDir, 'resolved-locations.jsonl');
const dryRunLogFile = path.join(logsDir, 'dry-run.jsonl');
const unresolvedCounts = new Map();
fs.mkdirSync(logsDir, { recursive: true });

function logJsonLine(file, value) {
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}
function unresolvedKey(target) {
  return `${String(target.location_name || '').trim().toLocaleLowerCase('uk-UA')}|${String(target.region || '').trim().toLocaleLowerCase('uk-UA')}`;
}
function recordUnresolved(target, resolved, payload) {
  const key = unresolvedKey(target);
  const lines = fs.existsSync(unresolvedLogFile) ? fs.readFileSync(unresolvedLogFile, 'utf8').split(/\r?\n/).filter(Boolean) : [];
  const index = lines.findIndex((line) => { try { return JSON.parse(line).key === key; } catch { return false; } });
  let previousCount = unresolvedCounts.get(key) || 0;
  if (!previousCount && index >= 0) { try { previousCount = Number(JSON.parse(lines[index]).count) || 0; } catch {} }
  const count = previousCount + 1;
  unresolvedCounts.set(key, count);
  const record = { key, name: target.location_name || null, region: target.region || null, reason: resolved.reason, candidates: (resolved.variants || []).map((item) => item.name), count, channel: payload.chatRef, messageId: payload.id, updatedAt: new Date().toISOString() };
  if (index >= 0) lines[index] = JSON.stringify(record); else lines.push(JSON.stringify(record));
  fs.writeFileSync(unresolvedLogFile, `${lines.join('\n')}\n`, 'utf8');
}
function recordResolved(target, resolved, payload) {
  if (resolved.method !== 'stem' && resolved.method !== 'fuzzy') return;
  logJsonLine(resolvedLogFile, { searched: target.location_name, region: target.region || null, matched: resolved.matchedName, method: resolved.method, score: resolved.score ?? null, coordinates: resolved.coordinates, channel: payload.chatRef, messageId: payload.id, at: new Date().toISOString() });
}
function writeDryRun(payload, target, resolved) {
  logJsonLine(dryRunLogFile, { channel: payload.chatRef, messageId: payload.id, text: String(payload.text || '').slice(0, 200), location_name: target.location_name || null, target_point: target.target_point || null, region: target.region || null, method: resolved.ok ? resolved.method : (resolved.reason === 'not-found' ? 'not found' : resolved.reason), coordinates: resolved.ok ? resolved.coordinates : null, at: new Date().toISOString() });
}

async function postToWorker(payload) {
  if (!ingestUrl || !ingestSecret) {
    console.error('Ingest is not configured: FLIGHTWATCH_INGEST_URL/INGEST_SECRET');
    return false;
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ingestTimeoutMs);
    try {
      const response = await fetch(ingestUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ingestSecret}` },
        body: JSON.stringify(payload),
      });
      if (response.ok) return true;
      if (response.status < 500 && response.status !== 429) {
        console.error(`Worker ingest rejected ${response.status}: ${payload.chatRef}/${payload.id}`);
        return false;
      }
    } catch (error) {
      console.error(`Worker ingest attempt ${attempt + 1}/3:`, error.message);
    } finally {
      clearTimeout(timer);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }
  console.error('Worker ingest failed after 3 attempts; payload retained in local AI log', JSON.stringify(payload));
  return false;
}
const mediaDir = path.join(__dirname, String(cfg.mediaDir || "media"));
fs.mkdirSync(mediaDir, { recursive: true });

const sessionString = fs.existsSync(sessionFile) ? fs.readFileSync(sessionFile, "utf8").trim() : "";
const session = new StringSession(sessionString);

const client = new TelegramClient(session, apiId, apiHash, {
  connection: ConnectionTCPObfuscated,
  connectionRetries: 5,
});

await client.start({
  phoneNumber: async () => phone,
  password: async () => await input.text("Пароль 2FA (якщо є, інакше Enter): "),
  phoneCode: async () => await input.text("Код з Telegram: "),
  onError: (err) => console.error(err),
});

const saved = client.session.save();
if (saved !== sessionString) fs.writeFileSync(sessionFile, saved, "utf8");

// ── резолв каналів ────────────────────────────────────────────────
const registry = new Map();
const entities = [];

for (const chat of activeChats) {
  const ref = String(chat.id ?? chat.username ?? "").trim();
  if (!ref) continue;
  try {
    const target = /^-?\d+$/.test(ref) ? Number(ref) : ref;
    const entity = await client.getEntity(target);
    const raw = entity.id.toString();
    const meta = {
      ...chat,
      ref,
      label: chat.name || entity.title || entity.username || ref,
      entityId: raw,
    };
    for (const key of [raw, `-${raw}`, `-100${raw}`]) registry.set(key, meta);
    entities.push(entity);
    const flags = [
      chat.takeEdits === false ? "без правок" : "+правки",
      chat.takeReplies === false ? "без відповідей" : "+відповіді",
      chat.takeStatusOnly ? "+відбої/чисто" : null,
      chat.debug ? "debug" : null,
    ].filter(Boolean);
    console.log(
      `OK ${meta.label} → ${chat.mode || "filter"} [${(chat.categories || ["всі"]).join(", ")}] (${flags.join(", ")})`
    );
  } catch (e) {
    console.error(`FAIL ${ref}: ${e.message}`);
  }
}

if (!entities.length) {
  console.error("Жоден канал не зарезолвився.");
  await client.disconnect();
  process.exit(1);
}

// ── трекінг залогованих алертів (для reply/edit) ──────────────────
const tracked = new Map(); // "chatId:msgId" -> { ts, text, categories }
const key = (chatId, msgId) => `${chatId}:${msgId}`;

function prune() {
  const cutoff = Date.now() - TRACK_TTL_MS;
  for (const [k, v] of tracked) if (v.ts < cutoff) tracked.delete(k);
}
setInterval(prune, 10 * 60_000).unref?.();

function emit(payload) {
  const line = JSON.stringify(payload);
  console.log(line);
  fs.appendFileSync(logFile, line + "\n", "utf8");
}

const aiQueue = [];
const aiConcurrency = Math.max(1, Number(process.env.DEEPSEEK_MAX_CONCURRENCY || 10));
let aiActive = 0;

function queueAi(payload) {
  if (!isAiEnabled()) return;
  aiQueue.push(payload);
  pumpAiQueue();
}

function pumpAiQueue() {
  while (aiActive < aiConcurrency && aiQueue.length) {
    const payload = aiQueue.shift();
    aiActive += 1;
    analyzeMessage(payload)
      .then((analysis) => {
        if (!analysis) return;
        const aiLine = JSON.stringify({ ...payload, ai: analysis, aiProcessedAt: new Date().toISOString() });
        fs.appendFileSync(aiLogFile, aiLine + "\\n", "utf8");
        const resolvedTargets = [];
        for (const target of analysis.targets || []) {
          const cleaned = { ...target };
          delete cleaned.coordinates;
          if (target.is_cancelled || /відбій|чисто|збит|знищ/i.test(String(target.status || ''))) {
            if (dryRun) writeDryRun(payload, target, { ok: false, reason: 'cancelled', coordinates: null });
            resolvedTargets.push(cleaned);
            continue;
          }
          const resolved = resolveTarget(target);
          if (!resolved.ok) {
            recordUnresolved(target, resolved, payload);
            if (dryRun) writeDryRun(payload, target, resolved);
            console.warn(`[gazetteer] ${resolved.reason}: ${target.location_name || '[без назви]'}`, resolved.variants?.map((item) => item.name));
            continue;
          }
          recordResolved(target, resolved, payload);
          if (dryRun) writeDryRun(payload, target, resolved);
          resolvedTargets.push({ ...cleaned, coordinates: resolved.coordinates, matched_location_name: resolved.matchedName });
        }
        if (dryRun) {
          console.log(`[dry-run] ${payload.chatRef}/${payload.id}: ${resolvedTargets.length} resolved targets; Worker POST skipped`);
        } else {
          void postToWorker({ ...payload, ai: { ...analysis, targets: resolvedTargets } });
        }
      })
      .catch((error) => console.error(`DeepSeek ${payload.chatRef}/${payload.id}:`, error.message))
      .finally(() => {
        aiActive -= 1;
        pumpAiQueue();
      });
  }
}

function replyId(message) {
  return message.replyTo?.replyToMsgId ?? message.replyToMsgId ?? null;
}

function safeSegment(value) {
  return String(value ?? "unknown").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120) || "unknown";
}

async function saveMedia(message, meta) {
  if (!message.media) return [];
  const messageDir = path.join(mediaDir, safeSegment(meta.ref), safeSegment(message.id));
  fs.mkdirSync(messageDir, { recursive: true });
  const saved = [];
  const mediaItems = message.media?.className === "MessageMediaPhoto"
    ? [message.media]
    : message.media?.className === "MessageMediaDocument" && message.media.document?.mimeType?.startsWith("image/")
      ? [message.media]
      : [];
  for (let index = 0; index < mediaItems.length; index += 1) {
    try {
      const filePath = path.join(messageDir, `photo-${index + 1}`);
      const downloaded = await message.downloadMedia({ outputFile: filePath });
      if (downloaded) {
        const resolved = typeof downloaded === "string" ? downloaded : filePath;
        saved.push({ type: "photo", path: path.relative(__dirname, resolved).replaceAll(path.sep, "/"), original: true });
      }
    } catch (error) {
      console.error(`media ${meta.ref}/${message.id}/${index + 1}:`, error.message);
    }
  }
  return saved;
}

function buildPayload(message, meta, result, extra = {}) {
  return {
    ts: new Date().toISOString(),
    date: message.date,
    id: message.id,
    channelId: meta.entityId,
    chat: meta.label,
    chatRef: meta.ref,
    region: meta.region || null,
    matched: result.matched !== false,
    kind: result.kind,                 // alert | followup | edit | status | all | skip
    reason: result.reason || null,     // category | reply-to-tracked | status-only | edits-disabled | no-match
    categories: result.categories,
    hits: result.hits,
    status: result.status || null,
    isStatusUpdate: Boolean(result.status),
    replyTo: replyId(message) || null,
    parentId: extra.parentId || null,
    parentText: extra.parentText || null,
    parentCategories: extra.parentCategories || null,
    isEdit: result.kind === "edit",
    editedMessageId: result.kind === "edit" ? message.id : null,
    originalMessageId: result.kind === "edit" ? message.id : null,
    editOf: result.kind === "edit" ? `${meta.entityId}:${message.id}` : null,
    hasMedia: Boolean(message.media),
    media: extra.media || [],
    link: /^[a-zA-Z]/.test(meta.ref) ? `https://t.me/${meta.ref}/${message.id}` : null,
    text: message.text || "",
  };
}

async function handle(evt, { isEdit }) {
  try {
    const chatId = evt.chatId;
    if (chatId == null) return;
    const meta = registry.get(chatId.toString());
    if (!meta) return;

    const message = evt.message;
    if (!message) return;

    const selfKey = key(meta.entityId, message.id);
    const rid = replyId(message);
    const parentKey = rid ? key(meta.entityId, rid) : null;
    const parent = parentKey ? tracked.get(parentKey) : null;

    const result = matchMessage(message.text, meta, {
      isReplyToTracked: Boolean(parent),
      isEdit,
      wasTracked: tracked.has(selfKey),
    });
    const media = message.media
      ? [{ type: "photo", path: `media/${safeSegment(meta.ref)}/${safeSegment(message.id)}/photo-1`, original: true, status: "queued" }]
      : [];

    if (!result.matched) return;

    emit(
      buildPayload(message, meta, result, {
        parentId: parent ? rid : null,
        parentText: parent ? parent.text : null,
        parentCategories: parent ? parent.categories : null,
        media,
      })
    );

    if (message.media) {
      saveMedia(message, meta).then((saved) => {
        if (!saved.length) console.error(`media ${meta.ref}/${message.id}: завантаження не повернуло файл`);
        else {
          console.log(`media saved ${meta.ref}/${message.id}: ${saved.map((item) => item.path).join(", ")}`);
          queueAi({ ...buildPayload(message, meta, result, { parentId: parent ? rid : null, media: saved }) });
        }
      }).catch((error) => console.error(`media ${meta.ref}/${message.id}:`, error.message));
    } else {
      queueAi(buildPayload(message, meta, result, {
        parentId: parent ? rid : null,
        parentText: parent ? parent.text : null,
        parentCategories: parent ? parent.categories : null,
        media: [],
      }));
    }

    // трекаємо і сам алерт, і його апдейти — щоб ланцюжок не рвався
    tracked.set(selfKey, {
      ts: Date.now(),
      text: message.text || "",
      categories: result.categories?.length ? result.categories : parent?.categories || [],
    });
    if (parent) parent.ts = Date.now();
  } catch (e) {
    console.error(e);
  }
}

// фільтр по каналах робиться в handle() через registry,
// у білдер entity не передаємо — gramJS на них падає
client.addEventHandler((evt) => handle(evt, { isEdit: false }), new NewMessage({}));
client.addEventHandler((evt) => handle(evt, { isEdit: true }), new EditedMessage({}));

// ── keepalive: не даємо процесу тихо здохнути після обриву ─────────
setInterval(async () => {
  try {
    if (!client.connected) {
      console.log("reconnect...");
      await client.connect();
    } else {
      await client.getMe();
    }
  } catch (e) {
    console.error("keepalive:", e.message);
  }
}, 30_000);

console.log(`Слухаю ${entities.length} каналів (new + edited). Лог: ${logFile}`);

process.once("SIGINT", async () => {
  try { await client.disconnect(); } finally { process.exit(0); }
});