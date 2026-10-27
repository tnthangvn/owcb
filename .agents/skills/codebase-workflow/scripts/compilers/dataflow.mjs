// Dataflow compiler: semantic spec → Archify dataflow candidate (stage + row per node).
// Spec format: ../../references/specs/dataflow.md. Routes stay automatic; no sides, via or label pins.
//
// Stages come from the spec (or from flow direction when a node names none). Rows (0..4) are chosen by a
// deterministic local search over estimated crossings, flows through nodes and row changes; the best few
// row assignments are probed with `archify validate dataflow` (sources stripped) and the cleanest wins.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const type = 'dataflow';

const KINDS = new Set(['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external']);
const VARIANTS = new Set(['default', 'emphasis', 'security', 'dashed']);
const DOTS = new Set(['cyan', 'emerald', 'violet', 'amber', 'rose', 'orange', 'slate']);
const ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const ROWS = 5;
const ARCHIFY = resolve(process.env.ARCHIFY_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'archify'));
const DETAILS_TITLE = { vi: 'Chi tiết', en: 'Details' };
// Renderer measures (renderers/dataflow): label ≈ 6.2px/unit, node 112px default, stage column 168px.
const NODE_W = 112;
const STAGE_W = 168;

const memo = new WeakMap();

export function compile(spec, ctx = {}) {
  const model = validate(spec);
  const layouts = searchRows(model);
  const state = { model, layouts, pick: 0, probe: [], spacious: false };
  memo.set(spec, state);
  if (existsSync(join(ARCHIFY, 'bin', 'archify.mjs'))) {
    let best = null;
    for (let i = 0; i < Math.min(layouts.length, 8); i++) {
      const r = probe(build(spec, ctx, model, layouts[i], state));
      state.probe.push(r);
      const score = (r.ok ? 0 : 1000) + r.issues * 10 + i * 0.01;
      if (!best || score < best.score) best = { score, i, r };
      if (r.ok && r.issues === 0) break;
    }
    state.pick = best.i;
    console.error(`dataflow: ${state.probe.length} row probe(s), best ${best.r.ok ? 'valid' : 'invalid'}${best.r.issues ? ` (${best.r.issues} check issue(s))` : ''}${model.explicitWidths ? '; explicit node widths (long labels)' : ''}`);
    if (process.env.COMPILER_DEBUG) console.error(JSON.stringify(state.probe));
  }
  return build(spec, ctx, model, layouts[state.pick], state);
}

// Layout-only reaction to a failed finalize: next row assignment, then spread rows apart.
export function relax(candidate, diagnostics, attempt, spec, ctx = {}) {
  const state = memo.get(spec);
  if (!state) return null;
  if (state.pick + 1 < state.layouts.length && attempt < 2) state.pick += 1;
  else if (!state.spacious) state.spacious = true;
  else return null;
  return build(spec, ctx, state.model, state.layouts[state.pick], state);
}

// ---------------------------------------------------------------- spec validation

const units = (text) => Array.from(String(text ?? '')).reduce((n, ch) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(ch) ? 2 : 1), 0);

