// Architecture compiler: semantic spec → Archify architecture candidate (placement, sizes, boundary pads).
// Spec format: ../../references/specs/architecture.md. Routes stay automatic; no via/sides/label pins.
//
// Placement: components go on a grid (col, row). A deterministic local search scores grid layouts by
// estimated crossings, edges through nodes, bends, length and boundary purity (a boundary's member
// rectangle may hold no non-member). The few best layouts are probed with `archify validate
// --layout-json` (sources stripped, so no repo needed) and the one with the fewest routed crossings wins.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const type = 'architecture';

const KINDS = new Set(['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external']);
const VARIANTS = new Set(['default', 'emphasis', 'security', 'dashed']);
const BOUNDARY_KINDS = new Set(['region', 'security-group']);
const DOTS = new Set(['cyan', 'emerald', 'violet', 'amber', 'rose', 'orange', 'slate']);
const ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const ARCHIFY = resolve(process.env.ARCHIFY_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'archify'));
const DETAILS_TITLE = { vi: 'Chi tiết thành phần', en: 'Component details' };

// Per-spec state shared between compile and relax (relax receives the same spec object).
const memo = new WeakMap();

export function compile(spec, ctx = {}) {
  const model = validate(spec);
  const layouts = searchLayouts(model);
  const geometry = { gapScale: 1, extraWidth: {} };
  const state = { model, layouts, pick: 0, geometry, probe: [] };
  memo.set(spec, state);

  // Probe the best grid layouts against Archify's router; keep the one with the fewest real crossings,
  // then try moving the endpoints of the remaining crossings (bounded, deterministic).
  if (existsSync(join(ARCHIFY, 'bin', 'archify.mjs'))) {
    const tried = new Map();
    const run = (pos) => {
      const key = JSON.stringify(pos);
      if (!tried.has(key)) {
        const r = probe(build(spec, ctx, model, pos, geometry));
        tried.set(key, { pos, ...r, score: (r.ok ? 0 : 1000) + r.crossings * 10 + cost(model, pos, 0) * 0.01 });
        state.probe.push({ ok: r.ok, crossings: r.crossings, codes: r.codes });
      }
      return tried.get(key);
    };
    let best = null;
    for (const pos of layouts.slice(0, 6)) {
      const r = run(pos);
      if (!best || r.score < best.score) best = r;
    }
    for (let round = 0; round < 4 && best.crossings > 0; round++) {
      const nodes = new Set(best.pairs.flatMap(([x, y]) => [model.edges[x].a, model.edges[x].b, model.edges[y].a, model.edges[y].b]));
      const variants = moves(model, best.pos, [...nodes]).slice(0, 30);
      let improved = false;
      for (const pos of variants) {
        const r = run(pos);
        if (r.score < best.score) { best = r; improved = true; }
        if (best.crossings === 0 && best.ok) break;
      }
      if (!improved) break;
    }
    layouts.unshift(best.pos);
    state.pick = 0;
    state.chosen = best;
  }
  const out = build(spec, ctx, model, layouts[state.pick], geometry);
  if (process.env.COMPILER_DEBUG) console.error(JSON.stringify(state.probe));
  if (state.chosen) console.error(`architecture: ${state.probe.length} layout probe(s), best ${state.chosen.ok ? 'valid' : 'invalid'} with ${state.chosen.crossings} routed crossing(s)`);
  return out;
}

// Layout-only reaction to a failed finalize: widen boxes that overflowed, open gaps, or try the next grid.
export function relax(candidate, diagnostics, attempt, spec, ctx = {}) {
  const state = memo.get(spec);
  if (!state) return null;
  const codes = diagnostics.map((d) => d.code ?? '');
  let changed = false;
  for (const d of diagnostics) {
    const id = d.subject?.nodeId;
    const need = d.evidence?.requiredWidthPx ?? (d.evidence?.estimatedWidthPx ? d.evidence.estimatedWidthPx - 8 : null);
    if (id && need && /component-(label|sublabel|tag)-overflow/.test(d.code)) {
      state.geometry.extraWidth[id] = Math.max(state.geometry.extraWidth[id] ?? 0, Math.ceil(need - currentWidth(candidate, id)) + 12);
      changed = true;
    }
  }
  const structural = codes.some((c) => /boundary-encloses-non-member|edge-through-node|proper-crossing|endpoint-side/.test(c));
  if (structural && state.pick + 1 < state.layouts.length) {
    state.pick += 1;
    changed = true;
  } else if (codes.some((c) => /label|gap|separation|corridor|border-run|rhythm|out-of-bounds|overlap|crossing/.test(c)) || !changed) {
    state.geometry.gapScale *= 1.25;
    changed = true;
  }
  if (!changed || state.geometry.gapScale > 2.5) return null;
  return build(spec, ctx, state.model, state.layouts[state.pick], state.geometry);
}

