// Sequence compiler: semantic spec -> Archify sequence candidate (schema v1). Spec format: references/specs/sequence.md
export const type = 'sequence';

const KINDS = new Set(['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external']);
const MSG_KINDS = new Set(['call', 'return', 'async', 'self']);
const TONES = { main: 'emphasis', security: 'security' };
const DOTS = ['cyan', 'amber', 'rose', 'violet', 'emerald', 'orange', 'slate'];

const FIRST_Y = 160;
const BASE_GAP = 30; // basic spacing for a message without a note
const PHASE_GAP = 30; // extra air before the first message of a new phase (segment title sits above it)
const NOTE_LINE = 11;
const DEFAULT_LABEL_MAX = 44; // text units; the rest of a longer label moves into the note
const NOTE_UNIT = 3.9; // px per text unit at the 7px note size

// Per-spec layout state kept across relax attempts (compile-spec passes the same spec object each time).
const states = new WeakMap();

export function compile(spec, ctx) {
  const state = { extraGap: {}, labelMax: DEFAULT_LABEL_MAX, noteWidth: null };
  states.set(spec, state);
  return build(spec, state);
}

export function relax(candidate, diagnostics, attempt, spec) {
  const state = states.get(spec);
  if (!state) return null;
  const msgs = candidate.messages;
  let changed = false;
  // Rebuild gaps from the candidate so shifts accumulate on what the renderer actually measured.
  const ys = msgs.map((m) => m.y);
  let shift = 0; // y added to all later messages by earlier fixes in this pass
  const fixes = [];
  for (const d of diagnostics) {
    const code = d.code ?? '';
    const text = d.message ?? '';
    if (code === 'sequence/note-overlap') {
      const idx = Number(/\/messages\/(\d+)\/y/.exec(d.evidence?.blocker?.path ?? '')?.[1]);
      const required = d.evidence?.requiredY;
      if (Number.isInteger(idx) && required) fixes.push({ idx, add: required - ys[idx] });
    } else if (code === 'sequence/segment-label-overlap') {
      const si = Number(/\/segments\/(\d+)\//.exec(d.subject?.path ?? '')?.[1]);
      const first = firstMessageOfSegment(spec, state, si);
      if (first !== null) fixes.push({ idx: first, add: 24 });
    } else if (code === 'sequence/segment-message-border-run' || /less than 28px apart|share horizontal space/.test(text)) {
      const mi = d.evidence?.messageIndex;
      if (Number.isInteger(mi)) fixes.push({ idx: Math.min(mi + 1, msgs.length - 1), add: 14 });
    } else if (/Labels ".*" and ".*" overlap|label.*route|clearance/i.test(text) || code.includes('label')) {
      if (state.labelMax > 24) { state.labelMax -= 10; changed = true; }
      state.noteWidth = null;
    }
  }
  fixes.sort((a, b) => a.idx - b.idx);
  for (const f of fixes) {
    const idx = f.idx;
    const add = Math.max(0, f.add - shift);
    if (add > 0) {
      state.extraGap[idx] = (state.extraGap[idx] ?? 0) + add;
      shift += add;
      changed = true;
    }
  }
  return changed ? build(spec, state) : null;
}

// ---------------------------------------------------------------------------

function build(spec, state) {
  const { participants, messages, phases } = normalize(spec, state);
  const withY = place(messages, phases, state);
  const seg = segments(withY, phases);
  const act = activations(spec, withY, participants);
  const meta = { title: need(spec.title, 'title') };
  if (spec.subtitle) meta.subtitle = spec.subtitle;
  const out = {
    schema_version: 1,
    diagram_type: 'sequence',
    meta,
    participants: participants.map((p) => ({
      id: p.id, type: p.kind, label: p.label, ...(p.sublabel ? { sublabel: p.sublabel } : {}), ...(p.sources ? { sources: p.sources } : {}),
    })),
    ...(seg.length ? { segments: seg } : {}),
    messages: withY.map((m) => ({
      id: m.id, from: m.from, to: m.to, y: m.y, label: m.label, variant: m.variant, ...(m.note ? { note: m.note } : {}),
    })),
    ...(act.length ? { activations: act } : {}),
  };
  const cards = (spec.cards ?? []).map((c, i) => ({ dot: c.dot ?? DOTS[i % DOTS.length], title: c.title, items: c.items }));
  if (cards.length) out.cards = cards;
  return out;
}

function normalize(spec, state) {
  const participants = (spec.participants ?? []).map((p, i) => {
    const where = `participants[${i}]`;
    if (!p.id || !p.label) throw new Error(`${where}: id and label are required`);
    if (!KINDS.has(p.kind)) throw new Error(`${where} (${p.id}): kind must be one of ${[...KINDS].join(', ')}`);
    if (p.sources && (p.sources.length < 1 || p.sources.length > 3)) throw new Error(`${where} (${p.id}): sources must have 1-3 entries`);
    return p;
  });
  if (participants.length < 2) throw new Error('need at least 2 participants');
  const byId = new Map(participants.map((p) => [p.id, p]));
  if (byId.size !== participants.length) throw new Error('participant ids must be unique');

  const raw = spec.messages ?? [];
  if (!raw.length) throw new Error('need at least 1 message');
  const ids = new Set();
  raw.forEach((m, i) => {
    const where = `messages[${i}]`;
    if (!MSG_KINDS.has(m.kind ?? 'call')) throw new Error(`${where}: kind must be call|return|async|self`);
    if (!byId.has(m.from)) throw new Error(`${where}: unknown participant "${m.from}"`);
    const kind = m.kind ?? 'call';
    if (kind !== 'self' && !byId.has(m.to)) throw new Error(`${where}: unknown participant "${m.to}"`);
    if (kind !== 'self' && m.from === m.to) throw new Error(`${where}: from and to are the same; use kind "self"`);
    if (!m.label) throw new Error(`${where}: label is required`);
    if (m.id) { if (ids.has(m.id)) throw new Error(`${where}: duplicate id "${m.id}"`); ids.add(m.id); }
  });

  // Resolve a message reference (id or 0-based index in the spec) to a spec index.
  const ref = (r, what) => {
    if (typeof r === 'number') { if (r >= 0 && r < raw.length) return r; }
    else { const i = raw.findIndex((m) => m.id === r); if (i >= 0) return i; }
    throw new Error(`${what}: unknown message "${r}"`);
  };

  // Standalone notes append to a message's note.
  const extraNotes = new Map();
  (spec.notes ?? []).forEach((n, i) => {
    const idx = ref(n.message, `notes[${i}]`);
    extraNotes.set(idx, [...(extraNotes.get(idx) ?? []), n.text]);
  });

  // Drop self messages into the note of the nearest real message (the renderer cannot draw self loops).
  const real = [];
  const realIndexOf = new Array(raw.length).fill(-1);
  raw.forEach((m, i) => {
    if ((m.kind ?? 'call') === 'self') return;
    realIndexOf[i] = real.length;
    real.push({
      src: i,
      id: m.id ?? `m${real.length + 1}`,
      from: m.from, to: m.to,
      label: m.label,
      note: [m.note, ...(extraNotes.get(i) ?? [])].filter(Boolean),
      variant: m.kind === 'return' ? 'return' : m.kind === 'async' ? 'dashed' : TONES[m.tone] ?? 'default',
    });
  });
  if (!real.length) throw new Error('need at least 1 non-self message');
  raw.forEach((m, i) => {
    if ((m.kind ?? 'call') !== 'self') return;
    const who = byId.get(m.from);
    const text = `${who.label}: ${m.label}${m.note ? ` (${m.note})` : ''}`;
    let target = -1;
    for (let k = i - 1; k >= 0 && target < 0; k--) if (realIndexOf[k] >= 0 && raw[k].to === m.from) target = realIndexOf[k];
    for (let k = i - 1; k >= 0 && target < 0; k--) if (realIndexOf[k] >= 0 && (raw[k].from === m.from || raw[k].to === m.from)) target = realIndexOf[k];
    for (let k = i + 1; k < raw.length && target < 0; k++) if (realIndexOf[k] >= 0 && (raw[k].from === m.from || raw[k].to === m.from)) target = realIndexOf[k];
    if (target < 0) target = realIndexOf.slice(0, i).reverse().find((x) => x >= 0) ?? realIndexOf.find((x) => x >= 0);
    real[target].note.push(text);
  });
  // Messages that folded notes into an earlier message keep reading order.
  const messages = real.map((m) => {
    const split = splitLabel(m.label, state.labelMax);
    const noteParts = split.rest ? [split.rest, ...m.note] : m.note;
    return { ...m, label: split.label, note: noteParts.join(' · ') };
  });
  if (new Set(messages.map((m) => m.id)).size !== messages.length) throw new Error('generated message ids collide; give messages explicit ids');

  // Phases -> ranges over the real messages.
  const toReal = (specIdx) => {
    for (let k = specIdx; k < raw.length; k++) if (realIndexOf[k] >= 0) return realIndexOf[k];
    return realIndexOf.findLast((x) => x >= 0);
  };
  const toRealEnd = (specIdx) => {
    for (let k = specIdx; k >= 0; k--) if (realIndexOf[k] >= 0) return realIndexOf[k];
    return 0;
  };
  const phases = (spec.phases ?? []).map((p, i) => {
    if (!p.label) throw new Error(`phases[${i}]: label is required`);
    let a, b;
    if (p.ids?.length) {
      const idx = p.ids.map((r) => ref(r, `phases[${i}]`));
      a = Math.min(...idx); b = Math.max(...idx);
    } else {
      a = ref(p.from, `phases[${i}].from`); b = ref(p.to ?? p.from, `phases[${i}].to`);
      if (b < a) throw new Error(`phases[${i}]: "to" comes before "from"`);
    }
    return { label: p.label, from: toReal(a), to: toRealEnd(b) };
  });
  phases.forEach((p, i) => {
    if (i > 0 && p.from <= phases[i - 1].to) throw new Error(`phases[${i}] overlaps the previous phase; phases must be disjoint and in order`);
  });
  return { participants, messages, phases };
}

// Keep labels short: split at a natural boundary, remainder goes to the note.
function splitLabel(label, max) {
  if (units(label) <= max) return { label, rest: '' };
  const chars = [...label];
  let w = 0, cut = chars.length;
  for (let i = 0; i < chars.length; i++) { w += units(chars[i]); if (w > max) { cut = i; break; } }
  const head = chars.slice(0, cut).join('');
  // Prefer a boundary in the last third of the allowed width.
  const floor = Math.floor(head.length * 0.5);
  let at = -1;
  for (const re of [/ \(/g, /, /g, / [&+] /g, / /g]) {
    let m, last = -1;
    while ((m = re.exec(head))) last = m.index;
    if (last >= floor) { at = last; break; }
  }
  if (at < 0) at = head.length;
  const first = label.slice(0, at).trim().replace(/[,(&+]$/, '').trim();
  const rest = label.slice(at).trim().replace(/^[,&+]\s*/, '');
  return { label: first, rest };
}

function place(messages, phases, state) {
  const phaseStart = new Map(phases.map((p) => [p.from, p]));
  let y = FIRST_Y;
  return messages.map((m, i) => {
    if (i > 0) {
      const prev = messages[i - 1];
      let gap = BASE_GAP;
      if (prev.note) gap = Math.max(gap, 44 + (noteLines(prev, state) - 1) * NOTE_LINE);
      if (phaseStart.has(i)) gap += PHASE_GAP;
      gap += state.extraGap[i] ?? 0;
      y += gap;
    }
    m.y = y;
    m.lines = m.note ? noteLines(m, state) : 0;
    return m;
  });
}

// Estimated rendered line count of a note; the renderer wraps inside one lifeline gap (~100px usable).
function noteLines(m, state) {
  const width = state.noteWidth ?? 100;
  return Math.max(1, Math.ceil((units(m.note) * NOTE_UNIT) / width));
}

function segments(messages, phases) {
  return phases.map((p) => {
    const first = messages[p.from];
    const last = messages[p.to];
    const bottom = last.note ? last.y + 22 + (last.lines - 1) * NOTE_LINE : last.y + 6;
    return { from: first.y - 12, to: bottom + 10, label: p.label };
  });
}

function activations(spec, messages, participants) {
  const kindOf = new Map(participants.map((p) => [p.id, p.kind]));
  const byId = new Map(messages.map((m) => [m.id, m]));
  return (spec.activations ?? []).map((a, i) => {
    if (!kindOf.has(a.participant)) throw new Error(`activations[${i}]: unknown participant "${a.participant}"`);
    const f = byId.get(a.from), t = byId.get(a.to ?? a.from);
    if (!f || !t) throw new Error(`activations[${i}]: from/to must be message ids (non-self messages)`);
    return { participant: a.participant, from: f.y - 5, to: Math.max(t.y + 5, f.y + 6), type: kindOf.get(a.participant) };
  });
}

function firstMessageOfSegment(spec, state, si) {
  try {
    const { phases } = normalize(spec, state);
    return phases[si]?.from ?? null;
  } catch { return null; }
}

function units(s) {
  let n = 0;
  for (const ch of String(s)) n += ch.codePointAt(0) >= 0x2e80 ? 2 : 1;
  return n;
}

function need(v, name) {
  if (!v) throw new Error(`${name} is required`);
  return v;
}