function validate(spec) {
  const errors = [];
  const fail = (m) => errors.push(m);
  if (!spec.title) fail('spec.title is required');
  const stages = spec.stages ?? [];
  if (stages.length < 2 || stages.length > 5) fail(`spec.stages needs 2..5 stages (got ${stages.length})`);
  const stageIndex = new Map();
  stages.forEach((s, i) => {
    if (!s.label) fail(`stage #${i + 1} needs a label`);
    if (s.id) {
      if (stageIndex.has(s.id)) fail(`duplicate stage id "${s.id}"`);
      stageIndex.set(s.id, i);
    }
  });
  const nodes = spec.nodes ?? [];
  if (nodes.length < 2) fail('spec.nodes needs at least 2 nodes');
  const ids = new Map();
  for (const n of nodes) {
    if (!ID.test(n.id ?? '')) fail(`node id "${n.id}" must match ${ID}`);
    if (ids.has(n.id)) fail(`duplicate node id "${n.id}"`);
    ids.set(n.id, ids.size);
    if (!n.label) fail(`node "${n.id}" needs a label`);
    const kind = n.kind ?? n.type;
    if (!KINDS.has(kind)) fail(`node "${n.id}" kind "${kind}" must be one of ${[...KINDS].join(', ')}`);
    if (n.stage !== undefined && !stageIndex.has(n.stage) && !(Number.isInteger(n.stage) && n.stage >= 0 && n.stage < stages.length)) fail(`node "${n.id}" stage "${n.stage}" is not a stage id or index`);
    if ((n.sources ?? []).length > 3) fail(`node "${n.id}" has ${n.sources.length} sources (max 3)`);
    for (const field of ['sublabel', 'tag']) {
      if (n[field] && units(n[field]) * 0.6 * 6 + 8 > STAGE_W - 8) fail(`node "${n.id}" ${field} "${n[field]}" is too long (keep it under ~40 characters)`);
    }
    if (units(n.label) * 6.2 > STAGE_W + 6) fail(`node "${n.id}" label "${n.label}" is too long for a stage column (max ~${Math.floor((STAGE_W + 6) / 6.2)} characters); move detail to sublabel/detail`);
  }
  const flows = spec.flows ?? [];
  for (const [k, f] of flows.entries()) {
    if (!ids.has(f.from)) fail(`flow #${k + 1} from "${f.from}" is not a node`);
    if (!ids.has(f.to)) fail(`flow #${k + 1} to "${f.to}" is not a node`);
    if (f.from === f.to) fail(`flow #${k + 1} is a self-loop on "${f.from}"`);
    if (!f.label) fail(`flow #${k + 1} (${f.from} → ${f.to}) needs a label`);
    if (f.variant && !VARIANTS.has(f.variant)) fail(`flow #${k + 1} variant "${f.variant}" must be one of ${[...VARIANTS].join(', ')}`);
    if (f.id && !ID.test(f.id)) fail(`flow id "${f.id}" must match ${ID}`);
  }
  for (const card of spec.cards ?? []) {
    if (!card.title || !Array.isArray(card.items)) fail('each card needs title and items[]');
    if (card.dot && !DOTS.has(card.dot)) fail(`card "${card.title}" dot "${card.dot}" must be one of ${[...DOTS].join(', ')}`);
  }
  if (errors.length) throw new Error(`dataflow spec invalid:\n- ${errors.join('\n- ')}`);

  const edges = flows.map((f) => ({ a: ids.get(f.from), b: ids.get(f.to), f }));
  const stage = inferStages(nodes, edges, stages.length, (n) => (n.stage === undefined ? undefined : stageIndex.has(n.stage) ? stageIndex.get(n.stage) : n.stage));
  for (let s = 0; s < stages.length; s++) {
    const count = stage.filter((x) => x === s).length;
    if (count > ROWS) errors.push(`stage "${stages[s].label}" holds ${count} nodes; a stage fits ${ROWS} rows — split the page or move nodes to another stage`);
  }
  if (errors.length) throw new Error(`dataflow spec invalid:\n- ${errors.join('\n- ')}`);

  // Archify grows a node only to fit its sublabel/tag; a longer label needs an explicit width (fallback).
  const autoWidth = (n) => Math.max(NODE_W, Math.min(STAGE_W, Math.ceil(Math.max(0, ...[n.sublabel, n.tag].filter(Boolean).map((t) => units(t) * 7 * 0.6 + 8)))));
  const explicitWidths = nodes.some((n) => units(n.label) * 6.2 > autoWidth(n) + 6);
  for (const f of flows) if (units(f.label) > 24) console.error(`dataflow: flow label "${f.label}" is long (${units(f.label)} units); ~17 fits between adjacent stages`);
  return { nodes, edges, stage, stages, explicitWidths };
}

function inferStages(nodes, edges, count, given) {
  const stage = nodes.map((n) => given(n));
  if (stage.every((s) => s !== undefined)) return stage;
  // Longest path over flows for unplaced nodes, clamped into the stage range.
  const level = nodes.map(() => 0);
  for (let k = 0; k < nodes.length; k++) for (const { a, b } of edges) if (level[b] < level[a] + 1 && level[a] + 1 < nodes.length) level[b] = level[a] + 1;
  const max = Math.max(1, ...level);
  return stage.map((s, i) => (s !== undefined ? s : Math.min(count - 1, Math.round((level[i] / max) * (count - 1)))));
}

// ---------------------------------------------------------------- row search