function currentWidth(candidate, id) {
  return candidate.components.find((c) => c.id === id)?.size?.[0] ?? 0;
}

// ---------------------------------------------------------------- spec validation

function validate(spec) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!spec.title) fail('spec.title is required');
  const comps = spec.components ?? [];
  if (!comps.length) fail('spec.components must list at least one component');
  const ids = new Set();
  const boundaries = new Map();
  for (const b of spec.boundaries ?? []) {
    if (!ID.test(b.id ?? '')) fail(`boundary id "${b.id}" must match ${ID}`);
    if (boundaries.has(b.id)) fail(`duplicate boundary id "${b.id}"`);
    if (!b.label) fail(`boundary "${b.id}" needs a label`);
    if (!BOUNDARY_KINDS.has(b.kind ?? 'region')) fail(`boundary "${b.id}" kind must be region or security-group`);
    boundaries.set(b.id, b);
  }
  for (const b of boundaries.values()) {
    if (b.parent && !boundaries.has(b.parent)) fail(`boundary "${b.id}" parent "${b.parent}" is not a boundary`);
    const seen = new Set([b.id]);
    for (let p = b.parent; p; p = boundaries.get(p)?.parent) {
      if (seen.has(p)) { fail(`boundary parent cycle at "${b.id}"`); break; }
      seen.add(p);
    }
  }
  for (const c of comps) {
    if (!ID.test(c.id ?? '')) fail(`component id "${c.id}" must match ${ID}`);
    if (ids.has(c.id)) fail(`duplicate component id "${c.id}"`);
    ids.add(c.id);
    if (!c.label) fail(`component "${c.id}" needs a label`);
    const kind = c.kind ?? c.type;
    if (!KINDS.has(kind)) fail(`component "${c.id}" kind "${kind}" must be one of ${[...KINDS].join(', ')}`);
    if (c.boundary && !boundaries.has(c.boundary)) fail(`component "${c.id}" boundary "${c.boundary}" is not declared in spec.boundaries`);
    if ((c.sources ?? []).length > 3) fail(`component "${c.id}" has ${c.sources.length} sources (max 3)`);
    for (const s of c.sources ?? []) if (!s.path) fail(`component "${c.id}" has a source without path`);
  }
  if (boundaries.has([...ids].find((id) => boundaries.has(id)))) fail('boundary ids and component ids must differ');
  for (const b of boundaries.values()) {
    if (!membersOf(b.id, comps, boundaries).length) fail(`boundary "${b.id}" has no members`);
  }
  const edges = [];
  for (const [k, e] of (spec.connections ?? []).entries()) {
    if (!ids.has(e.from)) fail(`connection #${k + 1} from "${e.from}" is not a component`);
    if (!ids.has(e.to)) fail(`connection #${k + 1} to "${e.to}" is not a component`);
    if (e.from === e.to) fail(`connection #${k + 1} is a self-loop on "${e.from}"`);
    if (e.variant && !VARIANTS.has(e.variant)) fail(`connection #${k + 1} variant "${e.variant}" must be one of ${[...VARIANTS].join(', ')}`);
    if (e.id && !ID.test(e.id)) fail(`connection id "${e.id}" must match ${ID}`);
    edges.push(e);
  }
  for (const card of spec.cards ?? []) {
    if (!card.title || !Array.isArray(card.items)) fail('each card needs title and items[]');
    if (card.dot && !DOTS.has(card.dot)) fail(`card "${card.title}" dot "${card.dot}" must be one of ${[...DOTS].join(', ')}`);
  }
  if (errors.length) throw new Error(`architecture spec invalid:\n- ${errors.join('\n- ')}`);

  const index = new Map(comps.map((c, i) => [c.id, i]));
  // chain[i] = boundary ids from outermost to innermost for component i
  const chain = comps.map((c) => {
    const out = [];
    for (let b = c.boundary; b; b = boundaries.get(b).parent) out.unshift(b);
    return out;
  });
  return {
    comps,
    boundaries,
    index,
    chain,
    edges: edges.map((e) => ({ a: index.get(e.from), b: index.get(e.to), e })),
  };
}

