#!/usr/bin/env node
// i18n helpers for Archify candidates.
//   node i18n.mjs inject <candidate.json> <lang>      set meta.locale (+ meta.translations from locales/<lang>.json when Archify has no bundled catalog)
//   node i18n.mjs check-pair <base.json> <translated.json>   same structure; only human text may differ
import { readFileSync, writeFileSync } from 'node:fs';
import { applyLocale } from './lib/locale.mjs';

// Keys whose string values are reader-facing text and may change in translation.
const TEXT_KEYS = new Set([
  'label', 'sublabel', 'title', 'subtitle', 'detail', 'note', 'text', 'caption', 'summary',
  'answer', 'assessment', 'verdict', 'change', 'decision', 'reasons', 'checklist', 'lines',
  'legend', 'question', 'body', 'heading', 'description', 'tag', 'items', 'comment',
]);
const IGNORED_META = new Set(['locale', 'translations', 'output']);

const [cmd, a, b] = process.argv.slice(2);
const load = (p) => JSON.parse(readFileSync(p, 'utf8'));

if (cmd === 'inject') {
  const doc = applyLocale(load(a), b);
  writeFileSync(a, JSON.stringify(doc, null, 2) + '\n');
  console.log(`ok: ${a} locale=${b}${doc.meta.translations ? ' (+translations)' : ''}`);
} else if (cmd === 'check-pair') {
  const errors = [];
  compare(load(a), load(b), '$', null, errors);
  if (errors.length) fail(`${errors.length} structural difference(s):\n` + errors.slice(0, 40).join('\n'));
  console.log('ok: same structure, only text differs');
} else {
  fail('usage: i18n.mjs inject <candidate.json> <lang> | check-pair <base.json> <translated.json>');
}

function compare(x, y, path, key, errors) {
  if (path === '$.meta' || path.startsWith('$.meta.')) {
    if (IGNORED_META.has(key)) return;
  }
  if (Array.isArray(x)) {
    if (!Array.isArray(y) || x.length !== y.length) return void errors.push(`${path}: array length/type differs`);
    x.forEach((v, i) => compare(v, y[i], `${path}[${i}]`, key, errors));
  } else if (x && typeof x === 'object') {
    if (!y || typeof y !== 'object' || Array.isArray(y)) return void errors.push(`${path}: object expected`);
    const kx = Object.keys(x).filter((k) => !(path === '$.meta' && IGNORED_META.has(k)));
    const ky = Object.keys(y).filter((k) => !(path === '$.meta' && IGNORED_META.has(k)));
    if (kx.sort().join() !== ky.sort().join()) return void errors.push(`${path}: keys differ (${kx} vs ${ky})`);
    for (const k of kx) compare(x[k], y[k], `${path}.${k}`, k, errors);
  } else if (typeof x === 'string' && typeof y === 'string' && TEXT_KEYS.has(key)) {
    if (!y.trim()) errors.push(`${path}: empty translation`);
  } else if (x !== y) {
    errors.push(`${path}: value must not change (${JSON.stringify(x)} -> ${JSON.stringify(y)})`);
  }
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
