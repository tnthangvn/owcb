// Lifecycle compiler: semantic spec -> Archify lifecycle candidate (schema v3). Spec format: references/specs/lifecycle.md
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const type = 'lifecycle';

const ARCHIFY_CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'archify', 'bin', 'archify.mjs');
const MAX_ORDERS = 12; // validate runs per build when the first order is too wide (~0.4s each)

// Spec kind -> Archify state type. Archify's own type names pass through.
const KINDS = {
  initial: 'start', normal: 'active', waiting: 'waiting', terminal: 'neutral', error: 'failure',
  start: 'start', active: 'active', decision: 'decision', success: 'success', failure: 'failure', neutral: 'neutral', external: 'external',
};
const TONES = { main: 'emphasis', emphasis: 'emphasis', security: 'security', auto: 'dashed', dashed: 'dashed' };
const DOTS = ['cyan', 'amber', 'violet', 'rose', 'emerald', 'orange', 'slate'];

const LIMITS = [ // widened-to-strict budgets tried in order: [main-row note, other note, state detail, label, longest auto main path]
  { mainNote: 24, note: 40, detail: 28, label: 22, maxMain: 5 },
  { mainNote: 0, note: 30, detail: 24, label: 20, maxMain: 5 },
  { mainNote: 0, note: 0, detail: 20, label: 18, maxMain: 4 },
  { mainNote: 0, note: 0, detail: 0, label: 16, maxMain: 4 },
];
const TITLES = {
  vi: { details: 'Chi tiết trạng thái', notes: 'Ghi chú chuyển trạng thái', labels: 'Tên chuyển trạng thái đầy đủ' },
  en: { details: 'State details', notes: 'Transition notes', labels: 'Full transition names' },
};

const levels = new WeakMap();

export function compile(spec, ctx) {
  levels.set(spec, 0);
  warnDisjoint(spec);
  return arrange(build(spec, ctx, 0), ctx);
}

export function relax(candidate, diagnostics, attempt, spec, ctx) {
  const lvl = (levels.get(spec) ?? 0) + 1;
  if (lvl >= LIMITS.length) return null;
  levels.set(spec, lvl);
  return arrange(build(spec, ctx, lvl), ctx);
}

// Archify lays out lower rows in states[] order, so the order alone can decide `lifecycle/too-wide`.
// Probe a few meaning-preserving orders and keep the first that is not too wide, else the narrowest.
function arrange(candidate, ctx) {
  const first = probe(candidate, ctx);
  if (!first || !tooWide(first)) return candidate;
  let best = { candidate, width: widthOf(first) };
  for (const states of orders(candidate)) {
    const next = { ...candidate, states };
    const diagnostics = probe(next, ctx);
    if (!diagnostics || !tooWide(diagnostics)) return next;
    const width = widthOf(diagnostics);
    if (width < best.width) best = { candidate: next, width };
  }
  return best.candidate;
}

// Main path first, then states reached from it in breadth-first order (neighbours stay adjacent),
// then each machine that never meets the main path in chain order, then states without transitions.
function orders(candidate) {
  const byId = new Map(candidate.states.map((s) => [s.id, s]));
  const links = new Map(candidate.states.map((s) => [s.id, []]));
  for (const tr of candidate.transitions) {
    if (tr.from === tr.to) continue;
    links.get(tr.from).push(tr.to);
    links.get(tr.to).push(tr.from);
  }
  const main = candidate.mainPath;
  const seen = new Set(main);
  const walk = (start, breadth) => {
    const out = [], queue = [...start];
    while (queue.length) {
      const id = breadth ? queue.shift() : queue.pop();
      for (const next of links.get(id)) if (!seen.has(next)) { seen.add(next); out.push(next); queue.push(next); }
    }
    return out;
  };
  const attached = walk(main, true);
  const machines = [], isolated = [];
  for (const s of candidate.states) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (!links.get(s.id).length) isolated.push(s.id);
    else machines.push([s.id, ...walk([s.id], false)]);
  }
  const bySize = [...machines].sort((a, b) => b.length - a.length);
  const variants = [
    [main, attached, ...machines, isolated],
    [main, attached, isolated, ...machines],
    [main, attached, ...[...machines].reverse(), isolated],
    [main, [...attached].reverse(), ...machines.map((m) => [...m].reverse()), isolated],
    [main, attached, ...bySize, isolated],
    [main, isolated, ...bySize.reverse(), attached],
  ].map((parts) => parts.flat());
  const rest = [...attached, ...machines.flat(), ...isolated];
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  while (variants.length < MAX_ORDERS && rest.length > 1) {
    const shuffled = [...rest];
    for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
    variants.push([...main, ...shuffled]);
  }
  const unique = new Map(variants.map((ids) => [ids.join('|'), ids]));
  unique.delete(candidate.states.map((s) => s.id).join('|'));
  return [...unique.values()].slice(0, MAX_ORDERS).map((ids) => ids.map((id) => byId.get(id)));
}

