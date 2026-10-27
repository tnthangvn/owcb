// Workflow compiler: semantic spec (lanes, steps, edges, phases, cards) → Archify workflow v2 candidate.
// Layout is decided here: logical columns (0..5) by weighted longest-path layering, same-cell stacks,
// phase/group column spans, mainPath, text budgets. Spec format: ../../references/specs/workflow.md
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const type = 'workflow';

const ARCHIFY_CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'archify', 'bin', 'archify.mjs');
const ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const TYPES = new Set(['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external']);
// Semantic kinds → [Archify componentType, default icon]. Raw componentTypes are accepted too.
const KINDS = {
  step: ['frontend'], screen: ['frontend'], action: ['frontend'], start: ['frontend', 'start'],
  end: ['backend', 'success'], result: ['backend'], system: ['backend'],
  decision: ['security', 'decision'], approval: ['security', 'decision'], error: ['security', 'failure'],
  external: ['external'], store: ['database'], async: ['messagebus'], scheduled: ['messagebus', 'clock'],
};
const DOTS = ['cyan', 'emerald', 'amber', 'violet', 'rose', 'orange', 'slate'];
const DETAIL_TITLE = { vi: 'Chi tiết các bước', en: 'Step details' };
const MAX_COL = 5;
// Text budgets (characters). Level 0 keeps the author's text; each relax level moves more of it into the details card.
const TEXT_LADDER = [
  { label: 30, sub: 40, tag: 28 }, { label: 24, sub: 30, tag: 20 }, { label: 22, sub: 26, tag: 18 },
  { label: 20, sub: 22, tag: 14 }, { label: 16, sub: 18, tag: 12 },
];
const STACK_GAP = 92;
const MAX_EVALS = 30; // validate runs per solve (~0.4s each)
const MOVES_PER_ROUND = 8;
const ROUTE_PRESETS = ['bottom-channel', 'up-channel', 'drop'];
const TEXT_CODES = /sublabel-readability|viewport|overflow|text-size|readab|canvas/;
// Archify could not honour a route constraint we added. Such a probe aborts early (1 diagnostic), so it must not
// look better than a complete layout with real crossings.
const CONFLICT = /route-preset-conflict|explicit-pin-conflict|solver-budget/;
const CONFLICT_PENALTY = 100;
const BANS = new WeakMap(); // spec → Set("from>to|preset") Archify rejected; kept across relax rounds

const STATE = new WeakMap(); // spec → last layout options (relax continues from there)

export function compile(spec, ctx = {}) {
  const model = validate(spec);
  const opts = defaultOptions();
  // Several independent flows whose phases cannot all fit in columns 0..5 side by side: run them in parallel
  // (each from column 0, its own row band per lane) instead of piling the later flows into the last column.
  if (new Set(model.flowOf.values()).size > 1 && layout(model, opts).overflow) opts.parallel = true;
  return solve(model, spec, ctx, opts);
}

export function relax(candidate, diagnostics, attempt, spec, ctx = {}) {
  const codes = (diagnostics ?? []).map((d) => d.code ?? '');
  // Not a layout problem: evidence/schema errors need the spec fixed; a delivery lock race only needs a retry.
  if (codes.some((c) => /^(repository-evidence|schema|input)\b|\/input-contract|semantic-node|unknown-/.test(c))) return null;
  if (codes.length && codes.every((c) => c.startsWith('delivery/'))) return candidate;
  const model = validate(spec);
  return solve(model, spec, ctx, structuredClone(STATE.get(spec) ?? defaultOptions()), { candidate, diagnostics });
}

function defaultOptions() {
  return { text: 0, nodeText: {}, spread: [], bump: {}, routes: {}, stackGap: STACK_GAP, parallel: false, shift: {} };
}

// ---------- spec validation ----------

