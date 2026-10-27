#!/usr/bin/env node
// Gate a codebase-workflow site: manifest, files, orphans, links, coverage, secrets.
//   node check-site.mjs <site-root> [--project <dir>]
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
import { findProjects, loadManifest, coverage, readJson } from './lib/manifest.mjs';

const args = process.argv.slice(2);
const root = args[0];
const only = args.includes('--project') ? args[args.indexOf('--project') + 1] : null;
if (!root) fail('usage: check-site.mjs <site-root> [--project <dir>]');

const LOCAL_PATH = /(file:\/\/|(["'(=\s])(\/var\/|\/home\/|\/Users\/|\/tmp\/|[A-Z]:\\\\))/;
const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
  [/\b(password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?(?!\*{3}|<|\$\{|process\.env|env\(|["'],?|(?:string|number|boolean|unknown|any|null|undefined)\b)[^\s"'<>,;]{6,}/i, 'credential assignment'],
  [/[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:[^\s/@"']+@/i, 'URL with user:password'],
];

const problems = [];
const report = [];
const projects = findProjects(root).filter((d) => !only || d === only);
if (!projects.length) problems.push(`no project with manifest.json under ${root}`);

for (const dir of projects) {
  const m = loadManifest(root, dir);
  problems.push(...m.errors);
  if (!m.data) continue;
  const base = join(root, dir);
  const listed = new Set();

  for (const page of m.data.pages ?? []) {
    for (const [lang, file] of Object.entries(page.files ?? {})) {
      listed.add(posix.normalize(file));
      if (!existsSync(join(base, file))) problems.push(`${dir}: page "${page.id}" ${lang} file missing: ${file}`);
    }
  }

  // Orphans: published HTML that no manifest entry lists (src/ holds work files and is not linked).
  for (const file of walk(base)) {
    const rel = relative(base, file).split('\\').join('/');
    if (rel.startsWith('src/') || !rel.endsWith('.html') || posix.basename(rel) === 'index.html') continue;
    if (!listed.has(rel)) problems.push(`${dir}: orphan page not in manifest: ${rel}`);
  }

  // Links and secrets in every published file (manifest + html outside src/).
  for (const file of walk(base)) {
    const rel = relative(base, file).split('\\').join('/');
    if (rel.startsWith('src/') || !/\.(html|json|md)$/.test(rel)) continue;
    const text = readFileSync(file, 'utf8');
    const local = text.match(LOCAL_PATH);
    if (local) problems.push(`${dir}/${rel}: local absolute path or file:// link near "${snippet(text, local.index)}"`);
    for (const [re, name] of SECRETS) {
      const hit = text.match(re);
      if (hit) problems.push(`${dir}/${rel}: possible ${name} near "${snippet(text, hit.index)}"`);
    }
    if (rel.endsWith('.html')) {
      for (const href of relativeLinks(text)) {
        if (!existsSync(join(dirname(file), href))) problems.push(`${dir}/${rel}: broken link ${href}`);
      }
    }
  }

  const inv = readJson(join(base, 'src', 'inventory.json'), null);
  if (inv) {
    const cov = coverage(inv, m.data.pages, readJson(join(base, 'src', 'coverage-exclusions.json'), []));
    report.push(`${dir}: coverage ${cov.percent}% (${cov.done}/${cov.total})`);
    if (cov.missing.length) problems.push(`${dir}: ${cov.missing.length} inventory item(s) not covered: ${cov.missing.slice(0, 25).join(', ')}${cov.missing.length > 25 ? ', …' : ''}`);
  } else {
    report.push(`${dir}: no src/inventory.json — coverage not checked`);
  }
}

if (existsSync(join(root, 'index.html'))) {
  for (const href of relativeLinks(readFileSync(join(root, 'index.html'), 'utf8'))) {
    if (!existsSync(join(root, href))) problems.push(`index.html: broken link ${href}`);
  }
} else problems.push('root index.html missing — run build-site.mjs');
if (!existsSync(join(root, '.nojekyll'))) problems.push('.nojekyll missing — run build-site.mjs');

console.log(report.join('\n'));
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n` + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('ok: all gates passed');

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walk(path);
    else yield path;
  }
}

// Only <a href> links matter for navigation; Archify pages embed data URIs and anchors.
function relativeLinks(html) {
  const out = [];
  for (const m of html.matchAll(/<a\b[^>]*?\s(?:href|data-href-[a-z-]+)="([^"#?]+)/g)) {
    const href = m[1];
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/)/i.test(href) || href.includes("${") || href.includes("{{")) continue;
    out.push(decodeURI(href));
  }
  return out;
}

function snippet(text, i) {
  return text.slice(Math.max(0, i - 20), i + 50).replace(/\s+/g, ' ');
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
