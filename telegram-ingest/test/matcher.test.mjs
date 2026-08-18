import test from "node:test";
import assert from "node:assert/strict";
import { matchMessage, detectCategories, detectStatus } from "../matcher.mjs";

const kherson = { mode: "filter", region: "kherson", categories: ["fpv", "molniya", "kab", "recon"] };

test("FPV у різних написаннях", () => {
  for (const t of ["Робота FPV по Корабельному", "фпв над містом", "ФПВ-дрон"]) {
    assert.equal(matchMessage(t, kherson).categories[0], "fpv");
  }
});

test("молнія / молния / молнії", () => {
  for (const t of ["Молнія курсом на Херсон", "молния над Дніпром", "Пуск молній"]) {
    assert.equal(matchMessage(t, kherson).categories.includes("molniya"), true);
  }
});

test("КАБи у різних формах", () => {
  for (const t of ["Загроза КАБів", "КАБ-250 на Харків", "скид керованих авіабомб", "УМПК"]) {
    assert.equal(matchMessage(t, kherson).categories.includes("kab"), true);
  }
});

test("розвідники", () => {
  for (const t of ["розвідник над Сумами", "дорозвідка цілі", "Орлан у напрямку міста"]) {
    assert.equal(matchMessage(t, kherson).categories.includes("recon"), true);
  }
});

test("інше в регіональних каналах не беремо", () => {
  assert.equal(matchMessage("Доброго вечора, прогноз погоди", kherson).matched, false);
  assert.equal(matchMessage("Балістика на Київ", kherson).matched, false); // не наша категорія
});

test("оновлення статусу", () => {
  assert.ok(detectStatus("Оновлено ❌ ціль вийшла"));
  assert.ok(detectStatus("чисто"));
  assert.ok(detectStatus("мінус молнія"));
});

test("відповідь на залогований алерт беремо навіть без категорії", () => {
  const r = matchMessage("Оновлено ❌", kherson, { isReplyToTracked: true });
  assert.equal(r.matched, true);
  assert.equal(r.kind, "followup");
  assert.equal(r.status, "Оновлено");
});

test("правка залогованого повідомлення", () => {
  const r = matchMessage("ЧИСТО", kherson, { isEdit: true, wasTracked: true });
    assert.equal(r.kind, "edit");
});

test("mode=all пропускає все", () => {
  assert.equal(matchMessage("будь-що", { mode: "all" }).matched, true);
});