function validate(spec) {
  const err = (m) => { throw new Error(`workflow spec: ${m}`); };
  if (!spec || typeof spec !== 'object') err('not an object');
  if (!spec.title?.trim()) err('title is required');
  if (!Array.isArray(spec.lanes) || !spec.lanes.length) err('lanes[] is required');
  if (!Array.isArray(spec.steps) || !spec.steps.length) err('steps[] is required');
  const lanes = new Map();
  for (const l of spec.lanes) {
    if (!ID.test(l.id ?? '')) err(`lane id "${l.id}" must match ${ID}`);
    if (lanes.has(l.id)) err(`duplicate lane "${l.id}"`);
    if (!l.label?.trim()) err(`lane "${l.id}" needs a label`);
    lanes.set(l.id, lanes.size);
  }
  const steps = new Map();
  for (const s of spec.steps) {
    if (!ID.test(s.id ?? '')) err(`step id "${s.id}" must match ${ID}`);
    if (steps.has(s.id)) err(`duplicate step "${s.id}"`);
    if (!lanes.has(s.lane)) err(`step "${s.id}" uses unknown lane "${s.lane}"`);
    if (!s.label?.trim()) err(`step "${s.id}" needs a label`);
    if (s.kind && !KINDS[s.kind] && !TYPES.has(s.kind)) err(`step "${s.id}" kind "${s.kind}" unknown (use ${Object.keys(KINDS).join('/')} or an Archify type)`);
    if (s.sources !== undefined) {
      if (!Array.isArray(s.sources) || s.sources.length > 3) err(`step "${s.id}" sources must be an array of at most 3`);
      for (const r of s.sources) if (!r?.path) err(`step "${s.id}" has a source without path`);
    }
    steps.set(s.id, { ...s, index: steps.size });
  }
  const edges = (spec.edges ?? []).map((e, index) => {
    if (!steps.has(e.from) || !steps.has(e.to)) err(`edge ${index} ${e.from} -> ${e.to} references an unknown step`);
    if (e.from === e.to) err(`edge ${index} is a self-loop on "${e.from}"`);
    return { ...e, index };
  });
  const mainPath = spec.mainPath ?? null;
  if (mainPath) {
    if (new Set(mainPath).size !== mainPath.length) err('mainPath repeats a step');
    for (let i = 0; i < mainPath.length - 1; i++) {
      if (!edges.some((e) => e.from === mainPath[i] && e.to === mainPath[i + 1])) err(`mainPath ${mainPath[i]} -> ${mainPath[i + 1]} has no edge`);
    }
  }
  const phaseOf = new Map();
  (spec.phases ?? []).forEach((p, i) => {
    if (!ID.test(p.id ?? '') || !p.label?.trim()) err(`phase ${i} needs id and label`);
    for (const id of p.steps ?? []) {
      if (!steps.has(id)) err(`phase "${p.id}" lists unknown step "${id}"`);
      if (phaseOf.has(id)) err(`step "${id}" is in two phases`);
      phaseOf.set(id, i);
    }
  });
  for (const g of spec.groups ?? []) {
    if (!ID.test(g.id ?? '') || !g.label?.trim() || !g.steps?.length) err(`group "${g.id}" needs id, label and steps`);
    const gl = new Set(g.steps.map((id) => steps.get(id)?.lane ?? err(`group "${g.id}" lists unknown step "${id}"`)));
    if (gl.size !== 1) err(`group "${g.id}" spans several lanes; a group lives in one lane`);
  }
  for (const c of spec.cards ?? []) if (!c.title?.trim() || !Array.isArray(c.items)) err('each card needs title and items[]');
  // Independent flows: weakly connected components of the step graph, numbered in spec order.
  const flowOf = new Map();
  for (const id of steps.keys()) {
    if (flowOf.has(id)) continue;
    const n = new Set(flowOf.values()).size;
    const stack = [id];
    while (stack.length) {
      const x = stack.pop();
      if (flowOf.has(x)) continue;
      flowOf.set(x, n);
      for (const e of edges) if (e.from === x || e.to === x) stack.push(e.from === x ? e.to : e.from);
    }
  }
  return { lanes, steps, edges, mainPath, phaseOf, flowOf };
}

// ---------- layout ----------

