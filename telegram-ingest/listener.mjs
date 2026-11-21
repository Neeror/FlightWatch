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

const { TelegramClient } = telegram;
const { StringSession } = sessions;
const { NewMessage } = events;
const { EditedMessage } = editedMod;
const { ConnectionTCPObfuscated } = connections;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
        console.log(`DeepSeek OK ${payload.chatRef}/${payload.id}: ${analysis.targets?.length ?? 0} цілей`);
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