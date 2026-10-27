#!/usr/bin/env node
// Inventory -> semantic tree spec (no LLM). Spec format: references/specs/tree.md
//   node gen-tree.mjs <inventory.json> --kind page|api [--group-by app|feature|controller]
//        [--covers <id>... | --plan <plan.json> --page <id>] --lang vi|en --out spec.json [--dict vi-to-en.json] [--title ..] [--subtitle ..]
// page: screens grouped by feature (default) or app, nested by route (tab / child route under its parent screen).
// api : endpoints grouped by controller (feature -> controller -> endpoint with --group-by feature).
// --lang en uses English fields where the inventory has them (feature titles, tags, cards); other text stays Vietnamese
// unless --dict maps it; leftovers are written to <out>.untranslated.json for a translator pass.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const positional = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    const vals = [];
    while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) vals.push(argv[++i]);
    opt[k] = vals;
  } else positional.push(argv[i]);
}
const one = (k, d) => (opt[k]?.[0] ?? d);
const die = (m) => { console.error(`gen-tree: ${m}`); process.exit(1); };

const invPath = positional[0];
const kind = one('kind');
const lang = one('lang', 'vi');
const out = one('out');
if (!invPath || !['page', 'api'].includes(kind) || !out || !['vi', 'en'].includes(lang)) {
  die('usage: gen-tree.mjs <inventory.json> --kind page|api [--group-by app|feature|controller] [--covers ids... | --plan plan.json --page id] --lang vi|en --out spec.json [--dict vi-to-en.json]');
}
const groupBy = one('group-by', kind === 'page' ? 'feature' : 'controller');
if (!['app', 'feature', 'controller'].includes(groupBy)) die('--group-by must be app|feature|controller');
if (kind === 'page' && groupBy === 'controller') die('--group-by controller applies to --kind api only');

const inv = JSON.parse(readFileSync(invPath, 'utf8'));
const byId = new Map(inv.items.map((i) => [i.id, i]));
const featureOf = new Map();
for (const f of inv.features ?? []) for (const id of f.items) if (!featureOf.has(id)) featureOf.set(id, f);

// ---- selection -------------------------------------------------------------------------------
let plan = null;
let page = null;
let covers = opt.covers;
if (opt.plan) {
  plan = JSON.parse(readFileSync(opt.plan[0], 'utf8'));
  page = plan.pages.find((p) => p.id === one('page'));
  if (!page) die(`page "${one('page')}" not in plan`);
  covers ??= page.covers;
}
const expand = (id) => {
  const f = (inv.features ?? []).find((x) => x.id === id);
  return f ? f.items : [id];
};
const wanted = covers ? [...new Set(covers.flatMap(expand))] : inv.items.map((i) => i.id);
const unknown = wanted.filter((id) => !byId.has(id));
if (unknown.length) die(`unknown inventory ids: ${unknown.slice(0, 5).join(', ')}${unknown.length > 5 ? '…' : ''}`);
const items = inv.items.filter((i) => i.kind === kind && wanted.includes(i.id));
if (!items.length) die(`no ${kind} items selected`);

// ---- helpers ---------------------------------------------------------------------------------
const T = {
  vi: {
    rootPage: 'Màn hình ứng dụng', rootApi: 'API', other: 'Khác',
    tag: { redirect: 'Chuyển hướng', stub: 'Chưa hoàn thiện', legacy: 'Cũ', tab: 'Tab', dialog: 'Hộp thoại', step: 'Bước', section: 'Mục', external: 'Ngoài SPA' },
    subPage: 'Đường nối chỉ thể hiện màn nào nằm trong nhóm nào.', subApi: 'Đường nối chỉ thể hiện endpoint thuộc controller nào.',
    cardPage: ['Cách đọc sơ đồ', 'Cột đầu là nhóm chức năng; cột sau là màn hình, rồi tab hoặc hộp thoại bên trong màn đó.',
      'Màn gắn nhãn "Chưa hoàn thiện" mới có khung; "Chuyển hướng" chỉ tự đưa sang màn chính, không phải màn riêng.'],
    cardApi: ['Cách đọc sơ đồ', 'Mỗi nhánh là một controller; lá là endpoint (METHOD đường dẫn) kèm mô tả ngắn.',
      'Nhãn trước mô tả là quyền (permission) yêu cầu, nếu endpoint khai báo một quyền đơn.'],
  },
  en: {
    rootPage: 'Application screens', rootApi: 'API', other: 'Other',
    tag: { redirect: 'Redirect', stub: 'Unfinished', legacy: 'Legacy', tab: 'Tab', dialog: 'Dialog', step: 'Step', section: 'Section', external: 'Outside SPA' },
    subPage: 'Links show only which group a screen belongs to.', subApi: 'Links show only which controller an endpoint belongs to.',
    cardPage: ['How to read', 'The first column holds feature groups; next come screens, then the tabs or dialogs inside each screen.',
      '"Unfinished" screens have a shell only; "Redirect" entries just forward to the main screen and are not screens of their own.'],
    cardApi: ['How to read', 'Each branch is a controller; leaves are endpoints (METHOD path) with a short description.',
      'The label before the description is the required permission, when the endpoint declares a single one.'],
  },
}[lang];

