// ERD compiler: semantic spec (domains, entities, relationships) -> Archify erd candidate with a table-first grid.
// Spec format: references/specs/erd.md
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const type = 'erd';

// Same text model Archify's erd validator uses, so entity widths are computed rather than guessed.
const ARCHIFY = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'archify', 'renderers', 'shared'));
let textUnits = (s) => Array.from(String(s ?? '')).length;
let widthFactor = 0.6;
if (existsSync(join(ARCHIFY, 'utils.mjs'))) {
  textUnits = (await import(pathToFileURL(join(ARCHIFY, 'utils.mjs')).href)).textUnits;
  widthFactor = (await import(pathToFileURL(join(ARCHIFY, 'text-fit.mjs')).href)).nodeTextFit.widthFactor;
}

const METRICS = { padX: 12, keyBase: 30, badge: 22, badgeGap: 3, badgeInset: 2, keyGap: 5, rowFont: 11, typeFont: 10.5, headerFontMin: 10, titleInset: 30, defaultW: 240 };
const MAX_COMMENT = 30;
const COMMENT_MAX_ENTITY_W = 290; // a comment is kept only while the table stays this narrow
const MAX_ROWS = 13;
const MAX_COLS = 13;
const ROLES = new Set(['pk', 'fk', 'uk']);
const OUTSIDE = {
  vi: { title: 'Khóa ngoại trỏ ra ngoài trang', note: (c, t) => `${c} → ${t}`, hint: 'Các cột này là khóa ngoại tới bảng nằm ở trang dữ liệu khác nên chỉ hiện dạng cột thường.' },
  en: { title: 'Foreign keys to other pages', note: (c, t) => `${c} → ${t}`, hint: 'These columns are foreign keys to tables on another data page, so they appear as plain columns here.' },
};