function layout(model, opts) {
  const { lanes, steps, edges, phaseOf, flowOf } = model;
  // Parallel mode: independent flows each start at column 0 and get their own row band in every lane.
  const flow = (id) => (opts.parallel ? flowOf.get(id) : 0);
  const phaseFlow = new Map();
  for (const [id, ph] of phaseOf) if (!phaseFlow.has(ph)) phaseFlow.set(ph, flowOf.get(id));
  const ids = [...steps.keys()];
  const mainIdx = new Map((model.mainPath ?? []).map((id, i) => [id, i]));
  const prio = (id) => [phaseOf.get(id) ?? -1, mainIdx.get(id) ?? 1e6, steps.get(id).index];
  const cmp = (a, b) => { const x = prio(a), y = prio(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2]; };

  // Back edges via DFS (mainPath first, then roots, then the rest); mainPath successors are followed first.
  const out = new Map(ids.map((id) => [id, []]));
  for (const e of edges) out.get(e.from).push(e);
  const isMainEdge = (e) => mainIdx.has(e.from) && mainIdx.get(e.to) === mainIdx.get(e.from) + 1;
  for (const list of out.values()) list.sort((a, b) => (isMainEdge(b) - isMainEdge(a)) || cmp(a.to, b.to));
  const hasIn = new Set(edges.map((e) => e.to));
  const starts = [...(model.mainPath ?? []).slice(0, 1), ...ids.filter((id) => !hasIn.has(id)).sort(cmp), ...[...ids].sort(cmp)];
  const back = new Set();
  const seen = new Map(); // 1 = on stack, 2 = done
  const dfs = (id) => {
    seen.set(id, 1);
    for (const e of out.get(id)) {
      const s = seen.get(e.to);
      if (s === 1) back.add(e.index);
      else if (!s) dfs(e.to);
    }
    seen.set(id, 2);
  };
  for (const id of starts) if (!seen.has(id)) dfs(id);
  const fwd = edges.filter((e) => !back.has(e.index));

  // Kahn topological order with phase / mainPath / spec-order priority.
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of fwd) indeg.set(e.to, indeg.get(e.to) + 1);
  const ready = ids.filter((id) => !indeg.get(id));
  const order = [];
  while (ready.length) {
    ready.sort(cmp);
    const id = ready.shift();
    order.push(id);
    for (const e of fwd) if (e.from === id) { indeg.set(e.to, indeg.get(e.to) - 1); if (!indeg.get(e.to)) ready.push(e.to); }
  }

  const laneOf = (id) => lanes.get(steps.get(id).lane);
  const col = new Map();
  const cell = new Map(); // "lane:col:flow" → [ids]
  const occupied = new Set(); // "lane:col" holding a step of any flow
  const corridor = new Set(); // "lane:col" crossed by a vertical edge (all row bands of the lane)
  const key = (lane, c) => `${lane}:${c}`;
  const place = (id, lane, c) => {
    const k = `${key(lane, c)}:${flow(id)}`;
    if (!cell.has(k)) cell.set(k, []);
    cell.get(k).push(id);
    occupied.add(key(lane, c));
  };
  const unplace = (id, lane, c) => {
    const k = `${key(lane, c)}:${flow(id)}`;
    const list = cell.get(k);
    list.splice(list.indexOf(id), 1);
    if (!list.length) cell.delete(k);
    if (![...cell.keys()].some((x) => x.startsWith(`${key(lane, c)}:`))) occupied.delete(key(lane, c));
  };
  const taken = (id, lane, c) => cell.has(`${key(lane, c)}:${flow(id)}`);
  const spread = new Set(opts.spread);
  const between = (a, b) => { const lo = Math.min(a, b), hi = Math.max(a, b); return Array.from({ length: Math.max(0, hi - lo - 1) }, (_, i) => lo + 1 + i); };
  const weight = (e) => {
    // Parallel flows share every lane's height, so a same-column drop would cut through the other flows' rows:
    // step one column right and let the vertical part run in the gutter between columns.
    if (opts.parallel || laneOf(e.from) === laneOf(e.to) || spread.has(edgeKey(e))) return 1;
    const c = col.get(e.from);
    return between(laneOf(e.from), laneOf(e.to)).some((l) => occupied.has(key(l, c))) ? 1 : 0;
  };
  const phaseMax = new Map();
  let overflow = false;
  for (const id of order) {
    let min = Math.max(opts.bump[id] ?? 0, opts.parallel ? opts.shift[flowOf.get(id)] ?? 0 : 0);
    const ph = phaseOf.get(id);
    if (ph !== undefined) for (const [p, m] of phaseMax) if (p < ph && phaseFlow.get(p) === flowOf.get(id) || p < ph && !opts.parallel) min = Math.max(min, m + 1);
    if (min > MAX_COL) overflow = true;
    for (const e of fwd) if (e.to === id) min = Math.max(min, col.get(e.from) + weight(e));
    min = Math.min(min, MAX_COL);
    const lane = laneOf(id);
    // A free cell at most one column right of the minimum; otherwise stack in the first cell no vertical edge crosses.
    const open = (c) => !corridor.has(key(lane, c));
    let c = [min, min + 1].find((x) => x <= MAX_COL && open(x) && !taken(id, lane, x));
    if (c === undefined) c = Array.from({ length: MAX_COL - min + 1 }, (_, i) => min + i).find(open) ?? min;
    col.set(id, c);
    place(id, lane, c);
    if (ph !== undefined) phaseMax.set(ph, Math.max(phaseMax.get(ph) ?? 0, c));
    for (const e of fwd) if (e.to === id && col.get(e.from) === c) for (const l of between(laneOf(e.from), lane)) corridor.add(key(l, c));
  }

  // Pull side roots (no forward predecessor, not on mainPath, no phase) next to their first successor.
  for (const id of [...order].reverse()) {
    if (mainIdx.has(id) || phaseOf.has(id) || opts.bump[id] !== undefined || fwd.some((e) => e.to === id)) continue;
    const succ = fwd.filter((e) => e.from === id);
    if (!succ.length) continue;
    const lane = laneOf(id);
    const limit = Math.min(...succ.map((e) => col.get(e.to) - (laneOf(e.to) === lane ? 1 : 0)));
    const cur = col.get(id);
    for (let c = limit; c > cur; c--) {
      if (taken(id, lane, c) || corridor.has(key(lane, c))) continue;
      unplace(id, lane, cur);
      place(id, lane, c);
      col.set(id, c);
      break;
    }
  }

  return { col, yOffset: rows(model, opts, { col, fwd, cmp, flow, laneOf }), back, fwd, overflow };
}