const dict = opt.dict ? JSON.parse(readFileSync(opt.dict[0], 'utf8')) : {};
const untranslated = new Set();
const tr = (s) => {
  if (!s || lang === 'vi') return s;
  if (dict[s]) return dict[s];
  if (/[À-ỹ]/.test(s)) untranslated.add(s);
  return s;
};

function shorten(text, max = 64) {
  if (!text) return '';
  let s = String(text).replace(/\s+/g, ' ').trim();
  const cut = s.search(/(?<=[a-zà-ỹ0-9)])[.;] |\s[—–]\s/i);
  if (cut > 12) s = s.slice(0, cut);
  s = s.replace(/[.;,]+$/, '');
  if (s.length <= max) return s;
  const w = s.slice(0, max);
  const comma = w.lastIndexOf(',');
  if (comma >= max * 0.45) return w.slice(0, comma);
  return w.slice(0, Math.max(w.lastIndexOf(' '), max * 0.6)).replace(/[\s,;:(–-]+$/, '') + '…';
}

const tracked = trackedFiles(inv.repo);
function sources(item) {
  const list = [];
  for (const ev of item.evidence ?? []) {
    const m = /^(.*?):(\d+)(?:-(\d+))?$/.exec(ev);
    const path = m ? m[1] : ev;
    if (tracked && !tracked.has(path)) continue;
    list.push(m ? { path, line: +m[2], ...(m[3] ? { end_line: +m[3] } : {}) } : { path });
    if (list.length === 3) break;
  }
  return list;
}
function trackedFiles(repo) {
  if (!repo || !existsSync(repo)) return null;
  try { return new Set(execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8', maxBuffer: 64 << 20 }).split('\n').filter(Boolean)); } catch { return null; }
}
const node = (id, label, extra = {}) => {
  const n = { id, label };
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '' && !(Array.isArray(v) && !v.length)) n[k] = v;
  return n;
};
const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'x';

// ---- page tree -------------------------------------------------------------------------------
function pageTag(it) {
  const t = `${it.notes ?? ''} ${it.name}`.toLowerCase();
  if (/redirect/.test(t)) return T.tag.redirect;
  if (/stub|chưa hoàn thiện|placeholder|giữ chỗ/.test(t)) return T.tag.stub;
  if (/legacy|lối tắt cũ|\bcũ\b|deprecated/.test(t)) return T.tag.legacy;
  if (/wizard step/.test(t)) return T.tag.step;
  if (/type=(tab|tab của)/.test(t)) return T.tag.tab;
  if (/dialog|drawer|panel|sub-screen/.test(t)) return T.tag.dialog;
  if (/type=section|type=widget/.test(t)) return T.tag.section;
  if (!it.id.startsWith('page:web:')) return T.tag.external;
  return '';
}
const routeOf = (it) => it.id.split(':').slice(2).join(':');

function pageGroups() {
  const groups = new Map();
  for (const it of items) {
    let key, title, sub;
    if (groupBy === 'app') { key = it.app; title = it.app; }
    else {
      const f = featureOf.get(it.id);
      key = f?.id ?? '_other';
      title = f ? (lang === 'en' ? f.title_en ?? f.title_vi : f.title_vi) : T.other;
      sub = f ? (lang === 'vi' ? f.summary_vi : f.summary_en ?? f.summary_vi) : '';
    }
    if (!groups.has(key)) groups.set(key, { key, title, sub, items: [] });
    groups.get(key).items.push(it);
  }
  return [...groups.values()];
}

function buildPageTree() {
  const children = [];
  for (const g of pageGroups()) {
    const nodes = new Map(); // route -> node
    const routes = new Set(g.items.map(routeOf));
    const parentRoute = (r) => {
      if (r.includes('#')) { const p = r.split('#')[0]; if (routes.has(p)) return p; }
      const base = r.split('#')[0];
      for (let p = base.replace(/\/[^/]*$/, ''); p && p !== base; ) {
        if (routes.has(p)) return p;
        const next = p.replace(/\/[^/]*$/, '');
        if (next === p) break;
        p = next;
      }
      return null;
    };
    for (const it of g.items) {
      nodes.set(routeOf(it), { it, n: node(slug(it.id), it.name, {}), kids: [] });
    }
    const top = [];
    for (const [r, e] of nodes) {
      const pr = parentRoute(r);
      (pr ? nodes.get(pr).kids : top).push(e);
    }
    const make = (e, parent) => {
      let label = e.it.name;
      if (parent && label.startsWith(parent.it.name + ' - ')) label = label.slice(parent.it.name.length + 3);
      const n = node(slug(e.it.id), tr(label), {
        ref: e.it.id,
        tag: pageTag(e.it),
        sublabel: tr(shorten(e.it.summary_vi)),
        sources: sources(e.it),
      });
      if (e.kids.length) n.children = e.kids.map((k) => make(k, e));
      return n;
    };
    const kids = top.map((e) => make(e, null));
    children.push(node(`g_${slug(g.key)}`, tr(g.title), { sublabel: tr(shorten(g.sub, 56)), children: kids }));
  }
  return children;
}

// ---- api tree --------------------------------------------------------------------------------
function controllerOf(it) {
  const h = /handler=([^;#\s]+)/.exec(it.notes ?? '');
  if (h) return h[1].replace(/\.controller$/, '');
  const file = (it.evidence?.[0] ?? '').split(':')[0].split('/').pop() ?? '';
  return file.replace(/\.(controller\.)?ts$/, '') || 'misc';
}
function permissionTag(it) {
  const p = /permission=([^;]+)/.exec(it.notes ?? '');
  const v = p?.[1].trim();
  return v && /^[\w:.]+$/.test(v) && v !== '-' ? v : '';
}
function pathOf(name) { return name.replace(/^\S+\s+/, ''); }
function commonPrefix(paths) {
  const parts = paths.map((p) => p.split('/'));
  const first = parts[0];
  let n = first.length;
  for (const p of parts) { let i = 0; while (i < n && i < p.length && p[i] === first[i]) i++; n = i; }
  const pref = first.slice(0, n).join('/');
  return pref === '' && paths.length ? '/' : pref;
}

function buildApiTree() {
  const mk = (list) => {
    const byCtl = new Map();
    for (const it of list) {
      const c = controllerOf(it);
      if (!byCtl.has(c)) byCtl.set(c, []);
      byCtl.get(c).push(it);
    }
    return [...byCtl].map(([c, eps]) => node(`c_${slug(c)}`, c, {
      sublabel: commonPrefix(eps.map((e) => pathOf(e.name))),
      children: eps.map((e) => node(slug(e.id), e.name, {
        ref: e.id, tag: permissionTag(e), sublabel: tr(shorten(e.summary_vi)), sources: sources(e),
      })),
    }));
  };
  if (groupBy === 'controller') return mk(items);
  const groups = new Map();
  for (const it of items) {
    let key, title;
    if (groupBy === 'app') { key = it.app; title = it.app; }
    else {
      const f = featureOf.get(it.id);
      key = f?.id ?? '_other';
      title = f ? (lang === 'en' ? f.title_en ?? f.title_vi : f.title_vi) : T.other;
    }
    if (!groups.has(key)) groups.set(key, { key, title, items: [] });
    groups.get(key).items.push(it);
  }
  return [...groups.values()].map((g) => {
    const ctls = mk(g.items);
    return node(`g_${slug(g.key)}`, tr(g.title), { sublabel: `${g.items.length} endpoint`, children: ctls });
  });
}

// ---- assemble --------------------------------------------------------------------------------
const planTitle = page?.title?.[lang];
const planSummary = page?.summary?.[lang];
const rootLabel = one('title', planTitle ?? (kind === 'page' ? T.rootPage : T.rootApi));
const [cardTitle, ...cardItems] = kind === 'page' ? T.cardPage : T.cardApi;
const spec = {
  type: 'tree',
  title: rootLabel,
  subtitle: one('subtitle', `${planSummary ? planSummary + '. ' : ''}${kind === 'page' ? T.subPage : T.subApi}`),
  root: node('root', rootLabel, {
    sublabel: `${items.length} ${kind === 'page' ? (lang === 'vi' ? 'màn hình' : 'screens') : 'endpoint'}`,
    children: kind === 'page' ? buildPageTree() : buildApiTree(),
  }),
  cards: [{ dot: 'cyan', title: cardTitle, items: cardItems }],
};
writeFileSync(out, JSON.stringify(spec, null, 2) + '\n');

const refs = new Set();
(function walk(n) { if (n.ref) refs.add(n.ref); (n.children ?? []).forEach(walk); })(spec.root);
const missing = items.filter((i) => !refs.has(i.id));
console.log(`ok: ${out} (${kind}, ${lang}, ${refs.size}/${items.length} ${kind} items)`);
if (missing.length) die(`items not placed: ${missing.slice(0, 5).map((i) => i.id).join(', ')}`);
if (untranslated.size) {
  const f = out.replace(/\.json$/, '') + '.untranslated.json';
  writeFileSync(f, JSON.stringify([...untranslated], null, 2) + '\n');
  console.log(`note: ${untranslated.size} Vietnamese string(s) need a translator pass -> ${f}`);
}