function searchRows(model) {
  const n = model.nodes.length;
  const seeds = [];
  // Seed 1: spec order per stage. Seed 2: each node on its first predecessor's row when free.
  const first = model.stage.map(() => 0);
  const seed1 = new Array(n);
  for (let i = 0; i < n; i++) seed1[i] = first[model.stage[i]]++;
  seeds.push(seed1);
  const order = [...Array(n).keys()].sort((x, y) => model.stage[x] - model.stage[y] || x - y);
  const seed2 = new Array(n).fill(-1);
  for (const i of order) {
    const pred = model.edges.find(({ b, a }) => b === i && seed2[a] >= 0);
    const want = pred ? seed2[pred.a] : 0;
    const taken = new Set(order.filter((j) => j !== i && seed2[j] >= 0 && model.stage[j] === model.stage[i]).map((j) => seed2[j]));
    let row = want;
    for (let d = 0; d < ROWS && taken.has(row); d++) row = [want + d, want - d].find((r) => r >= 0 && r < ROWS && !taken.has(r)) ?? row;
    if (taken.has(row)) row = [...Array(ROWS).keys()].find((r) => !taken.has(r));
    seed2[i] = row;
  }
  seeds.push(seed2);
  const out = [];
  const seen = new Set();
  for (const seed of seeds) {
    for (const ws of [0, 1]) {
      const rows = localSearch(model, [...seed], ws);
      const key = rows.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rows, cost: cost(model, rows, 0) });
    }
  }
  out.sort((a, b) => a.cost - b.cost);
  // Neighbours of the best, for the probe.
  const best = out[0].rows;
  const extra = [];
  for (let i = 0; i < n; i++) {
    for (let r = 0; r < ROWS; r++) {
      if (r === best[i]) continue;
      const next = [...best];
      const j = next.findIndex((x, k) => k !== i && model.stage[k] === model.stage[i] && x === r);
      next[i] = r;
      if (j >= 0) next[j] = best[i];
      const key = next.join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      extra.push({ rows: next, cost: cost(model, next, 0) });
    }
  }
  extra.sort((a, b) => a.cost - b.cost);
  return [...out, ...extra.slice(0, 6)].sort((a, b) => a.cost - b.cost).map((x) => x.rows);
}

function localSearch(model, rows, ws) {
  let current = cost(model, rows, ws);
  for (let pass = 0; pass < 40; pass++) {
    let improved = false;
    for (let i = 0; i < rows.length; i++) {
      for (let r = 0; r < ROWS; r++) {
        if (r === rows[i]) continue;
        const j = rows.findIndex((x, k) => k !== i && model.stage[k] === model.stage[i] && x === r);
        const old = rows[i];
        rows[i] = r;
        if (j >= 0) rows[j] = old;
        const v = cost(model, rows, ws);
        if (v < current - 1e-9) { current = v; improved = true; }
        else { rows[i] = old; if (j >= 0) rows[j] = r; }
      }
    }
    if (!improved) break;
  }
  return rows;
}

// Grid units: one stage = 1, one row = 114/215 (renderer row pitch over stage pitch).
const ROW_UNIT = 114 / 215;

function cost(model, rows, ws) {
  const W = ws === 0 ? { cross: 12, through: 30, dy: 1, main: 3, back: 2 } : { cross: 18, through: 30, dy: 0.6, main: 2, back: 1 };
  const pt = (i) => [model.stage[i], rows[i] * ROW_UNIT];
  const at = new Map(rows.map((r, i) => [`${model.stage[i]}:${r}`, i]));
  let total = 0;
  const segs = model.edges.map(({ a, b }) => [pt(a), pt(b)]);
  for (const { a, b, f } of model.edges) {
    const s1 = model.stage[a];
    const s2 = model.stage[b];
    const dr = Math.abs(rows[b] - rows[a]);
    total += (f.variant === 'emphasis' ? W.main : 1) * W.dy * dr;
    if (s2 <= s1) total += W.back;
    // Cells the automatic route sweeps (renderers/dataflow): along the source row through the stages in
    // between, then vertically down the stage before the target; same-stage flows run down their column.
    for (const cell of routeCells(s1, rows[a], s2, rows[b])) {
      const i = at.get(cell);
      if (i !== undefined && i !== a && i !== b) total += W.through;
    }
  }
  for (let x = 0; x < segs.length; x++) {
    for (let y = x + 1; y < segs.length; y++) {
      const ex = model.edges[x];
      const ey = model.edges[y];
      if ([ex.a, ex.b].some((v) => v === ey.a || v === ey.b)) continue;
      if (properCross(segs[x][0], segs[x][1], segs[y][0], segs[y][1])) total += W.cross;
    }
  }
  // Prefer compact use of rows.
  total += 0.2 * Math.max(...rows);
  return total;
}

