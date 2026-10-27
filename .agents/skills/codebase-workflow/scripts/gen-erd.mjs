#!/usr/bin/env node
// Prisma schema -> semantic ERD spec (no LLM). Spec format: references/specs/erd.md
//   node gen-erd.mjs --prisma <dir-or-file> [--tables <name>... | --plan <plan.json> --page <id> --inventory <inventory.json>]
//                    --lang vi|en --out spec.json [--domain-by file|feature] [--domain-map map.json] [--extra fragment.json] [--title ..] [--subtitle ..]
// Tables are matched by @@map name or model name. Sources are file:line of each model at the repo HEAD; files that are not
// committed get no sources. Domains = prisma file, or with `--domain-by feature` the first inventory feature listing the
// table (needs --inventory; a single schema.prisma otherwise gives one domain). --domain-map overrides per table or file stem.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (!argv[i].startsWith('--')) continue;
  const key = argv[i].slice(2);
  const vals = [];
  while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) vals.push(argv[++i]);
  opt[key] = vals;
}
const one = (k, d) => opt[k]?.[0] ?? d;
const die = (m) => { console.error(`gen-erd: ${m}`); process.exit(1); };
const lang = one('lang', 'vi');
const out = one('out');
if (!opt.prisma || !out || !['vi', 'en'].includes(lang)) {
  die('usage: gen-erd.mjs --prisma <dir-or-file> [--tables names... | --plan plan.json --page id --inventory inventory.json] --lang vi|en --out spec.json [--domain-by file|feature] [--domain-map map.json] [--extra fragment.json]');
}

// ---- read files (HEAD blobs when committed) -------------------------------------------------------------------
const target = resolve(opt.prisma[0]);
const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => f.endsWith('.prisma')).sort().map((f) => join(target, f))
  : [target];
const git = (cwd, ...a) => execFileSync('git', ['-C', cwd, ...a], { encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
let top = null;
try { top = git(dirname(files[0]), 'rev-parse', '--show-toplevel').trim(); } catch { /* not a git repo */ }
const sources = files.map((file) => {
  let text = readFileSync(file, 'utf8');
  let rel = null;
  if (top) {
    const r = relative(top, file);
    try { text = git(top, 'show', `HEAD:${r}`); rel = r; } catch { /* untracked or new file: no sources */ }
  }
  return { file, rel, stem: basename(file, '.prisma'), text };
});

// ---- parse -----------------------------------------------------------------------------------------------------
const models = [];
const enums = new Map();
for (const src of sources) parseFile(src);
const modelByName = new Map(models.map((m) => [m.name, m]));

function parseFile(src) {
  const lines = src.text.split('\n');
  let doc = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (t.startsWith('///')) { doc.push(t.slice(3).trim()); continue; }
    const head = /^(model|enum)\s+(\w+)\s*\{/.exec(t);
    if (!head) { if (t && !t.startsWith('//')) doc = []; continue; }
    const block = { kind: head[1], name: head[2], line: i + 1, src, doc: doc.join(' ') };
    doc = [];
    const body = [];
    let fieldDoc = [];
    for (i++; i < lines.length && lines[i].trim() !== '}'; i++) {
      let l = lines[i].trim();
      if (l.startsWith('///')) { fieldDoc.push(l.slice(3).trim()); continue; }
      l = l.replace(/\s\/\/.*$/, '');
      if (!l || l.startsWith('//')) continue;
      const trailing = /\s\/\/\/\s*(.*)$/.exec(lines[i]);
      while (((l.match(/[[(]/g) ?? []).length > (l.match(/[\])]/g) ?? []).length) && i + 1 < lines.length) l += ' ' + lines[++i].trim().replace(/\s\/\/.*$/, '');
      body.push({ text: l, doc: [...fieldDoc, ...(trailing ? [trailing[1]] : [])].join(' '), line: i + 1 });
      fieldDoc = [];
    }
    block.end = i + 1;
    block.body = body;
    if (block.kind === 'enum') {
      const map = body.map((b) => /^@@map\("([^"]+)"\)/.exec(b.text)).find(Boolean);
      enums.set(block.name, map ? map[1] : block.name);
    } else models.push(finishModel(block));
  }
}

function finishModel(b) {
  const m = { name: b.name, table: b.name, src: b.src, line: b.line, end: b.end, doc: b.doc, fields: [], pk: [], uniques: [] };
  for (const { text, doc, line } of b.body) {
    if (text.startsWith('@@')) {
      const map = /^@@map\("([^"]+)"\)/.exec(text);
      if (map) m.table = map[1];
      const id = /^@@id\(\s*\[([^\]]*)\]/.exec(text);
      if (id) m.pk = list(id[1]);
      const uq = /^@@unique\(\s*\[([^\]]*)\]/.exec(text);
      if (uq) m.uniques.push(list(uq[1]));
      continue;
    }
    const f = /^(\w+)\s+(\w+)(\[\])?(\?)?\s*(.*)$/.exec(text);
    if (!f) continue;
    const attrs = f[5];
    const rel = /@relation\(([^)]*)\)/.exec(attrs);
    const relFields = rel && /fields:\s*\[([^\]]*)\]/.exec(rel[1]);
    const relRefs = rel && /references:\s*\[([^\]]*)\]/.exec(rel[1]);
    m.fields.push({
      name: f[1], type: f[2], isList: !!f[3], optional: !!f[4], attrs, doc, line,
      col: (/@map\("([^"]+)"\)/.exec(attrs) ?? [])[1] ?? f[1],
      id: /@id\b/.test(attrs), unique: /@unique\b/.test(attrs),
      fkFields: relFields ? list(relFields[1]) : null, fkRefs: relRefs ? list(relRefs[1]) : null,
    });
    if (/@id\b/.test(attrs)) m.pk.push(f[1]);
  }
  return m;
}
function list(s) { return s.split(',').map((x) => x.trim()).filter(Boolean); }