// Row bands inside each lane. Steps joined by same-lane edges form a chain that keeps one row (so a flow runs
// straight instead of bending around another flow's stack); chains whose column spans overlap take different rows,
// and each flow (parallel mode) gets its own band of rows. Lanes with a single row keep yOffset 0 (omitted).
function rows(model, opts, { col, fwd, cmp, flow, laneOf }) {
  const yOffset = new Map();
  const byLane = new Map();
  for (const id of model.steps.keys()) {
    const l = laneOf(id);
    if (!byLane.has(l)) byLane.set(l, []);
    byLane.get(l).push(id);
  }
  for (const ids of byLane.values()) {
    ids.sort((a, b) => flow(a) - flow(b) || col.get(a) - col.get(b) || cmp(a, b));
    const chains = [];
    const chainOf = new Map();
    for (const id of ids) {
      const prev = fwd.filter((e) => e.to === id && laneOf(e.from) === laneOf(id) && col.get(e.from) < col.get(id))
        .map((e) => chainOf.get(e.from)).find((ch) => ch && ch.last === ch.ids.at(-1) && fwd.some((e) => e.from === ch.last && e.to === id));
      const ch = prev ?? { ids: [], flow: flow(id) };
      if (!prev) chains.push(ch);
      ch.ids.push(id);
      ch.last = id;
      chainOf.set(id, ch);
    }
    // Interval colouring per flow band; bands stack in flow order.
    let base = 0;
    const rowOf = new Map();
    for (const f of [...new Set(chains.map((ch) => ch.flow))]) {
      const ends = [];
      for (const ch of chains.filter((x) => x.flow === f)) {
        const start = col.get(ch.ids[0]);
        let r = ends.findIndex((end) => end < start);
        if (r < 0) r = ends.length;
        ends[r] = col.get(ch.last);
        rowOf.set(ch, base + r);
      }
      base += ends.length;
    }
    if (base < 2) continue;
    for (const id of ids) yOffset.set(id, Math.round((rowOf.get(chainOf.get(id)) - (base - 1) / 2) * opts.stackGap));
  }
  return yOffset;
}

const edgeKey = (e) => `${e.from}>${e.to}`;

