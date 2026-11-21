import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, "..", ".env");

function loadEnv() {
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

loadEnv();

const enabled = process.env.DEEPSEEK_ENABLED === "true";
const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
const model = process.env.DEEPSEEK_MODEL || "deepseek-flash";
const timeoutMs = Number(process.env.DEEPSEEK_TIMEOUT_MS || 45_000);

export function isAiEnabled() {
  return enabled;
}

export function validateAiConfig() {
  if (enabled && !apiKey) throw new Error("DEEPSEEK_ENABLED=true, але в telegram-ingest/.env немає DEEPSEEK_API_KEY");
}

function mimeType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".png": return "image/png";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    default: return null;
  }
}

export async function analyzeMessage(payload) {
  if (!enabled || !apiKey) return null;

  const content = [{
    type: "text",
    text: [
      "Проаналізуй повідомлення українською для оперативної карти. Це може бути звичайне зведення/розмовний пост без повітряної цілі — тоді поверни targets як [].",
      "Витягай лише прямо підтверджені повідомленням факти. Не вигадуй тип цілі, місто, курс, координати, відстань чи час. Розрізняй стан/оцінку/прогноз і фактичний рух цілі.",
      "Маршрут передавай упорядкованим списком назв населених пунктів; не перетворюй слова про загрозу або прогноз на ціль. Для стратегічної авіації/флоту без конкретної поточної цілі поверни targets [].",
      "Поверни лише JSON такого вигляду: {\"summary\":\"коротко\",\"targets\":[{\"type\":\"тип або unknown\",\"count\":null,\"location_name\":\"назва міста/населеного пункту/місцевості, де ціль зараз, або null\",\"region\":\"область або район, якщо прямо сказано, або null\",\"route\":[\"місто 1\",\"місто 2\"],\"target_point\":\"пункт, на який прямо вказує курс, або null\",\"direction\":\"напрямок текстом або null\",\"is_cancelled\":false,\"status\":\"рухається/знищено/відбій/невідомо\",\"confidence\":0.0,\"evidence\":\"уривок джерела\"}],\"assessment\":true/false,\"uncertainties\":[\"...\"]}. location_name і target_point повертай у називному відмінку, однині, без прийменників: «Бориспіль», а не «біля Борисполя»; «Бровари», а не «на Бровари». Не повертай координати: поле coordinates заборонене й буде проігнороване. Не перетворюй назву на координати." ,
      `Джерело: ${payload.chatRef}; час публікації Unix: ${payload.date ?? "невідомо"}; ID повідомлення: ${payload.id}.`,
      `Повний текст повідомлення:\n${payload.text || "[тексту немає]"}`,
    ].join("\n\n"),
  }];

  for (const item of payload.media || []) {
    if (!item.path || item.status === "queued") continue;
    const absolutePath = path.resolve(__dirname, item.path);
    if (!fs.existsSync(absolutePath)) continue;
    const mime = mimeType(absolutePath);
    if (!mime) continue;
    const base64 = fs.readFileSync(absolutePath).toString("base64");
    content.push({ type: "image_url", image_url: { url: `data:${mime};base64,${base64}`, detail: "original" } });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        stream: false,
        response_format: { type: "json_object" },
        max_tokens: 8192,
        messages: [
          { role: "system", content: "Ти — обережний парсер повідомлень для карти. Не виводь приховані міркування. Поверни тільки запитаний JSON; якщо факт неоднозначний, вкажи це в uncertainties." },
          { role: "user", content },
        ],
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}: ${body.error?.message || JSON.stringify(body)}`);
    const text = body.choices?.[0]?.message?.content;
    if (!text) throw new Error("DeepSeek повернув порожню відповідь");
    try { return JSON.parse(text); } catch (error) {
      console.error("DeepSeek JSON parse failed", JSON.stringify({ payload, raw: text, error: error.message }));
      return null;
    }
  } finally {
    clearTimeout(timer);
  }
}