// ---- selection -------------------------------------------------------------------------------------------------
const inv = opt.inventory ? JSON.parse(readFileSync(opt.inventory[0], 'utf8')) : null;
let page = null;
let names = opt.tables;
if (opt.plan) {
  if (!inv) die('--plan needs --inventory');
  const plan = JSON.parse(readFileSync(opt.plan[0], 'utf8'));
  page = plan.pages.find((p) => p.id === one('page'));
  if (!page) die(`page "${one('page')}" not in plan`);
  const expand = (id) => (inv.features ?? []).find((f) => f.id === id)?.items ?? [id];
  const ids = new Set(page.covers.flatMap(expand));
  names = inv.items.filter((i) => i.kind === 'table' && ids.has(i.id)).map((i) => i.name);
  const missing = page.covers.flatMap(expand).filter((id) => id.startsWith('table:') && !names.includes(id.split(':').slice(2).join(':')));
  if (missing.length) die(`covered tables missing from inventory: ${missing.slice(0, 5).join(', ')}`);
}
const selected = names ? names.map((n) => {
  const m = models.find((x) => x.table === n || x.name === n);
  if (!m) die(`table "${n}" not found in the Prisma schema`);
  return m;
}) : models;
const inPage = new Set(selected.map((m) => m.name));
const invItem = new Map((inv?.items ?? []).filter((i) => i.kind === 'table').map((i) => [i.name, i]));

// ---- map -------------------------------------------------------------------------------------------------------
const SCALAR = { String: 'text', Int: 'integer', BigInt: 'bigint', Boolean: 'boolean', DateTime: 'timestamp(3)', Decimal: 'decimal(65,30)', Float: 'double precision', Json: 'jsonb', Bytes: 'bytea' };
function sqlType(f) {
  const db = /@db\.(\w+)(?:\(([^)]*)\))?/.exec(f.attrs);
  let t;
  if (db) {
    const n = { doublePrecision: 'double precision', jsonb: 'jsonb' }[db[1].charAt(0).toLowerCase() + db[1].slice(1)] ?? db[1].toLowerCase();
    t = db[2] ? `${n}(${db[2].replace(/\s+/g, '')})` : n;
  } else if (enums.has(f.type)) t = enums.get(f.type);
  else t = SCALAR[f.type] ?? f.type.toLowerCase();
  return f.isList ? `${t}[]` : t;
}