function membersOf(boundaryId, comps, boundaries) {
  const inside = (b) => b && (b === boundaryId || inside(boundaries.get(b)?.parent));
  return comps.filter((c) => inside(c.boundary)).map((c) => c.id);
}

// ---------------------------------------------------------------- grid search

function searchLayouts(model) {
  const n = model.comps.length;
  const layer = layering(model);
  const cols = Math.max(...layer) + 1;
  const seeds = [];
  // Seed rows: per column, components sorted by boundary chain then spec order.
  const groupKey = (i) => model.chain[i].join('/') || '~';
  const onMain = model.comps.map((_, i) => (model.edges.some(({ a, b, e }) => e.variant === 'emphasis' && (a === i || b === i)) ? 1 : 0));
  const byGroup = (x, y) => (groupKey(x) < groupKey(y) ? -1 : groupKey(x) > groupKey(y) ? 1 : x - y);
  for (const centered of [false, true]) {
    const pos = new Array(n);
    for (let c = 0; c < cols; c++) {
      const members = [...Array(n).keys()].filter((i) => layer[i] === c);
      const main = members.filter((i) => onMain[i]).sort(byGroup);
      const rest = members.filter((i) => !onMain[i]).sort(byGroup);
      main.forEach((i, r) => (pos[i] = [c, 4 + r]));
      rest.forEach((i, k) => {
        const below = !centered || k % 2 === 0;
        const step = centered ? Math.floor(k / 2) + 1 : k + 1;
        pos[i] = [c, below ? 4 + Math.max(main.length, 1) - 1 + step : 4 - step];
      });
    }
    seeds.push(normalize(pos));
  }
  const rows = Math.max(...seeds.flat().map((p) => p[1])) + 1;
  const R = Math.min(rows + 2, Math.max(rows, 6));
  const C = Math.min(cols + 1, 8);
  const results = [];
  const seen = new Set();
  for (const seed of seeds) {
    for (const weightSet of [0, 1]) {
      const pos = localSearch(model, seed.map((p) => [...p]), C, R, weightSet);
      const norm = normalize(pos);
      const key = JSON.stringify(norm);
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ pos: norm, cost: cost(model, norm, 0) });
    }
  }
  // Also offer single-move neighbours of the best layout so the probe has alternatives.
  results.sort((a, b) => a.cost - b.cost);
  const extra = neighbours(model, results[0].pos, C, R).filter((p) => !seen.has(JSON.stringify(p)));
  for (const p of extra.slice(0, 6)) { seen.add(JSON.stringify(p)); results.push({ pos: p, cost: cost(model, p, 0) }); }
  results.sort((a, b) => a.cost - b.cost);
  return results.map((r) => r.pos);
}

// Longest-path layering. Cycles break at the edge that returns to a component already on the DFS
// stack; DFS starts from components with no incoming connection (in spec order), external actors first.
function layering(model) {
  const n = model.comps.length;
  const out = Array.from({ length: n }, () => []);
  const indeg = new Array(n).fill(0);
  for (const { a, b } of model.edges) { out[a].push(b); indeg[b]++; }
  const kind = (i) => model.comps[i].kind ?? model.comps[i].type;
  const rank = (i) => (indeg[i] > 0 ? 2 : 0) + (kind(i) === 'external' ? 0 : 1);
  const roots = [...Array(n).keys()].sort((x, y) => rank(x) - rank(y) || x - y);
  const state = new Array(n).fill(0);
  const dag = [];
  const visit = (v) => {
    state[v] = 1;
    for (const w of out[v]) {
      if (state[w] === 1) dag.push([w, v]);
      else { dag.push([v, w]); if (!state[w]) visit(w); }
    }
    state[v] = 2;
  };
  for (const r of roots) if (!state[r]) visit(r);
  const layer = new Array(n).fill(0);
  for (let k = 0; k < n; k++) for (const [a, b] of dag) if (layer[b] < layer[a] + 1) layer[b] = layer[a] + 1;
  // Pull pure sources next to their first consumer.
  const preds = new Array(n).fill(0);
  for (const [, b] of dag) preds[b]++;
  for (let v = 0; v < n; v++) {
    const succ = dag.filter(([a]) => a === v).map(([, b]) => layer[b]);
    if (!preds[v] && succ.length) layer[v] = Math.max(0, Math.min(...succ) - 1);
  }
  const used = [...new Set(layer)].sort((x, y) => x - y);
  return layer.map((l) => used.indexOf(l));
}