export function compile(spec, ctx = {}, variant = 0) {
  const lang = ctx.lang ?? spec.lang ?? 'vi';
  if (!spec?.title) throw new Error('erd spec: "title" is required');
  if (!Array.isArray(spec.entities) || !spec.entities.length) throw new Error('erd spec: "entities" must be a non-empty array');
  const domains = spec.domains ?? [];
  const domainIds = new Set(domains.map((d) => d.id));
  const ids = new Map();
  const used = new Set();
  for (const e of spec.entities) {
    if (!e.id) throw new Error('erd spec: every entity needs an "id"');
    if (ids.has(e.id)) throw new Error(`erd spec: duplicate entity id "${e.id}"`);
    const aid = safeId(e.id, used);
    ids.set(e.id, aid);
    if (e.domain && !domainIds.has(e.domain)) throw new Error(`erd spec: entity "${e.id}" names unknown domain "${e.domain}"`);
    if (!Array.isArray(e.attributes) || !e.attributes.length) throw new Error(`erd spec: entity "${e.id}" needs attributes`);
    for (const s of e.sources ?? []) if (!s.path) throw new Error(`erd spec: entity "${e.id}" has a source without path`);
    if ((e.sources?.length ?? 0) > 3) throw new Error(`erd spec: entity "${e.id}" has more than 3 sources`);
  }
  const attrNames = new Map(spec.entities.map((e) => [e.id, new Set(e.attributes.map((a) => a.name))]));

  // Attributes: keep SQL type + short comment, demote FKs that cannot resolve on this page.
  const outside = [];
  const entities = spec.entities.map((e) => {
    const attributes = e.attributes.map((a) => {
      if (!a.name) throw new Error(`erd spec: entity "${e.id}" has an attribute without name`);
      let roles = a.key === undefined ? [] : [].concat(a.key);
      for (const r of roles) if (!ROLES.has(r)) throw new Error(`erd spec: ${e.id}.${a.name} key role "${r}" must be pk, fk or uk`);
      roles = [...new Set(roles)];
      const out = { name: a.name };
      const type = a.type ? String(a.type) : '';
      const comment = a.comment ?? a.note;
      out.type = type;
      if (comment && comment.length <= MAX_COMMENT && ctx.comments !== false) {
        const withComment = type ? `${type}｜${comment}` : comment;
        if (rowWidth({ name: a.name, type: withComment }, roles) <= COMMENT_MAX_ENTITY_W) out.type = withComment;
      }
      if (!out.type) delete out.type;
      if (roles.includes('fk')) {
        const m = /^([^.]+)\.([^.]+)$/.exec(a.references ?? '');
        if (!m) throw new Error(`erd spec: ${e.id}.${a.name} is fk but "references" is not "table.column"`);
        const [, t, c] = m;
        if (!attrNames.has(t) || !attrNames.get(t).has(c)) {
          roles = roles.filter((r) => r !== 'fk');
          outside.push([`${e.id}.${a.name}`, a.references]);
        } else out.references = `${ids.get(t)}.${c}`;
      }
      if (roles.length) out.key = roles.length === 1 ? roles[0] : roles;
      return out;
    });
    const ent = { id: ids.get(e.id), label: e.label ?? e.id, attributes };
    if (e.sources?.length) ent.sources = e.sources.slice(0, 3);
    return ent;
  });

  // Relationships: skip self edges, one line per entity pair.
  const rels = [];
  const seen = new Set();
  for (const [i, r] of (spec.relationships ?? []).entries()) {
    if (!ids.has(r.from) || !ids.has(r.to)) throw new Error(`erd spec: relationship #${i} names unknown entity (${r.from} -> ${r.to})`);
    if (r.from === r.to) continue;
    const [fc, tc] = parseCardinality(r.cardinality, i);
    const key = [r.from, r.to].sort().join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    const rel = { id: `r${rels.length}_${ids.get(r.from)}_${ids.get(r.to)}`.slice(0, 80), from: ids.get(r.from), to: ids.get(r.to), fromCardinality: fc, toCardinality: tc };
    if (r.label) rel.label = r.label;
    if (r.optional === 'from' || r.optional === 'both') rel.fromOptional = true;
    if (r.optional === 'to' || r.optional === 'both') rel.toOptional = true;
    if (r.identifying === false) { rel.identifying = false; rel.variant = 'dashed'; }
    rels.push(rel);
  }

  place(spec, entities, rels, domains, ids, variant);

  const cards = [...(spec.cards ?? [])];
  if (outside.length) {
    const t = OUTSIDE[lang] ?? OUTSIDE.vi;
    cards.push({ dot: 'amber', title: t.title, items: [t.hint, ...outside.map(([c, r]) => t.note(c, r))] });
  }
  const meta = { title: spec.title, ...(spec.subtitle ? { subtitle: spec.subtitle } : {}) };
  if (spec.views?.length) {
    meta.views = spec.views.map((v) => ({ ...v, focus: v.focus.map((f) => {
      if (!ids.has(f)) throw new Error(`erd spec: view "${v.id}" focuses unknown entity "${f}"`);
      return ids.get(f);
    }) }));
  }
  const out = {
    schema_version: 1,
    diagram_type: 'erd',
    meta,
    layout: { mode: 'grid', gapX: 72 + variant * 24, gapY: 40 + variant * 8 },
    entities,
    relationships: rels,
  };
  if (cards.length) out.cards = cards;
  return out;
}

function parseCardinality(c, i) {
  const m = /^(one|many)-to-(one|many)$/.exec(c ?? '');
  if (!m) throw new Error(`erd spec: relationship #${i} cardinality must be one-to-one|one-to-many|many-to-one|many-to-many (got ${JSON.stringify(c)})`);
  return [m[1], m[2]];
}

function safeId(raw, used) {
  let base = String(raw).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[^a-zA-Z]+/, 't_');
  let id = base;
  for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
  used.add(id);
  return id;
}

// ---- placement --------------------------------------------------------------------------------------------
const GAP_X = 72;
const MAX_CANVAS_W = 1500; // wider canvases are scaled below Archify's readable text floor
const HEADER_H = 30, ROW_H = 20;

