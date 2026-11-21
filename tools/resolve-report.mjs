#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const logs = path.join(root, 'telegram-ingest', 'logs');
const readJsonl = (name) => {
  const file = path.join(logs, name);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
};

const dry = readJsonl('dry-run.jsonl');
const unresolved = readJsonl('unresolved-locations.jsonl');
const resolved = readJsonl('resolved-locations.jsonl');
const exact = dry.filter((row) => ['exact', 'without-parentheses', 'base'].includes(row.method)).length;
const stemFuzzy = resolved.length + dry.filter((row) => ['stem', 'fuzzy'].includes(row.method)).length;
const notFound = unresolved.filter((row) => row.reason === 'not-found').reduce((sum, row) => sum + Number(row.count || 1), 0);
const top = unresolved
  .filter((row) => row.reason === 'not-found')
  .sort((a, b) => Number(b.count || 0) - Number(a.count || 0))
  .slice(0, 20);

console.log(`Повідомлень оброблено: ${dry.length}`);
console.log(`Точних збігів: ${exact}`);
console.log(`Stem/fuzzy збігів: ${stemFuzzy}`);
console.log(`Незнайдених назв: ${notFound}`);
console.log('\nТоп-20 ненайдених назв:');
if (!top.length) console.log('  немає даних');
for (const row of top) console.log(`  ${row.count}× ${row.name || '[порожньо]'}${row.region ? ` — ${row.region}` : ''}`);