function localSearch(model, pos, C, R, weightSet) {
  let current = cost(model, pos, weightSet);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = 0; i < pos.length; i++) {
      let best = null;
      for (let c = 0; c < C; c++) {
        for (let r = 0; r < R; r++) {
          if (pos[i][0] === c && pos[i][1] === r) continue;
          const j = pos.findIndex((p) => p[0] === c && p[1] === r);
          const old = pos[i];
          pos[i] = [c, r];
          if (j >= 0) pos[j] = old;
          const value = cost(model, pos, weightSet);
          if (value < current - 1e-9 && (!best || value < best.value)) best = { value, cell: [c, r], j };
          pos[i] = old;
          if (j >= 0) pos[j] = [c, r];
        }
      }
      if (best) {
        const old = pos[i];
        pos[i] = best.cell;
        if (best.j >= 0) pos[best.j] = old;
        current = best.value;
        improved = true;
      }
    }
    // Block moves: shift a boundary's members together, or swap two whole rows/columns.
    const blocks = [...model.boundaries.keys()].map((id) => model.comps.map((_, i) => i).filter((i) => model.chain[i].includes(id)));
    const tries = [];
    // A node moves together with its leaf neighbours (actors, stores that only talk to it).
    const degree = model.comps.map((_, i) => model.edges.filter(({ a, b }) => a === i || b === i).length);
    for (let i = 0; i < pos.length; i++) {
      const leaves = model.edges.filter(({ a, b }) => a === i || b === i).map(({ a, b }) => (a === i ? b : a)).filter((j) => degree[j] === 1);
      if (leaves.length) blocks.push([i, ...leaves]);
    }
    for (const block of blocks) {
      for (let dc = -2; dc <= 2; dc++) for (let dr = -3; dr <= 3; dr++) if (dc || dr) tries.push(() => shiftBlock(pos, block, dc, dr, C, R));
    }
    for (let r1 = 0; r1 < R; r1++) for (let r2 = r1 + 1; r2 < R; r2++) tries.push(() => pos.map(([c, r]) => [c, r === r1 ? r2 : r === r2 ? r1 : r]));
    for (let c1 = 0; c1 < C; c1++) for (let c2 = c1 + 1; c2 < C; c2++) tries.push(() => pos.map(([c, r]) => [c === c1 ? c2 : c === c2 ? c1 : c, r]));
    for (const make of tries) {
      const next = make();
      if (!next) continue;
      const value = cost(model, next, weightSet);
      if (value < current - 1e-9) { next.forEach((p, i) => (pos[i] = p)); current = value; improved = true; }
    }
    if (!improved) break;
  }
  return pos;
}

// Single-node relocations/swaps of the given nodes, cheapest first (estimated cost).
function moves(model, pos, nodes) {
  const C = Math.max(...pos.map((p) => p[0])) + 2;
  const R = Math.max(...pos.map((p) => p[1])) + 2;
  const out = [];
  for (const i of nodes) {
    for (let c = 0; c < C; c++) {
      for (let r = 0; r < R; r++) {
        if (pos[i][0] === c && pos[i][1] === r) continue;
        const next = pos.map((p) => [...p]);
        const j = pos.findIndex((p) => p[0] === c && p[1] === r);
        next[i] = [c, r];
        if (j >= 0) next[j] = [...pos[i]];
        const norm = normalize(next);
        out.push({ v: cost(model, norm, 0), p: norm });
      }
    }
  }
  return out.sort((a, b) => a.v - b.v).map((x) => x.p);
}