function place(spec, entities, rels, domains, ids, variant) {
  const tagOf = new Map(domains.map((d) => [d.id, d.tag]));
  const byOriginal = new Map(spec.entities.map((e) => [ids.get(e.id), e]));
  const groups = new Map();
  for (const e of entities) {
    const dom = byOriginal.get(e.id).domain ?? '_none';
    if (!groups.has(dom)) groups.set(dom, []);
    groups.get(dom).push(e);
  }
  // a domain with no rectangular arrangement inside the grid is split into sub-bands
  const blocks = [];
  for (const [dom, list] of groups) {
    const baseTag = tagOf.get(dom);
    let start = 0;
    splitDomain(list.length).forEach((part, n) => {
      blocks.push({ dom, tag: baseTag ? (n ? `${baseTag} (${n + 1})` : baseTag) : undefined, list: list.slice(start, start + part) });
      start += part;
    });
  }
  const adj = new Map(entities.map((e) => [e.id, new Set()]));
  for (const r of rels) { adj.get(r.from).add(r.to); adj.get(r.to).add(r.from); }
  const blockOf = new Map();
  blocks.forEach((b, i) => b.list.forEach((e) => blockOf.set(e.id, i)));
  const order = orderBlocks(blocks, rels, blockOf);
  const sizeSort = variant % 2 === 1;
  blocks.forEach((b, i) => { b.list = sortBlock(b.list, rels, adj, blockOf, i, sizeSort); });
  const need = new Map(entities.map((e) => [e.id, requiredWidth(e)]));

  // Try several shapes/widths; keep the shortest canvas that fits the width budget and the 13 x 13 grid.
  let best = null;
  const tryOrder = (ord) => {
    for (const rowCap of [13, 9, 7, 6, 5, 4, 3, 2]) {
      const p = pack(blocks, ord, rowCap, need);
      const fits = p.rows <= MAX_ROWS && p.cols <= MAX_COLS;
      const score = (fits ? 0 : 1e9) + Math.max(0, p.width - MAX_CANVAS_W) * 50 + p.height + 0.6 * detour(p.cells, rels);
      if (!best || score < best.score) best = { ...p, score };
    }
  };
  if (blocks.length <= 7) permutations(order, tryOrder); else tryOrder(order);
  if (best.cols > MAX_COLS || best.rows > MAX_ROWS) {
    throw new Error(`erd spec: layout needs ${best.cols} columns x ${best.rows} rows (grid max ${MAX_COLS} x ${MAX_ROWS}); split the page`);
  }
  for (const e of entities) {
    const p = best.cells.get(e.id);
    e.row = p.row; e.col = p.col;
    if (p.tag) e.tag = p.tag;
  }
  sizeColumns(entities);
}

function permutations(arr, visit) {
  const a = [...arr];
  const rec = (k) => {
    if (k === a.length) return visit(a);
    for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; rec(k + 1); [a[k], a[i]] = [a[i], a[k]]; }
  };
  rec(0);
}

// Pixel-ish cost of relationships that are not between neighbouring cells (long runs are what the router fails on).
function detour(cells, rels) {
  let cost = 0;
  for (const r of rels) {
    const a = cells.get(r.from), b = cells.get(r.to);
    const dc = Math.abs(a.col - b.col), dr = Math.abs(a.row - b.row);
    if (dc + dr <= 1) continue;
    cost += (dc * 350 + dr * 250) * (dc && dr ? 1.3 : 1);
  }
  return cost;
}

// Fill shelves of domain rectangles left to right; a block that no longer fits the width budget starts a new shelf.
function pack(blocks, order, rowCap, need) {
  const cells = new Map();
  const byId = new Map(blocks.flatMap((b) => b.list).map((e) => [e.id, e]));
  let shelfRow = 0, shelfRows = 0, x = 0, col = 0;
  for (const bi of order) {
    const b = blocks[bi];
    const dims = rectFor(b.list.length, rowCap);
    const w = Math.max(...b.list.map((e) => need.get(e.id)));
    const bw = dims.c * w + (dims.c - 1) * GAP_X;
    if (col > 0 && x + GAP_X + bw > MAX_CANVAS_W) { shelfRow += shelfRows; shelfRows = 0; x = 0; col = 0; }
    b.list.forEach((e, i) => cells.set(e.id, { row: shelfRow + Math.floor(i / dims.c), col: col + (i % dims.c), tag: b.tag }));
    shelfRows = Math.max(shelfRows, Math.ceil(b.list.length / dims.c));
    x += (col > 0 ? GAP_X : 0) + bw;
    col += dims.c;
  }
  const colW = new Map(), rowH = new Map();
  for (const [id, p] of cells) {
    const e = byId.get(id);
    colW.set(p.col, Math.max(colW.get(p.col) ?? 0, need.get(id)));
    rowH.set(p.row, Math.max(rowH.get(p.row) ?? 0, HEADER_H + e.attributes.length * ROW_H + 6));
  }
  const cols = Math.max(...colW.keys()) + 1, rows = Math.max(...rowH.keys()) + 1;
  const width = [...colW.values()].reduce((a, c) => a + c, 0) + (cols - 1) * GAP_X;
  const height = [...rowH.values()].reduce((a, c) => a + c, 0) + (rows - 1) * 40;
  return { cells, cols, rows, width, height };
}