// Longest forward path, preferring emphasis/main edges; used when the spec has no mainPath.
function deriveMainPath(model, lay) {
  const { steps } = model;
  const ids = [...steps.keys()].sort((a, b) => lay.col.get(a) - lay.col.get(b) || steps.get(a).index - steps.get(b).index);
  const best = new Map(ids.map((id) => [id, { score: 0, prev: null }]));
  const w = (e) => 1 + (e.variant === 'emphasis' || e.role === 'main' ? 0.5 : 0) - (e.role === 'error' || e.variant === 'dashed' ? 0.5 : 0);
  // Relax in topological order of the forward DAG (col order is not enough when cols tie).
  const topo = [];
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const e of lay.fwd) indeg.set(e.to, indeg.get(e.to) + 1);
  const q = ids.filter((id) => !indeg.get(id));
  while (q.length) {
    const id = q.shift();
    topo.push(id);
    for (const e of lay.fwd) if (e.from === id) { indeg.set(e.to, indeg.get(e.to) - 1); if (!indeg.get(e.to)) q.push(e.to); }
  }
  for (const id of topo) {
    for (const e of lay.fwd) {
      if (e.from !== id || lay.col.get(e.to) < lay.col.get(id)) continue;
      const s = best.get(id).score + w(e);
      if (s > best.get(e.to).score) best.set(e.to, { score: s, prev: id });
    }
  }
  let end = null;
  for (const id of topo) if (!end || best.get(id).score > best.get(end).score) end = id;
  const path = [];
  for (let id = end; id; id = best.get(id).prev) path.unshift(id);
  return path.length >= 2 ? path : null;
}

// ---------- text budgets ----------

function shorten(text, max) {
  if (!text || [...text].length <= max) return { text, cut: false };
  const head = [...text].slice(0, max).join('');
  for (const sep of [', ', '; ', ' – ', ' - ', ' — ', ' (', ': ']) {
    const at = head.lastIndexOf(sep);
    if (at >= max * 0.45) return { text: head.slice(0, at).trim(), cut: true };
  }
  const sp = head.lastIndexOf(' ');
  return { text: `${(sp >= max * 0.45 ? head.slice(0, sp) : head.slice(0, max - 1)).trim()}…`, cut: true };
}

// ---------- candidate assembly ----------