const domainMap = opt['domain-map'] ? JSON.parse(readFileSync(opt['domain-map'][0], 'utf8')) : {};
const domainBy = one('domain-by', 'file');
if (!['file', 'feature'].includes(domainBy)) die('--domain-by must be file or feature');
if (domainBy === 'feature' && !inv) die('--domain-by feature needs --inventory');
// table name -> { vi, en } title of the first feature that lists the table
const featureOf = new Map();
for (const f of domainBy === 'feature' ? inv.features ?? [] : []) {
  for (const id of f.items ?? []) {
    const name = id.startsWith('table:') ? id.split(':').slice(2).join(':') : null;
    if (name && !featureOf.has(name)) featureOf.set(name, { vi: f.title_vi ?? f.title?.vi ?? f.id, en: f.title_en ?? f.title?.en ?? f.title_vi ?? f.id });
  }
}
const pick = (v) => (typeof v === 'string' ? v : v?.[lang] ?? v?.vi);
const humanize = (stem) => { const s = stem.replace(/^\d+_/, '').replace(/[_-]+/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
const domains = [];
const domainOf = (m) => {
  const entry = domainMap[m.table] ?? domainMap[m.src.stem] ?? featureOf.get(m.table);
  const label = pick(entry) ?? humanize(m.src.stem);
  // the id must not depend on --lang, or vi/en specs would differ in structure
  const basis = (typeof entry === 'string' ? entry : entry?.vi) ?? m.src.stem;
  const id = 'd_' + basis.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/gi, 'd').replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase().replace(/^_+|_+$/g, '');
  if (!domains.some((d) => d.id === id)) domains.push({ id, tag: label });
  return id;
};

const entities = [];
const relationships = [];
const pairSeen = new Set();
let skippedSelf = 0, skippedDup = 0;
for (const m of selected) {
  const fkOf = new Map(); // field name -> "table.col"
  for (const f of m.fields) {
    if (!f.fkFields) continue;
    const target = modelByName.get(f.type);
    if (!target) continue;
    f.fkFields.forEach((fn, i) => {
      const tf = target.fields.find((x) => x.name === f.fkRefs?.[i]);
      if (tf) fkOf.set(fn, `${target.table}.${tf.col}`);
    });
    if (target === m) { skippedSelf++; continue; }
    if (!inPage.has(target.name)) continue;
    const key = [m.table, target.table].sort().join('|');
    if (pairSeen.has(key)) { skippedDup++; continue; }
    pairSeen.add(key);
    const cols = f.fkFields.map((fn) => m.fields.find((x) => x.name === fn));
    const optional = cols.some((c) => c?.optional);
    const oneToOne = sameSet(f.fkFields, m.pk) || m.uniques.some((u) => sameSet(u, f.fkFields)) || (f.fkFields.length === 1 && cols[0]?.unique);
    relationships.push({
      from: m.table, to: target.table, cardinality: `${oneToOne ? 'one' : 'many'}-to-one`,
      ...(optional ? { optional: 'to', identifying: false } : {}),
    });
  }
  const attributes = [];
  for (const f of m.fields) {
    if (modelByName.has(f.type)) continue; // relation field, not a column
    const key = [];
    if (m.pk.includes(f.name)) key.push('pk');
    if (fkOf.has(f.name)) key.push('fk');
    if (f.unique) key.push('uk');
    const a = { name: f.col, type: sqlType(f) };
    if (key.length) a.key = key.length === 1 ? key[0] : key;
    if (fkOf.has(f.name)) a.references = fkOf.get(f.name);
    if (f.doc) a.comment = f.doc;
    attributes.push(a);
  }
  const e = { id: m.table, label: m.table, domain: domainOf(m), attributes };
  const item = invItem.get(m.table);
  if (item) e.ref = item.id;
  if (m.src.rel) e.sources = [{ path: m.src.rel, line: m.line, end_line: m.end }];
  entities.push(e);
}
function sameSet(a, b) { return a.length === b.length && a.length > 0 && a.every((x) => b.includes(x)); }

// ---- assemble --------------------------------------------------------------------------------------------------
const T = {
  vi: { title: 'Sơ đồ dữ liệu', note: 'Quan hệ giữa các bảng', cardTitle: 'Cách đọc quan hệ', cardItems: (s, d) => [`Chỉ vẽ một đường quan hệ cho mỗi cặp bảng${d ? ` (${d} khóa ngoại trùng cặp được gộp)` : ''}; mọi cột khóa ngoại vẫn hiện trong bảng.`, ...(s ? [`${s} khóa ngoại tự tham chiếu (cha-con) chỉ hiện là cột, không vẽ đường tự nối.`] : [])] },
  en: { title: 'Data model', note: 'Relationships between tables', cardTitle: 'Reading the relationships', cardItems: (s, d) => [`One relationship line is drawn per pair of tables${d ? ` (${d} repeated foreign key(s) between the same pair are merged)` : ''}; every foreign key column is still shown in its table.`, ...(s ? [`${s} self-referencing (parent-child) foreign key(s) appear as columns only, with no self-loop line.`] : [])] },
}[lang];
const attrCount = entities.reduce((n, e) => n + e.attributes.length, 0);
let spec = {
  type: 'erd',
  title: one('title', page?.title?.[lang] ?? T.title),
  subtitle: one('subtitle', page?.summary?.[lang] ?? T.note),
  ...(entities.length > 8 || attrCount > 50 ? { quality: 'standard' } : {}),
  domains, entities, relationships,
  cards: skippedSelf || skippedDup ? [{ dot: 'cyan', title: T.cardTitle, items: T.cardItems(skippedSelf, skippedDup) }] : [],
};
if (opt.extra) {
  const x = JSON.parse(readFileSync(opt.extra[0], 'utf8'));
  const { cards, ...rest } = x;
  spec = { ...spec, ...rest, cards: [...(cards ?? []), ...spec.cards] };
}
writeFileSync(out, JSON.stringify(spec, null, 2) + '\n');
console.log(`ok: ${out} (erd, ${lang}, ${entities.length} tables, ${relationships.length} relationships, ${domains.length} domains)`);
if (names && existsSync(out)) {
  const want = new Set(names);
  const got = new Set(entities.map((e) => e.id));
  const lost = [...want].filter((n) => !got.has(n) && !entities.some((e) => modelByName.get(n) === undefined));
  if (lost.length) die(`tables not emitted: ${lost.join(', ')}`);
}