function splitDomain(n) {
  if (rectFor(n)) return [n];
  const parts = [];
  for (let left = n; left > 0;) {
    let take = Math.min(left, MAX_ROWS);
    while (take > 1 && !rectFor(take)) take--;
    parts.push(take);
    left -= take;
  }
  return parts;
}
// n tables -> a filled r x c rectangle with at most rowCap rows (fewest columns first); a prime count stays one column.
function rectFor(n, rowCap = 9) {
  for (let c = 1; c <= n; c++) if (n % c === 0 && n / c <= rowCap) return { r: n / c, c };
  return n <= MAX_ROWS ? { r: n, c: 1 } : null;
}

function orderBlocks(blocks, rels, blockOf) {
  const n = blocks.length;
  const w = Array.from({ length: n }, () => Array(n).fill(0));
  for (const r of rels) {
    const a = blockOf.get(r.from), b = blockOf.get(r.to);
    if (a !== b) { w[a][b]++; w[b][a]++; }
  }
  const widthOf = () => 1;
  const cost = (perm) => {
    const pos = new Array(n);
    let x = 0;
    for (const i of perm) { pos[i] = x + widthOf() / 2; x += widthOf(); }
    let c = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) if (w[i][j]) c += w[i][j] * Math.abs(pos[i] - pos[j]);
    return c;
  };
  const idx = [...Array(n).keys()];
  if (n <= 8) {
    let best = idx, bestCost = Infinity;
    const permute = (arr, k) => {
      if (k === arr.length) { const c = cost(arr); if (c < bestCost) { bestCost = c; best = [...arr]; } return; }
      for (let i = k; i < arr.length; i++) { [arr[k], arr[i]] = [arr[i], arr[k]]; permute(arr, k + 1); [arr[k], arr[i]] = [arr[i], arr[k]]; }
    };
    permute([...idx], 0);
    return best;
  }
  // greedy insertion for many domains
  const perm = [idx[0]];
  for (const i of idx.slice(1)) {
    let best = 0, bestCost = Infinity;
    for (let p = 0; p <= perm.length; p++) {
      const t = [...perm.slice(0, p), i, ...perm.slice(p)];
      const c = cost(t.concat(idx.filter((x) => !t.includes(x))));
      if (c < bestCost) { bestCost = c; best = p; }
    }
    perm.splice(best, 0, i);
  }
  return perm;
}

// Parents before children inside the domain; then either keep that order or put big tables first so rows share heights.
function sortBlock(list, rels, adj, blockOf, bi, sizeSort) {
  const inside = new Set(list.map((e) => e.id));
  const depth = new Map(list.map((e) => [e.id, 0]));
  for (let pass = 0; pass < list.length; pass++) {
    let changed = false;
    for (const r of rels) {
      if (!inside.has(r.from) || !inside.has(r.to)) continue;
      const fromIsParent = r.fromCardinality === 'one' && r.toCardinality === 'many';
      const [p, c] = fromIsParent ? [r.from, r.to] : [r.to, r.from];
      if (depth.get(c) <= depth.get(p) && depth.get(p) < list.length) { depth.set(c, depth.get(p) + 1); changed = true; }
    }
    if (!changed) break;
  }
  const rank = new Map(list.map((e, i) => [e, i]));
  const ext = (e) => [...adj.get(e.id)].filter((x) => blockOf.get(x) !== bi).length;
  const sorted = [...list].sort((a, b) => {
    if (sizeSort) return b.attributes.length - a.attributes.length || rank.get(a) - rank.get(b);
    return depth.get(a.id) - depth.get(b.id) || ext(b) - ext(a) || rank.get(a) - rank.get(b);
  });
  return sizeSort ? sorted : shortenRuns(sorted, rels);
}

// Hill-climb the row order so related tables of one domain sit next to each other: a run that skips over unrelated
// tables in the same column is what the router refuses (clean-flow/edge-through-node).
function shortenRuns(list, rels) {
  const ids = new Set(list.map((e) => e.id));
  const edges = rels.filter((r) => ids.has(r.from) && ids.has(r.to)).map((r) => [r.from, r.to]);
  if (!edges.length || list.length < 3) return list;
  const cost = (arr) => {
    const pos = new Map(arr.map((e, i) => [e.id, i]));
    let c = 0;
    for (const [a, b] of edges) { const d = Math.abs(pos.get(a) - pos.get(b)); if (d > 1) c += (d - 1) * (d - 1) + 2; }
    return c;
  };
  let cur = list, curCost = cost(cur);
  for (let improved = true; improved;) {
    improved = false;
    let bestArr = null, bestCost = curCost;
    for (let i = 0; i < cur.length; i++) {
      for (let j = i + 1; j < cur.length; j++) {
        const t = [...cur];
        [t[i], t[j]] = [t[j], t[i]];
        const c = cost(t);
        if (c < bestCost) { bestCost = c; bestArr = t; }
      }
    }
    if (bestArr) { cur = bestArr; curCost = bestCost; improved = true; }
  }
  return cur;
}

