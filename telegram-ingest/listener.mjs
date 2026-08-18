import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage, EditedMessage } from "telegram/events/index.js";
import { ConnectionTCPObfuscated } from "telegram/network/connection/index.js";
import input from "input";
import { matchMessage } from "./matcher.mjs";

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

const chats = Array.isArray(cfg.chats) ? cfg.chats : [];
if (!chats.length) {
  console.error("Порожній chats у config.json.");
  process.exit(1);
}

const sessionFile = path.join(__dirname, String(cfg.sessionFile || "session.string"));
const logFile = path.join(__dirname, String(cfg.logFile || "shahed-messages.log"));
const testMode = Boolean(cfg.testMode);
const testLimit = Number(cfg.testLimit || 30);
const TRACK_TTL_MS = Number(cfg.trackTtlMinutes || 240) * 60_000;

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

for (const chat of chats) {
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

function replyId(message) {
  return message.replyTo?.replyToMsgId ?? message.replyToMsgId ?? null;
}

function buildPayload(message, meta, result, extra = {}) {
  return {
    ts: new Date().toISOString(),
    date: message.date,
    id: message.id,
    chat: meta.label,
    chatRef: meta.ref,
    region: meta.region || null,
    matched: result.matched !== false,
    kind: result.kind,                 // alert | followup | edit | status | all | skip
    reason: result.reason || null,     // category | reply-to-tracked | status-only | edits-disabled | no-match
    categories: result.categories,     // ["cruise"] / ["banderol"] / ["shahed"] ...
    hits: result.hits,                 // що саме зматчилось
    status: result.status || null,     // "оновлено", "❌", "чисто", "Відбій" ...
    isStatusUpdate: Boolean(result.status),
    replyTo: replyId(message) || null,
    parentId: extra.parentId || null,
    parentText: extra.parentText || null,
    parentCategories: extra.parentCategories || null,
    isEdit: result.kind === "edit",
    hasMedia: Boolean(message.media),
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

    if (!result.matched) {
      // debug-канал (тестовий): логуємо й відкинуте, щоб видно було причину
      if (meta.debug) emit(buildPayload(message, meta, result, { parentId: rid || null }));
      return;
    }

    emit(
      buildPayload(message, meta, result, {
        parentId: parent ? rid : null,
        parentText: parent ? parent.text : null,
        parentCategories: parent ? parent.categories : null,
      })
    );

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

// ── тестовий прогін по історії ────────────────────────────────────
if (testMode) {
  console.log(`--- TEST MODE: останні ${testLimit} з кожного каналу ---`);
  for (const entity of entities) {
    const meta = registry.get(entity.id.toString());
    const history = await client.getMessages(entity, { limit: testLimit });
    const localTracked = new Set();
    let hits = 0;
    for (const message of [...history].reverse()) {
      const rid = replyId(message);
      const result = matchMessage(message.text, meta, {
        isReplyToTracked: rid ? localTracked.has(rid) : false,
      });
      if (!result.matched) {
        if (meta.debug) emit(buildPayload(message, meta, result, { parentId: rid || null }));
        continue;
      }
      hits++;
      localTracked.add(message.id);
      emit(buildPayload(message, meta, result, { parentId: rid || null }));
    }
    console.log(`# ${meta.label}: ${hits}/${history.length}`);
  }
  await client.disconnect();
  process.exit(0);
}

client.addEventHandler((evt) => handle(evt, { isEdit: false }), new NewMessage({ chats: entities }));
client.addEventHandler((evt) => handle(evt, { isEdit: true }), new EditedMessage({ chats: entities }));

console.log(`Слухаю ${entities.length} каналів (new + edited). Лог: ${logFile}`);

process.once("SIGINT", async () => {
  try { await client.disconnect(); } finally { process.exit(0); }
});