function build(model, spec, ctx, opts) {
  const lay = layout(model, opts);
  const { col, yOffset, back } = lay;
  const details = [];
  const nodes = spec.steps.map((s) => {
    const [kindType, kindIcon] = KINDS[s.kind ?? 'step'] ?? [s.kind];
    const budget = TEXT_LADDER[Math.max(opts.text, opts.nodeText[s.id] ?? 0)];
    const label = shorten(s.label, budget.label);
    const sub = shorten(s.sublabel, budget.sub);
    const tag = shorten(s.tag, budget.tag);
    const extra = [label.cut && s.label, sub.cut && s.sublabel, tag.cut && s.tag, s.detail].filter(Boolean);
    if (extra.length) details.push(`${label.cut ? label.text : s.label}: ${extra.join(' · ')}`);
    const n = { id: s.id, lane: s.lane, col: col.get(s.id), type: kindType, label: label.text };
    if (sub.text) n.sublabel = sub.text;
    if (tag.text) n.tag = tag.text;
    const icon = s.icon ?? kindIcon;
    if (icon) n.icon = icon;
    if (s.sources?.length) n.sources = s.sources.map(({ path, line, end_line, label: l }) => clean({ path, line, end_line, label: l }));
    if (yOffset.has(s.id)) n.yOffset = yOffset.get(s.id);
    return n;
  });
  const usedIds = new Set();
  const edges = model.edges.map((e) => {
    let id = e.id ?? `e-${e.from}-${e.to}`.replace(/[^a-zA-Z0-9_-]/g, '_');
    while (usedIds.has(id)) id += '_';
    usedIds.add(id);
    return clean({ id, from: e.from, to: e.to, label: e.label, variant: e.variant, role: e.role ?? (back.has(e.index) ? 'return' : undefined), route: opts.routes[edgeKey(e)] });
  });

  const candidate = { schema_version: 2, diagram_type: 'workflow', meta: { title: spec.title } };
  if (spec.subtitle) candidate.meta.subtitle = spec.subtitle;
  candidate.meta.quality_profile = ctx.quality ?? 'showcase';
  if (spec.legend?.length) {
    const entries = {};
    for (const { kind, label } of spec.legend) {
      const t = (KINDS[kind] ?? [kind])[0];
      if (!TYPES.has(t)) throw new Error(`workflow spec: legend kind "${kind}" unknown`);
      entries[t] = { label };
    }
    candidate.meta.legend = { entries };
  }
  candidate.lanes = spec.lanes.map((l) => clean({ id: l.id, label: l.label, variant: l.variant === 'exception' || l.kind === 'exception' ? 'exception' : undefined }));

  const phases = [];
  let prevTo = -1;
  if (opts.parallel && spec.phases?.length) {
    // Parallel flows share columns, so their phases cannot each own a band: one band names them in row order.
    const cols = spec.phases.flatMap((p) => (p.steps ?? []).map((id) => col.get(id)));
    if (cols.length) phases.push({ id: spec.phases[0].id, label: spec.phases.map((p) => p.label).join(' · '), fromCol: Math.min(...cols), toCol: Math.max(...cols) });
  }
  for (const p of opts.parallel ? [] : spec.phases ?? []) {
    const cols = (p.steps ?? []).map((id) => col.get(id));
    if (!cols.length) continue;
    const from = Math.max(Math.min(...cols), prevTo + 1);
    const to = Math.max(...cols);
    if (from > to || from > MAX_COL) {
      // No column left for this phase: keep its name on the previous band instead of overlapping.
      if (phases.length) phases.at(-1).label += ` · ${p.label}`;
      continue;
    }
    phases.push(clean({ id: p.id, label: p.label, fromCol: from, toCol: to, variant: p.variant }));
    prevTo = to;
  }
  if (phases.length) candidate.phases = phases;
  const groups = (spec.groups ?? []).map((g) => {
    const cols = g.steps.map((id) => col.get(id));
    return clean({ id: g.id, label: g.label, lane: model.steps.get(g.steps[0]).lane, fromCol: Math.min(...cols), toCol: Math.max(...cols), variant: g.variant });
  });
  if (groups.length) candidate.groups = groups;

  const mainPath = model.mainPath ?? deriveMainPath(model, lay);
  if (mainPath) candidate.mainPath = mainPath;
  candidate.nodes = nodes;
  candidate.edges = edges;
  const cards = (spec.cards ?? []).map((c, i) => ({ dot: c.dot ?? DOTS[i % DOTS.length], title: c.title, items: [...c.items] }));
  if (details.length) cards.push({ dot: 'slate', title: DETAIL_TITLE[ctx.lang] ?? DETAIL_TITLE.en, items: details });
  if (cards.length) candidate.cards = cards;
  return candidate;
}

function clean(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === null) delete o[k];
  return o;
}

// ---------- solve: small local search over layout options, scored by Archify `validate` (no evidence, no browser) ----------

function solve(model, spec, ctx, opts, failed = null) {
  if (!BANS.has(spec)) BANS.set(spec, new Set());
  const bans = BANS.get(spec);
  if (failed) learnBans(failed.diagnostics, failed.candidate, model, bans);
  const seen = new Set([signature(opts)]);
  const built = new Set(failed ? [layoutKey(failed.candidate)] : []);
  const evaluate = (o) => {
    const candidate = build(model, spec, ctx, o);
    const k = layoutKey(candidate);
    if (built.has(k)) return null; // same layout as one already tried (or the one finalize rejected)
    built.add(k);
    const diags = preValidate(candidate, ctx) ?? [];
    learnBans(diags, candidate, model, bans);
    if (process.env.CW_DEBUG) console.error(`  try ${signature(o)}: ${diags.length ? diags.map((d) => `${d.code}@${d.subject?.id ?? d.subject?.node ?? ''}`).join(' ') : 'ok'}`);
    return { opts: o, candidate, diags, score: score(diags) };
  };
  // relax(): start from the finalize failure, so the accepted variant always differs from the rejected one.
  const start = failed ? { opts, candidate: failed.candidate, diags: failed.diagnostics, score: Infinity } : evaluate(opts);
  const pool = [start];
  let best = failed ? null : start;
  let evals = failed ? 0 : 1;
  // Best-first: expand the lowest-scoring variant that still has untried moves (a dead end falls back to the next one).
  while ((!best || best.score > 0) && evals < MAX_EVALS) {
    pool.sort((a, b) => a.score - b.score);
    let options = [];
    for (const p of pool) {
      options = moves(p.opts, p.diags, model, p.candidate, bans).filter((o) => !seen.has(signature(o)));
      if (options.length) break;
    }
    if (!options.length) break;
    for (const o of options.slice(0, MOVES_PER_ROUND)) {
      seen.add(signature(o));
      const r = evaluate(o);
      if (!r) continue;
      evals++;
      pool.push(r);
      if (!best || r.score < best.score) best = r;
      if (!r.score || evals >= MAX_EVALS) break;
    }
  }
  if (!best) return null;
  STATE.set(spec, best.opts);
  return best.candidate;
}