function shiftBlock(pos, block, dc, dr, C, R) {
  const set = new Set(block);
  const next = pos.map((p) => [...p]);
  for (const i of block) {
    const c = pos[i][0] + dc;
    const r = pos[i][1] + dr;
    if (c < 0 || r < 0 || c >= C || r >= R) return null;
    next[i] = [c, r];
  }
  // Displaced non-members take the cells the block vacated, in order.
  const vacated = block.map((i) => pos[i]).filter(([c, r]) => !block.some((j) => next[j][0] === c && next[j][1] === r));
  for (let i = 0; i < pos.length; i++) {
    if (set.has(i)) continue;
    if (block.some((j) => next[j][0] === pos[i][0] && next[j][1] === pos[i][1])) {
      const cell = vacated.shift();
      if (!cell) return null;
      next[i] = [...cell];
    }
  }
  return next;
}

function neighbours(model, pos, C, R) {
  const out = [];
  const base = cost(model, pos, 0);
  for (let i = 0; i < pos.length; i++) {
    for (let c = 0; c < C; c++) {
      for (let r = 0; r < R; r++) {
        if (pos.some((p) => p[0] === c && p[1] === r)) continue;
        const next = pos.map((p) => [...p]);
        next[i] = [c, r];
        const v = cost(model, next, 0);
        if (v < base + 6) out.push({ v, p: normalize(next) });
      }
    }
  }
  return out.sort((a, b) => a.v - b.v).map((x) => x.p);
}

function normalize(pos) {
  const cols = [...new Set(pos.map((p) => p[0]))].sort((a, b) => a - b);
  const rows = [...new Set(pos.map((p) => p[1]))].sort((a, b) => a - b);
  return pos.map(([c, r]) => [cols.indexOf(c), rows.indexOf(r)]);
}

// Lower is better. Units are grid cells.
function cost(model, pos, weightSet) {
  const W = weightSet === 0
    ? { cross: 12, through: 14, len: 1, bend: 1.5, back: 3, main: 4, impure: 60, overlap: 60, span: 0.6, share: 3 }
    : { cross: 16, through: 14, len: 0.7, bend: 2.5, back: 2, main: 2, impure: 60, overlap: 60, span: 0.3, share: 4 };
  let total = 0;
  const segs = model.edges.map(({ a, b }) => [pos[a], pos[b]]);
  for (const [k, { a, b, e }] of model.edges.entries()) {
    const [p, q] = segs[k];
    const dx = q[0] - p[0];
    const dy = q[1] - p[1];
    // Ideal: one column to the right on the same row (main path), or a branch directly above/below.
    const main = e.variant === 'emphasis' ? W.main : 1;
    if (dx === 0) total += W.len * (Math.abs(dy) - 1) + 0.5 + (main > 1 ? 2 * W.main : 0);
    else total += W.len * (main * 2 * Math.abs(dy) + Math.abs(dx) - 1);
    if (dx && dy) total += W.bend;
    if (dx < 0) total += main * W.back;
    for (let i = 0; i < pos.length; i++) {
      if (i === a || i === b) continue;
      if (nearSegment(pos[i], p, q)) total += W.through;
    }
  }
  for (let x = 0; x < segs.length; x++) {
    for (let y = x + 1; y < segs.length; y++) {
      const ex = model.edges[x];
      const ey = model.edges[y];
      const shared = [ex.a, ex.b].filter((v) => v === ey.a || v === ey.b);
      if (shared.length) {
        if (shared.length === 1 && collinearOverlap(segs[x], segs[y])) total += W.share;
        continue;
      }
      if (properCross(segs[x][0], segs[x][1], segs[y][0], segs[y][1])) total += W.cross;
    }
  }
  // Boundaries: member rectangle must not contain non-members; sibling rectangles must not overlap.
  const rects = new Map();
  for (const id of model.boundaries.keys()) {
    const members = model.comps.map((c, i) => i).filter((i) => model.chain[i].includes(id));
    const cs = members.map((i) => pos[i][0]);
    const rs = members.map((i) => pos[i][1]);
    const rect = { c0: Math.min(...cs), c1: Math.max(...cs), r0: Math.min(...rs), r1: Math.max(...rs), members: new Set(members) };
    rects.set(id, rect);
    for (let i = 0; i < pos.length; i++) {
      if (rect.members.has(i)) continue;
      if (pos[i][0] >= rect.c0 && pos[i][0] <= rect.c1 && pos[i][1] >= rect.r0 && pos[i][1] <= rect.r1) total += W.impure;
    }
  }
  const ids = [...rects.keys()];
  for (let x = 0; x < ids.length; x++) {
    for (let y = x + 1; y < ids.length; y++) {
      const nested = nestedIn(model, ids[x], ids[y]) || nestedIn(model, ids[y], ids[x]);
      if (nested) continue;
      const A = rects.get(ids[x]);
      const B = rects.get(ids[y]);
      if (A.c0 <= B.c1 && B.c0 <= A.c1 && A.r0 <= B.r1 && B.r0 <= A.r1) total += W.overlap;
    }
  }
  const cols = new Set(pos.map((p) => p[0])).size;
  const rows = new Set(pos.map((p) => p[1])).size;
  total += W.span * (cols + rows) + Math.max(0, cols - 6) * 6 + Math.max(0, rows - 5) * 4;
  return total;
}