// Machines that never meet the main path all land in the first lower row, side by side.
function warnDisjoint(spec) {
  const links = new Map((spec.states ?? []).map((s) => [s.id, new Set()]));
  for (const tr of spec.transitions ?? []) { links.get(tr.from)?.add(tr.to); links.get(tr.to)?.add(tr.from); }
  const seen = new Set();
  let parts = 0;
  for (const s of spec.states ?? []) {
    if (seen.has(s.id) || !links.get(s.id).size) continue;
    parts++;
    for (const stack = [s.id]; stack.length;) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...links.get(id));
    }
  }
  if (parts > 1) console.warn(`  warn lifecycle: ${parts} separate state machines on one page; Archify places every machine off the main path in the first lower row, so the page grows wide — prefer one lifecycle page per machine (references/specs/lifecycle.md)`);
}

const tooWide = (diagnostics) => diagnostics.some((d) => d.code === 'lifecycle/too-wide');
const widthOf = (diagnostics) => Number(diagnostics.find((d) => d.code === 'lifecycle/too-wide')?.message?.match(/(\d+)px wide/)?.[1] ?? Infinity);

// Returns error diagnostics, or null when layout validation passes or cannot run.
function probe(candidate, ctx = {}) {
  const cli = ctx.archify ? join(ctx.archify, 'bin', 'archify.mjs') : ARCHIFY_CLI;
  if (!existsSync(cli)) return null;
  const dir = mkdtempSync(join(tmpdir(), 'cw-lifecycle-'));
  try {
    // Source badges widen states, so keep them when the repository is known.
    const doc = structuredClone(candidate);
    doc.meta = { ...doc.meta, output: 'probe.html' };
    if (ctx.repository) doc.meta.repository = ctx.repository;
    const keep = ctx.repoRoot && doc.meta.repository;
    if (!keep) { delete doc.meta.repository; for (const s of doc.states) delete s.sources; }
    writeFileSync(join(dir, 'probe.json'), JSON.stringify(doc));
    const run = spawnSync('node', [cli, 'validate', 'lifecycle', 'probe.json', '--quality', ctx.quality ?? 'showcase', '--json', ...(keep ? ['--repo-root', ctx.repoRoot] : [])],
      { cwd: dir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let receipt = null;
    try { receipt = JSON.parse(run.stdout); } catch { return null; }
    if (receipt.ok) return null;
    const errs = (receipt.diagnostics ?? []).filter((d) => (d.severity ?? 'error') === 'error');
    return errs.length ? errs : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function build(spec, ctx, level) {
  const lim = LIMITS[level];
  const t = TITLES[ctx?.lang] ?? TITLES.en;
  if (!spec.title) throw new Error('title is required');
  const states = spec.states ?? [];
  if (states.length < 2) throw new Error('need at least 2 states');
  const byId = new Map();
  states.forEach((s, i) => {
    const where = `states[${i}]`;
    if (!s.id || !s.label) throw new Error(`${where}: id and label are required`);
    if (byId.has(s.id)) throw new Error(`${where}: duplicate id "${s.id}"`);
    if (!KINDS[s.kind ?? 'normal']) throw new Error(`${where} (${s.id}): kind must be one of ${Object.keys(KINDS).join(', ')}`);
    if (s.sources && (s.sources.length < 1 || s.sources.length > 3)) throw new Error(`${where} (${s.id}): sources must have 1-3 entries`);
    byId.set(s.id, s);
  });
  const transitions = spec.transitions ?? [];
  transitions.forEach((tr, i) => {
    if (!byId.has(tr.from)) throw new Error(`transitions[${i}]: unknown state "${tr.from}"`);
    if (!byId.has(tr.to)) throw new Error(`transitions[${i}]: unknown state "${tr.to}"`);
    if (tr.tone && !TONES[tr.tone]) throw new Error(`transitions[${i}]: tone must be one of ${Object.keys(TONES).join(', ')}`);
  });

  const main = mainPath(spec, states, transitions, byId, lim.maxMain);
  const mainPairs = new Set(main.slice(1).map((id, i) => `${main[i]}>${id}`));
  const overflow = { details: [], notes: [], labels: [] };

  const outStates = states.map((s) => {
    const o = { id: s.id, type: KINDS[s.kind ?? 'normal'], label: s.label };
    if (s.detail) {
      if (units(s.detail) <= lim.detail) o.sublabel = s.detail;
      else overflow.details.push(`${s.label}: ${s.detail}`);
    }
    if (s.tag) o.tag = s.tag;
    const step = main.indexOf(s.id);
    if (step >= 0) o.step = String(step + 1).padStart(2, '0');
    if (s.sources) o.sources = s.sources;
    return o;
  });

  const seen = new Set();
  const outTransitions = transitions.map((tr, i) => {
    let id = tr.id ?? `${tr.from}-${tr.to}`;
    while (seen.has(id)) id += `-${i}`;
    seen.add(id);
    const o = { id, from: tr.from, to: tr.to };
    const from = byId.get(tr.from).label, to = byId.get(tr.to).label;
    if (tr.label) {
      if (units(tr.label) <= lim.label) o.label = tr.label;
      else {
        const cut = shorten(tr.label, lim.label);
        o.label = cut;
        overflow.labels.push(`${from} → ${to}: ${tr.label}`);
      }
    }
    if (tr.note) {
      const budget = mainPairs.has(`${tr.from}>${tr.to}`) ? lim.mainNote : lim.note;
      if (units(tr.note) <= budget) o.note = tr.note;
      else overflow.notes.push(`${tr.label ? `${tr.label} (${from} → ${to})` : `${from} → ${to}`}: ${tr.note}`);
    }
    if (tr.tone) { const v = TONES[tr.tone]; o.variant = v; }
    return o;
  });

  const meta = { title: spec.title };
  if (spec.subtitle) meta.subtitle = spec.subtitle;
  const cards = (spec.cards ?? []).map((c, i) => ({ dot: c.dot ?? DOTS[i % DOTS.length], title: c.title, items: c.items }));
  for (const [key, title] of [['details', t.details], ['notes', t.notes], ['labels', t.labels]]) {
    if (overflow[key].length) cards.push({ dot: 'slate', title, items: overflow[key] });
  }
  const out = { schema_version: 3, diagram_type: 'lifecycle', meta, mainPath: main, states: outStates, transitions: outTransitions };
  if (cards.length) out.cards = cards;
  return out;
}

// Happy path: spec.main, else the longest simple path from the initial state (at most maxMain states) that avoids error states and stops at the first ending.
function mainPath(spec, states, transitions, byId, maxMain) {
  const adj = new Map(states.map((s) => [s.id, []]));
  transitions.forEach((tr) => adj.get(tr.from).push(tr.to));
  const has = (a, b) => adj.get(a).includes(b);
  if (spec.main) {
    if (spec.main.length < 2) throw new Error('main needs at least 2 states');
    spec.main.forEach((id, i) => {
      if (!byId.has(id)) throw new Error(`main: unknown state "${id}"`);
      if (i > 0 && !has(spec.main[i - 1], id)) throw new Error(`main: no transition ${spec.main[i - 1]} -> ${id}`);
    });
    if (new Set(spec.main).size !== spec.main.length) throw new Error('main: repeated state');
    return spec.main;
  }
  const initial = states.find((s) => s.kind === 'initial' || s.kind === 'start') ?? states[0];
  const bad = (id) => ['error', 'failure'].includes(byId.get(id).kind);
  let best = [initial.id];
  const walk = (path) => {
    if (path.length > best.length) best = [...path];
    if (path.length >= maxMain || (path.length > 1 && ['success', 'terminal', 'neutral', 'external'].includes(byId.get(path.at(-1)).kind))) return;
    for (const next of adj.get(path.at(-1))) {
      if (path.includes(next) || bad(next)) continue;
      path.push(next); walk(path); path.pop();
    }
  };
  walk([initial.id]);
  if (best.length < 2) throw new Error(`initial state "${initial.id}" has no outgoing transition to a non-error state; add "main" explicitly`);
  return best;
}

function shorten(label, max) {
  const chars = [...label];
  let w = 0, cut = chars.length;
  for (let i = 0; i < chars.length; i++) { w += units(chars[i]); if (w > max - 1) { cut = i; break; } }
  const head = chars.slice(0, cut).join('');
  const space = head.lastIndexOf(' ');
  return (space > head.length * 0.5 ? head.slice(0, space) : head).replace(/[ ,;:(]+$/, '') + '…';
}

function units(s) {
  let n = 0;
  for (const ch of String(s)) n += ch.codePointAt(0) >= 0x2e80 ? 2 : 1;
  return n;
}
