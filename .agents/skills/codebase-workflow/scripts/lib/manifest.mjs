// Load and validate project manifests. Mirrors schemas/manifest.schema.json (kept dependency-free).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]*$/;
const LANG = /^[a-z]{2}(-[A-Za-z]{2,4})?$/;
const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall', 'explainer', 'legacy']);
const AUDIENCES = new Set(['end-user', 'dev', 'both']);
const SOURCE_KINDS = new Set(['codebase', 'idea', 'plan', 'docs', 'mixed']);

export function findProjects(root) {
  return readdirSync(root)
    .filter((name) => !name.startsWith('.') && statSync(join(root, name)).isDirectory())
    .filter((name) => existsSync(join(root, name, 'manifest.json')))
    .sort();
}

export function loadManifest(root, dir) {
  const path = join(root, dir, 'manifest.json');
  let data;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { dir, path, data: null, errors: [`${path}: invalid JSON (${e.message})`] };
  }
  return { dir, path, data, errors: validate(data).map((m) => `${path}: ${m}`) };
}

function validate(m) {
  const errors = [];
  const text = (v, where) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.keys(v).length) return errors.push(`${where} must be { lang: text }`);
    for (const [k, s] of Object.entries(v)) {
      if (!LANG.test(k)) errors.push(`${where}: bad language "${k}"`);
      if (typeof s !== 'string' || !s.trim()) errors.push(`${where}.${k} is empty`);
    }
  };
  const allowed = new Set(['version', 'project', 'title', 'summary', 'languages', 'source', 'generatedAt', 'generator', 'groups', 'pages']);
  for (const k of Object.keys(m || {})) if (!allowed.has(k)) errors.push(`unknown field "${k}"`);
  if (m?.version !== 1) errors.push('version must be 1');
  if (!ID.test(m?.project ?? '')) errors.push('project must be a lowercase slug');
  text(m?.title, 'title');
  if (m?.summary !== undefined) text(m.summary, 'summary');
  if (!Array.isArray(m?.languages) || !m.languages.length || !m.languages.every((l) => LANG.test(l))) errors.push('languages must list language tags');
  if (m?.source) {
    if (!SOURCE_KINDS.has(m.source.kind)) errors.push('source.kind invalid');
    if (m.source.repo && /^(\/|[A-Za-z]:\\|file:)/.test(m.source.repo)) errors.push('source.repo must not be a local absolute path (published)');
  }
  const groups = new Set();
  if (!Array.isArray(m?.groups) || !m.groups.length) errors.push('groups must be a non-empty array');
  for (const [i, g] of (m?.groups ?? []).entries()) {
    if (!ID.test(g.id ?? '')) errors.push(`groups[${i}].id invalid`);
    if (groups.has(g.id)) errors.push(`duplicate group "${g.id}"`);
    groups.add(g.id);
    text(g.title, `groups[${i}].title`);
  }
  const ids = new Set();
  if (!Array.isArray(m?.pages) || !m.pages.length) errors.push('pages must be a non-empty array');
  for (const [i, p] of (m?.pages ?? []).entries()) {
    const at = `pages[${i}]${p?.id ? ` (${p.id})` : ''}`;
    if (!ID.test(p.id ?? '')) errors.push(`${at}.id invalid`);
    if (ids.has(p.id)) errors.push(`duplicate page "${p.id}"`);
    ids.add(p.id);
    if (!groups.has(p.group)) errors.push(`${at}.group "${p.group}" is not a declared group`);
    text(p.title, `${at}.title`);
    text(p.summary, `${at}.summary`);
    if (!TYPES.has(p.type)) errors.push(`${at}.type "${p.type}" invalid`);
    if (!AUDIENCES.has(p.audience)) errors.push(`${at}.audience "${p.audience}" invalid`);
    const files = Object.entries(p.files ?? {});
    if (!files.length) errors.push(`${at}.files is empty`);
    for (const [lang, f] of files) {
      if (!LANG.test(lang)) errors.push(`${at}.files: bad language "${lang}"`);
      if (typeof f !== 'string' || !f.endsWith('.html') || f.startsWith('/') || f.includes('..') || f.includes('\\') || f.startsWith('file:')) {
        errors.push(`${at}.files.${lang} must be a relative .html path inside the project`);
      }
    }
    if (p.covers !== undefined && !Array.isArray(p.covers)) errors.push(`${at}.covers must be an array`);
  }
  return errors;
}

// Expand page covers (item or feature ids) against an inventory and report what is left uncovered.
export function coverage(inventory, pages, exclusions = []) {
  const items = inventory?.items ?? [];
  const features = new Map((inventory?.features ?? []).map((f) => [f.id, f.items ?? []]));
  const covered = new Set();
  for (const p of pages) {
    for (const id of p.covers ?? []) {
      covered.add(id);
      for (const child of features.get(id) ?? []) covered.add(child);
    }
  }
  const excluded = new Set(exclusions.map((e) => e.id));
  const missing = items.filter((it) => !covered.has(it.id) && !excluded.has(it.id)).map((it) => it.id);
  const done = items.length - missing.length;
  return { total: items.length, done, missing, percent: items.length ? Math.round((done / items.length) * 1000) / 10 : 100 };
}

export function readJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}
