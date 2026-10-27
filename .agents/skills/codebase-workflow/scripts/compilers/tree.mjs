// Tree compiler: semantic nested spec -> Archify tree candidate. Spec format: references/specs/tree.md
export const type = 'tree';

const LIMITS = { sublabel: 120 };

export function compile(spec, ctx = {}) {
  if (!spec || typeof spec !== 'object') throw new Error('tree spec: object expected');
  if (!spec.title) throw new Error('tree spec: "title" is required');
  const root = spec.root;
  if (!root || typeof root !== 'object') throw new Error('tree spec: "root" node is required');

  const nodes = [];
  const used = new Set();
  let leaves = 0;
  let depth = 0;

  const uid = (raw, fallback) => {
    let base = String(raw ?? fallback).replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^[^a-zA-Z]+/, 'n_');
    if (!base) base = fallback;
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base}_${i}`;
    used.add(id);
    return id;
  };

  const visit = (n, parentId, level, path) => {
    if (!n || typeof n !== 'object') throw new Error(`tree spec: node at ${path} must be an object`);
    if (typeof n.label !== 'string' || !n.label.trim()) throw new Error(`tree spec: node at ${path} needs a non-empty "label"`);
    if (n.sources !== undefined && (!Array.isArray(n.sources) || n.sources.length < 1 || n.sources.length > 3)) {
      throw new Error(`tree spec: node "${n.label}" (${path}) "sources" must hold 1-3 entries`);
    }
    const id = uid(n.id, `n${nodes.length}`);
    const node = { id, label: n.label.trim() };
    if (parentId) node.parent = parentId;
    const sub = sublabel(n);
    if (sub) node.sublabel = sub;
    if (n.collapsed) node.collapsed = true;
    if (n.sources) node.sources = n.sources.map(source);
    nodes.push(node);
    depth = Math.max(depth, level);
    const kids = n.children ?? [];
    if (!Array.isArray(kids)) throw new Error(`tree spec: "children" of ${path} must be an array`);
    if (!kids.length) leaves++;
    kids.forEach((k, i) => visit(k, id, level + 1, `${path}/${i}`));
  };
  visit(root, null, 0, 'root');

  const direction = spec.direction ?? (leaves > 24 || depth >= 4 ? 'right' : 'down');
  if (!['down', 'right'].includes(direction)) throw new Error('tree spec: direction must be "down" or "right"');
  const out = {
    schema_version: 1,
    diagram_type: 'tree',
    meta: { title: spec.title, ...(spec.subtitle ? { subtitle: spec.subtitle } : {}) },
    layout: { direction, ...(spec.layout ?? {}) },
    nodes,
  };
  if (spec.cards?.length) out.cards = spec.cards;
  return out;
}

// Tree nodes carry only label + sublabel: a tag becomes a leading chip word, detail the fallback text.
function sublabel(n) {
  const parts = [];
  if (n.tag) parts.push(String(n.tag).trim());
  const body = n.sublabel ?? n.detail;
  if (body) parts.push(String(body).trim());
  const s = parts.join(' · ');
  return s.length > LIMITS.sublabel ? s.slice(0, LIMITS.sublabel - 1).trimEnd() + '…' : s;
}

function source(s) {
  if (typeof s === 'string') {
    const m = /^(.*?):(\d+)(?:-(\d+))?$/.exec(s);
    return m ? { path: m[1], line: +m[2], ...(m[3] ? { end_line: +m[3] } : {}) } : { path: s };
  }
  return s;
}

// Layout-only retries: flip direction, then widen gaps and node width. Never touches content.
export function relax(candidate, diagnostics, attempt) {
  const l = candidate.layout ?? (candidate.layout = {});
  if (attempt === 0) {
    l.direction = l.direction === 'right' ? 'down' : 'right';
    return candidate;
  }
  if (attempt <= 2) {
    l.gapX = (l.gapX ?? 24) + 16;
    l.gapY = (l.gapY ?? 28) + 8;
    l.nodeMaxW = (l.nodeMaxW ?? (l.direction === 'right' ? 200 : 220)) + 40;
    return candidate;
  }
  return null;
}