function nestedIn(model, inner, outer) {
  for (let p = model.boundaries.get(inner).parent; p; p = model.boundaries.get(p).parent) if (p === outer) return true;
  return false;
}

function nearSegment(pt, p, q) {
  const [x, y] = pt;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const len2 = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((x - p[0]) * dx + (y - p[1]) * dy) / len2));
  if (t <= 0 || t >= 1) return false;
  const px = p[0] + t * dx - x;
  const py = p[1] + t * dy - y;
  return px * px + py * py < 0.45 * 0.45;
}

function collinearOverlap([p, q], [r, s]) {
  // Two edges leaving the same node in the same straight direction share a corridor.
  const d1 = [Math.sign(q[0] - p[0]), Math.sign(q[1] - p[1])];
  const d2 = [Math.sign(s[0] - r[0]), Math.sign(s[1] - r[1])];
  const sameStart = (p[0] === r[0] && p[1] === r[1]) || (q[0] === s[0] && q[1] === s[1]);
  if (!sameStart) return false;
  const dirA = q[0] === s[0] && q[1] === s[1] ? [-d1[0], -d1[1]] : d1;
  const dirB = q[0] === s[0] && q[1] === s[1] ? [-d2[0], -d2[1]] : d2;
  return dirA[0] === dirB[0] && dirA[1] === dirB[1] && (dirA[0] === 0 || dirA[1] === 0);
}

function properCross(p1, p2, p3, p4) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const a = o(p1, p2, p3);
  const b = o(p1, p2, p4);
  const c = o(p3, p4, p1);
  const d = o(p3, p4, p2);
  return a * b < 0 && c * d < 0;
}

// ---------------------------------------------------------------- pixel geometry

const units = (text) => Array.from(String(text ?? '')).reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);
const labelMask = (text) => (text ? 6.5 * units(text) + 21 : 0);

function boxSize(c, extra = 0) {
  const need = Math.max(
    120,
    units(c.label) * 6.6 - 8 + 4,
    c.sublabel ? units(c.sublabel) * 5.4 + 8 + 16 : 0,
    c.tag ? units(c.tag) * 0.6 * 7 + 8 + 16 : 0,
  );
  return [Math.ceil(Math.min(260, need + extra) / 2) * 2, c.tag ? 76 : 64];
}