function routeCells(s1, r1, s2, r2) {
  const cells = [];
  const lo = Math.min(r1, r2);
  const hi = Math.max(r1, r2);
  if (s1 === s2) {
    for (let r = lo + 1; r < hi; r++) cells.push(`${s1}:${r}`);
    return cells;
  }
  const dir = Math.sign(s2 - s1);
  for (let s = s1 + dir; s !== s2; s += dir) cells.push(`${s}:${r1}`);
  if (Math.abs(s2 - s1) >= 2) for (let r = lo; r <= hi; r++) cells.push(`${s2 - dir}:${r}`);
  return cells;
}

function properCross(p1, p2, p3, p4) {
  const o = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return o(p1, p2, p3) * o(p1, p2, p4) < 0 && o(p3, p4, p1) * o(p3, p4, p2) < 0;
}

// ---------------------------------------------------------------- candidate

function build(spec, ctx, model, rows, state) {
  // Spacious relax: use alternating rows when a stage has room (more clearance for routes and labels).
  const span = Math.max(...rows) + 1;
  const spread = state.spacious && span <= 3 ? 2 : 1;
  const nodes = model.nodes.map((n, i) => {
    const out = {
      id: n.id,
      type: n.kind ?? n.type,
      label: n.label,
      ...(n.sublabel ? { sublabel: n.sublabel } : {}),
      ...(n.tag ? { tag: n.tag } : {}),
      ...(n.icon ? { icon: n.icon } : {}),
      ...(n.sources?.length ? { sources: n.sources } : {}),
      stage: model.stage[i],
      row: rows[i] * spread,
    };
    if (model.explicitWidths) {
      const need = Math.max(units(n.label) * 6.2 - 2, ...[n.sublabel, n.tag].filter(Boolean).map((t) => units(t) * 7 * 0.6 + 12));
      out.width = Math.min(STAGE_W, Math.max(NODE_W, Math.ceil(need / 2) * 2));
    }
    return out;
  });
  const flows = model.edges.map(({ f }, k) => ({
    id: f.id ?? `f${k + 1}-${f.from}-${f.to}`.slice(0, 60),
    from: f.from,
    to: f.to,
    label: f.label,
    ...(f.variant && f.variant !== 'default' ? { variant: f.variant } : {}),
  }));
  const cards = (spec.cards ?? []).map((card) => ({ dot: card.dot ?? 'slate', title: card.title, items: card.items }));
  const detailed = model.nodes.filter((n) => n.detail);
  if (detailed.length) {
    cards.push({
      dot: spec.detailsCard?.dot ?? 'slate',
      title: spec.detailsCard?.title ?? DETAILS_TITLE[ctx.lang] ?? DETAILS_TITLE.en,
      items: detailed.map((n) => `${n.label}: ${n.detail}`),
    });
  }
  return {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: {
      title: spec.title,
      ...(spec.subtitle ? { subtitle: spec.subtitle } : {}),
      quality_profile: ctx.quality ?? 'showcase',
      ...(ctx.repository ? { repository: ctx.repository } : {}),
      ...(spec.views?.length ? { views: spec.views } : {}),
    },
    stages: model.stages.map((s) => ({ label: s.label })),
    nodes,
    flows,
    ...(cards.length ? { cards } : {}),
  };
}

// ---------------------------------------------------------------- Archify probe

function probe(candidate) {
  const doc = structuredClone(candidate);
  delete doc.meta.repository;
  doc.meta.output = 'probe.html';
  for (const n of doc.nodes) delete n.sources;
  const dir = mkdtempSync(join(tmpdir(), 'dataflow-probe-'));
  try {
    const file = join(dir, 'candidate.json');
    writeFileSync(file, JSON.stringify(doc));
    const run = spawnSync('node', [join(ARCHIFY, 'bin', 'archify.mjs'), 'validate', 'dataflow', file, '--json', '--quality', candidate.meta.quality_profile ?? 'showcase'],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let out = null;
    try { out = JSON.parse(run.stdout); } catch { /* unparsed */ }
    if (!out) return { ok: false, issues: 99, codes: ['probe/unparsed'] };
    const failing = (out.checks ?? []).filter((c) => !c.ok);
    const issues = failing.reduce((n, c) => n + Math.max(1, (c.details ?? []).length), 0) + (out.diagnostics ?? []).filter((d) => d.severity !== 'warning').length;
    return { ok: run.status === 0 && out.ok !== false, issues, codes: [...failing.map((c) => c.name), ...(out.diagnostics ?? []).map((d) => d.code)], error: out.ok === false ? String(out.error ?? '').slice(0, 300) : undefined };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