function score(diags) {
  return diags.length + (diags.some((d) => CONFLICT.test(d.code ?? '')) ? CONFLICT_PENALTY : 0);
}

// Remember every (edge, preset) Archify refused, so no later variant or relax round proposes it again.
function learnBans(diags, candidate, model, bans) {
  for (const d of diags ?? []) {
    if (!CONFLICT.test(d.code ?? '')) continue;
    const e = diagnosticEdge(d.subject, model);
    if (!e) continue;
    const route = d.subject?.route ?? candidate?.edges?.find((x) => x.from === e.from && x.to === e.to)?.route;
    if (route) bans.add(`${edgeKey(e)}|${route}`);
  }
}

function layoutKey(c) {
  return JSON.stringify([c.nodes.map((n) => [n.col, n.yOffset, n.label, n.sublabel, n.tag]), c.edges.map((e) => e.route), c.phases, c.groups]);
}

function signature(o) {
  return JSON.stringify([o.text, Object.entries(o.nodeText).sort(), Object.entries(o.routes).sort(), o.stackGap, [...o.spread].sort(), Object.entries(o.bump).sort(), !!o.parallel, Object.entries(o.shift ?? {}).sort()]);
}

// Returns error diagnostics, or null when layout validation passes / is unavailable.
function preValidate(candidate, ctx = {}) {
  const cli = ctx.archify ? join(ctx.archify, 'bin', 'archify.mjs') : ARCHIFY_CLI;
  if (!existsSync(cli)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'cw-workflow-'));
  try {
    const probe = structuredClone(candidate);
    probe.meta.output = 'probe.html';
    delete probe.meta.repository;
    for (const n of probe.nodes) delete n.sources; // evidence is checked by finalize; layout does not depend on it
    writeFileSync(join(dir, 'probe.json'), JSON.stringify(probe));
    const run = spawnSync('node', [cli, 'validate', 'workflow', 'probe.json', '--quality', probe.meta.quality_profile, '--json'],
      { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let receipt = null;
    try { receipt = JSON.parse(run.stdout); } catch { return null; }
    if (receipt.ok) return null;
    const errs = (receipt.diagnostics ?? []).filter((d) => (d.severity ?? 'error') === 'error');
    return errs.length ? errs : [{ code: 'validate/failed', message: receipt.error ?? 'validate failed' }];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Layout-only variants suggested by diagnostics, most specific first. Never removes steps, edges, labels or sources.
function moves(opts, diagnostics, model, candidate, bans = new Set()) {
  const colOf = new Map((candidate?.nodes ?? []).map((n) => [n.id, n.col]));
  const laneOf = (id) => model.steps.get(id).lane;
  const out = [];
  const variant = (fn) => { const o = structuredClone(opts); if (fn(o) !== false) out.push(o); };
  // A preset only narrows Archify's automatic routes; it cannot bend an edge whose endpoints share a column
  // (a vertical drop), and `drop` needs two lanes. Those and every preset Archify already refused stay automatic.
  const presetFits = (e, preset) => !bans.has(`${edgeKey(e)}|${preset}`)
    && colOf.get(e.from) !== colOf.get(e.to)
    && (preset !== 'drop' || laneOf(e.from) !== laneOf(e.to));
  const setPreset = (e, preset) => variant((o) => { if (o.routes[edgeKey(e)] === preset || !presetFits(e, preset)) return false; o.routes[edgeKey(e)] = preset; });
  const dropPresets = (keys) => variant((o) => {
    const hit = keys.filter((k) => o.routes[k]);
    if (!hit.length) return false;
    for (const k of hit) delete o.routes[k];
  });
  const last = TEXT_LADDER.length - 1;
  const tighten = (o) => { if (o.text >= last) return false; o.text++; };
  const tightenNode = (id) => variant((o) => {
    const cur = Math.max(o.text, o.nodeText[id] ?? 0);
    if (cur >= last) return false;
    o.nodeText[id] = cur + 1;
  });
  const bump = (id) => variant((o) => { if ((o.bump[id] ?? 0) >= MAX_COL) return false; o.bump[id] = (o.bump[id] ?? 0) + 1; });
  for (const d of diagnostics ?? []) {
    const code = d.code ?? '';
    const wide = /(?:component|node) "([^"]+)"/.exec(d.message ?? '');
    if (code === 'layout/constraint' && wide && model.steps.has(wide[1]) && /wider|width/.test(d.message)) {
      tightenNode(wide[1]);
      variant(tighten);
      continue;
    }
    if (TEXT_CODES.test(code)) {
      // A node-specific readability failure shortens that node first; canvas-wide ones shorten every step.
      if (d.subject?.node && model.steps.has(d.subject.node) && !(d.evidence?.requiredFontPx > d.evidence?.maximumSlotFontPx)) tightenNode(d.subject.node);
      variant(tighten);
      continue;
    }
    if (CONFLICT.test(code)) {
      // Our presets are the only route constraints we add. Drop the diagnosed one, then its siblings (edges sharing
      // an endpoint), then all of them; a preset Archify verified for this edge is the last resort.
      const e = diagnosticEdge(d.subject, model);
      if (e) {
        dropPresets([edgeKey(e)]);
        dropPresets(model.edges.filter((x) => [x.from, x.to].some((id) => id === e.from || id === e.to)).map(edgeKey));
      }
      dropPresets(Object.keys(opts.routes));
      if (e) for (const fix of d.supportedFixes ?? []) {
        const m = /route to verified preset "([a-z-]+)"/.exec(fix);
        if (m && ROUTE_PRESETS.includes(m[1])) setPreset(e, m[1]);
      }
      if (Object.keys(opts.routes).length) continue;
      // No preset of ours is involved (solver budget on a plain layout): fall through to the placement moves.
    }
    if (/node-overlap/.test(code)) { variant((o) => { o.stackGap += 16; }); continue; }
    const related = [d.subject, d.evidence?.otherRelationship].map((s) => diagnosticEdge(s, model)).filter(Boolean);
    // Two parallel flows that cross: they turn into the shared lanes in the same column gutter. Start one of them
    // a column later so their vertical runs use different gutters.
    const flows = [...new Set(related.map((e) => model.flowOf.get(e.from)))];
    if (opts.parallel && flows.length > 1) for (const f of flows) variant((o) => { if ((o.shift[f] ?? 0) >= MAX_COL - 1) return false; o.shift[f] = (o.shift[f] ?? 0) + 1; });
    for (const e of related) {
      if (model.steps.get(e.from).lane !== model.steps.get(e.to).lane && colOf.get(e.from) === colOf.get(e.to)) {
        variant((o) => { if (o.spread.includes(edgeKey(e))) return false; o.spread.push(edgeKey(e)); });
      }
      // Long, backward or diagnosed edges may take a route preset (a family of automatic routes, not a pin).
      for (const preset of ROUTE_PRESETS) setPreset(e, preset);
      bump(e.to);
      bump(e.from);
    }
    const node = d.subject?.node;
    if (node && model.steps.has(node)) bump(node);
  }
  if (!out.length && diagnostics?.length) variant(tighten); // unknown failure: shorter text is always layout-only
  return out;
}

function diagnosticEdge(s, model) {
  if (!s) return null;
  if (s.collection && s.collection !== 'edges') return null;
  if (Number.isInteger(s.index) && model.edges[s.index]) return model.edges[s.index];
  const m = /\/edges\/(\d+)/.exec(s.path ?? '');
  if (m && model.edges[+m[1]]) return model.edges[+m[1]];
  if (s.from && s.to) return model.edges.find((e) => e.from === s.from && e.to === s.to) ?? null;
  return null;
}