function build(spec, ctx, model, pos, geometry) {
  const { comps, edges, chain } = model;
  const n = comps.length;
  const sizes = comps.map((c) => boxSize(c, geometry.extraWidth[c.id] ?? 0));
  const C = Math.max(...pos.map((p) => p[0])) + 1;
  const R = Math.max(...pos.map((p) => p[1])) + 1;
  const colW = Array.from({ length: C }, (_, c) => Math.max(0, ...comps.map((_, i) => (pos[i][0] === c ? sizes[i][0] : 0))));
  const rowH = Array.from({ length: R }, (_, r) => Math.max(0, ...comps.map((_, i) => (pos[i][1] === r ? sizes[i][1] : 0))));
  const depth = (id) => { let d = 0; for (let p = model.boundaries.get(id).parent; p; p = model.boundaries.get(p).parent) d++; return d; };
  const height = (id) => Math.max(0, ...[...model.boundaries.keys()].filter((b) => nestedIn(model, b, id)).map((b) => 1 + height(b)));
  const pad = (id) => 16 + 12 * height(id);
  const bRects = [...model.boundaries.keys()].map((id) => {
    const members = [...Array(n).keys()].filter((i) => chain[i].includes(id));
    return { id, c0: Math.min(...members.map((i) => pos[i][0])), c1: Math.max(...members.map((i) => pos[i][0])), r0: Math.min(...members.map((i) => pos[i][1])), r1: Math.max(...members.map((i) => pos[i][1])) };
  });

  const scale = geometry.gapScale;
  const gapX = Array.from({ length: Math.max(0, C - 1) }, (_, c) => {
    let need = 72;
    for (const { a, b, e } of edges) {
      const lo = Math.min(pos[a][0], pos[b][0]);
      const hi = Math.max(pos[a][0], pos[b][0]);
      if (lo <= c && hi >= c + 1 && (pos[a][1] === pos[b][1] || hi - lo === 1)) need = Math.max(need, labelMask(edgeLabel(e)) + 8);
    }
    // Frames whose left or right side falls in this gap.
    let frames = 0;
    for (const r of bRects) { if (r.c1 === c) frames += pad(r.id) + 10; if (r.c0 === c + 1) frames += pad(r.id) + 10; }
    return Math.ceil(Math.max(need, frames + 24) * scale);
  });
  const gapY = Array.from({ length: Math.max(0, R - 1) }, (_, r) => {
    let need = 52;
    for (const { a, b, e } of edges) {
      const lo = Math.min(pos[a][1], pos[b][1]);
      const hi = Math.max(pos[a][1], pos[b][1]);
      if (lo <= r && hi >= r + 1 && edgeLabel(e)) need = Math.max(need, 46);
    }
    let frames = 0;
    for (const b of bRects) { if (b.r1 === r) frames += 20 + 8; if (b.r0 === r + 1) frames += Math.max(pad(b.id), 24) + 8 + 6 * depth(b.id); }
    return Math.ceil(Math.max(need, frames + 20) * scale);
  });
  // Top/left margins leave room for frames around the first row/column.
  const topFrames = bRects.filter((b) => b.r0 === 0).reduce((m, b) => Math.max(m, Math.max(pad(b.id), 24) + 6 + 6 * depth(b.id)), 0);
  const leftFrames = bRects.filter((b) => b.c0 === 0).reduce((m, b) => Math.max(m, pad(b.id)), 0);
  const x0 = 40 + leftFrames;
  const y0 = 40 + topFrames;
  const colX = [x0];
  for (let c = 1; c < C; c++) colX[c] = colX[c - 1] + colW[c - 1] + gapX[c - 1];
  const rowY = [y0];
  for (let r = 1; r < R; r++) rowY[r] = rowY[r - 1] + rowH[r - 1] + gapY[r - 1];

  const components = comps.map((c, i) => {
    const [w, h] = sizes[i];
    const [col, row] = pos[i];
    const out = {
      id: c.id,
      type: c.kind ?? c.type,
      label: c.label,
      ...(c.sublabel ? { sublabel: c.sublabel } : {}),
      ...(c.tag ? { tag: c.tag } : {}),
      ...(c.icon ? { icon: c.icon } : {}),
      ...(c.sources?.length ? { sources: c.sources } : {}),
      pos: [Math.round(colX[col] + (colW[col] - w) / 2), Math.round(rowY[row] + (rowH[row] - h) / 2)],
      size: [w, h],
    };
    return out;
  });

  const boundaries = [...model.boundaries.values()]
    .sort((x, y) => depth(x.id) - depth(y.id))
    .map((b) => ({
      kind: b.kind ?? 'region',
      label: b.label,
      wraps: membersOf(b.id, comps, model.boundaries),
      pad: pad(b.id),
    }));

  const connections = edges.map(({ e }, k) => ({
    id: e.id ?? `c${k + 1}-${e.from}-${e.to}`.slice(0, 60),
    from: e.from,
    to: e.to,
    ...(edgeLabel(e) ? { label: edgeLabel(e) } : {}),
    ...(e.variant && e.variant !== 'default' ? { variant: e.variant } : {}),
  }));

  const cards = (spec.cards ?? []).map((card) => ({ dot: card.dot ?? 'slate', title: card.title, items: card.items }));
  const detailed = comps.filter((c) => c.detail);
  if (detailed.length) {
    cards.push({
      dot: spec.detailsCard?.dot ?? 'slate',
      title: spec.detailsCard?.title ?? DETAILS_TITLE[ctx.lang] ?? DETAILS_TITLE.en,
      items: detailed.map((c) => `${c.label}: ${c.detail}`),
    });
  }

  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: spec.title,
      ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
      quality_profile: ctx.quality ?? 'showcase',
      ...(ctx.repository ? { repository: ctx.repository } : {}),
      ...(spec.views?.length ? { views: spec.views } : {}),
    },
    components,
    ...(boundaries.length ? { boundaries } : {}),
    connections,
    ...(cards.length ? { cards } : {}),
  };
}