// ---- widths ----------------------------------------------------------------------------------------------
function keyColumn(entity) {
  let widest = 0;
  for (const a of entity.attributes) {
    const n = a.key === undefined ? 0 : [].concat(a.key).length;
    if (n) widest = Math.max(widest, n * METRICS.badge + (n - 1) * METRICS.badgeGap - METRICS.badgeInset);
  }
  return Math.max(METRICS.keyBase, widest ? widest + METRICS.keyGap : 0);
}
function keyWidthFor(roleCount) {
  const widest = roleCount ? roleCount * METRICS.badge + (roleCount - 1) * METRICS.badgeGap - METRICS.badgeInset : 0;
  return Math.max(METRICS.keyBase, widest ? widest + METRICS.keyGap : 0);
}
// Width one row needs when its table's key column is as wide as this row's own roles require.
function rowWidth(a, roles) {
  const name = textUnits(a.name) * widthFactor;
  const type = a.type ? textUnits(a.type) * widthFactor : 0;
  const text = name * METRICS.rowFont + (type ? type * METRICS.typeFont + 8 : 0);
  return Math.ceil(text + METRICS.padX * 2 + keyWidthFor(roles.length)) + 2;
}
function requiredWidth(entity) {
  const keyW = keyColumn(entity);
  let need = METRICS.defaultW;
  for (const a of entity.attributes) {
    const name = textUnits(a.name) * widthFactor;
    const type = a.type ? textUnits(a.type) * widthFactor : 0;
    const text = name * METRICS.rowFont + (type ? type * METRICS.typeFont + 8 : 0);
    need = Math.max(need, Math.ceil(text + METRICS.padX * 2 + keyW) + 2);
  }
  const header = Math.ceil(textUnits(entity.label) * METRICS.headerFontMin * widthFactor + METRICS.titleInset + METRICS.padX) + 2;
  return Math.max(need, header);
}
function sizeColumns(entities) {
  const cols = new Map();
  for (const e of entities) {
    e.width = requiredWidth(e);
    cols.set(e.col, Math.max(cols.get(e.col) ?? 0, e.width));
  }
  for (const e of entities) {
    const w = cols.get(e.col);
    if (w > METRICS.defaultW) e.width = w;
    else delete e.width;
  }
}

// Layout-only retries (never touches content): pin same-column detours to a side channel, widen channels, change row order.
export function relax(candidate, diagnostics, attempt, spec, ctx) {
  const flagged = new Set();
  const widths = [];
  for (const d of diagnostics) {
    const rel = /relationships\[(\d+)\] id "([^"]+)"/.exec(d.message ?? '');
    if (rel) flagged.add(rel[2]);
    const req = d.evidence?.requiredEntityWidth;
    if (req && d.subject?.entityId) widths.push([d.subject.entityId, req]);
  }
  let next = candidate;
  if (attempt === 2) {
    next = compile(spec, ctx, 1);
  } else {
    next.layout.gapX += attempt === 1 ? 24 : 0;
  }
  const byId = new Map(next.entities.map((e) => [e.id, e]));
  const lastCol = Math.max(...next.entities.map((e) => e.col));
  for (const [id, w] of widths) {
    const e = byId.get(id);
    if (e) e.width = Math.max(e.width ?? METRICS.defaultW, w);
  }
  for (const r of next.relationships) {
    if (!flagged.has(r.id)) continue;
    const a = byId.get(r.from), b = byId.get(r.to);
    if (!a || !b) continue;
    const toward = a.col === 0 ? 'left' : a.col === lastCol ? 'right' : (r.fromSide === 'right' ? 'left' : 'right');
    const side = attempt % 2 === 1 ? (toward === 'left' ? 'right' : 'left') : toward;
    if (a.col === b.col) { r.fromSide = side; r.toSide = side; }
    else if (attempt >= 1) { r.fromSide = a.col < b.col ? 'right' : 'left'; r.toSide = a.col < b.col ? 'left' : 'right'; }
  }
  return next;
}