function edgeLabel(e) {
  return [e.label, e.protocol].filter(Boolean).join(' · ');
}

// ---------------------------------------------------------------- Archify probe

function probe(candidate) {
  const doc = structuredClone(candidate);
  delete doc.meta.repository;
  doc.meta.output = 'probe.html';
  for (const c of doc.components) delete c.sources;
  const dir = mkdtempSync(join(tmpdir(), 'arch-probe-'));
  try {
    const file = join(dir, 'candidate.json');
    writeFileSync(file, JSON.stringify(doc));
    const run = spawnSync('node', [join(ARCHIFY, 'bin', 'archify.mjs'), 'validate', 'architecture', file, '--layout-json', '--quality', candidate.meta.quality_profile ?? 'showcase'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let out = null;
    try { out = JSON.parse(run.stdout); } catch { /* not measurable */ }
    if (!out) return { ok: false, crossings: 99, pairs: [], codes: ['probe/unparsed'] };
    const routes = (out.connections ?? []).map((c) => c.points ?? []);
    const pairs = crossingPairs(routes);
    return { ok: run.status === 0 && out.ok !== false, crossings: pairs.length, pairs, codes: (out.diagnostics ?? []).map((d) => d.code) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function crossingPairs(routes) {
  // Closed intersection test (touching and collinear overlap count), ignoring contact at route ends.
  const pairs = [];
  for (let x = 0; x < routes.length; x++) {
    for (let y = x + 1; y < routes.length; y++) {
      const ends = [routes[x][0], routes[x].at(-1), routes[y][0], routes[y].at(-1)];
      let hit = false;
      for (let i = 1; i < routes[x].length && !hit; i++) {
        for (let j = 1; j < routes[y].length && !hit; j++) {
          const pt = touch(routes[x][i - 1], routes[x][i], routes[y][j - 1], routes[y][j]);
          if (pt && !ends.some((e) => Math.abs(e[0] - pt[0]) < 2 && Math.abs(e[1] - pt[1]) < 2)) hit = true;
        }
      }
      if (hit) pairs.push([x, y]);
    }
  }
  return pairs;
}

// Intersection point of two axis-aligned-or-not segments (closed), or null; collinear overlap → overlap midpoint.
function touch(p1, p2, p3, p4) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  const eps = 1e-6;
  if (Math.abs(d1) < eps && Math.abs(d2) < eps) {
    // Collinear: project on the dominant axis.
    const k = Math.abs(p2[0] - p1[0]) >= Math.abs(p2[1] - p1[1]) ? 0 : 1;
    const lo = Math.max(Math.min(p1[k], p2[k]), Math.min(p3[k], p4[k]));
    const hi = Math.min(Math.max(p1[k], p2[k]), Math.max(p3[k], p4[k]));
    if (hi - lo < 1) return null;
    const mid = (lo + hi) / 2;
    return k === 0 ? [mid, p1[1]] : [p1[0], mid];
  }
  if ((d1 > eps && d2 > eps) || (d1 < -eps && d2 < -eps) || (d3 > eps && d4 > eps) || (d3 < -eps && d4 < -eps)) return null;
  const t = d1 / (d1 - d2);
  return [p1[0] + t * (p2[0] - p1[0]), p1[1] + t * (p2[1] - p1[1])];
}
