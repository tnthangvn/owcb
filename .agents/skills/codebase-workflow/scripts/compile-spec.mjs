#!/usr/bin/env node
// Compile a semantic page spec into an Archify candidate and finalize it, retrying layout-only relaxations.
//   node compile-spec.mjs <spec.json> <out.html> [--lang vi] [--repo-root <repo>] [--quality showcase|standard]
//                         [--work <dir>] [--max-relax 3] [--archify <dir>]
// Exit 0 = finalize passed. Exit 1 = gave up; the last candidate and diagnostics are printed for an agent to repair.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { applyLocale } from './lib/locale.mjs';

const SKILL_DIR = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
const flag = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const [specPath, outArg] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!specPath || !outArg) fail('usage: compile-spec.mjs <spec.json> <out.html> [--lang vi] [--repo-root <repo>] [--quality showcase|standard] [--work <dir>]');

const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const lang = flag('--lang', spec.lang ?? 'vi');
const out = resolve(outArg);
const work = resolve(flag('--work', join(dirname(resolve(specPath)), `build-${lang}`)));
const archify = resolve(flag('--archify', join(SKILL_DIR, '..', 'archify')));
const maxRelax = Number(flag('--max-relax', 3));
const repoRoot = flag('--repo-root', null);

const modulePath = join(SKILL_DIR, 'scripts', 'compilers', `${spec.type}.mjs`);
if (!existsSync(modulePath)) fail(`no compiler for type "${spec.type}" (expected ${modulePath}); write one or hand the page to an agent`);
const compiler = await import(pathToFileURL(modulePath).href);

const ctx = { lang, archify, repoRoot: repoRoot ? resolve(repoRoot) : null, repository: repoRoot ? repository(repoRoot) : spec.repository ?? null, quality: flag('--quality', spec.quality ?? 'showcase') };
let candidate = compiler.compile(spec, ctx);
mkdirSync(work, { recursive: true });
// Attempt files from an earlier run would look like part of this one.
for (const f of readdirSync(work)) if (f.startsWith(`candidate.${lang}.`) && f.endsWith('.json')) rmSync(join(work, f));
mkdirSync(dirname(out), { recursive: true });

let result;
for (let attempt = 0; attempt <= maxRelax; attempt++) {
  candidate.meta = { ...(candidate.meta ?? {}), output: basename(out), quality_profile: ctx.quality };
  if (ctx.repository) candidate.meta.repository = ctx.repository;
  applyLocale(candidate, lang);
  const candidatePath = join(work, `candidate.${lang}.${attempt}.json`);
  writeFileSync(candidatePath, JSON.stringify(candidate, null, 2) + '\n');
  result = finalize(compiler.type ?? spec.type, candidatePath, attempt);
  if (result.ok) {
    console.log(`ok: ${out} (${spec.type}, ${lang}, attempt ${attempt + 1})`);
    for (const w of result.warnings.slice(0, 5)) console.log(`  warn ${w}`);
    process.exit(0);
  }
  const next = compiler.relax?.(structuredClone(candidate), result.diagnostics, attempt, spec, ctx);
  if (!next) break;
  candidate = next;
}

console.error(`failed: ${spec.type} ${lang} — last candidate ${join(work, `candidate.${lang}.*.json`)}`);
for (const d of result.diagnostics.slice(0, 20)) console.error(`  ${d.severity ?? 'error'} ${d.code}: ${(d.message ?? '').slice(0, 300)}`);
process.exit(1);

function finalize(type, candidatePath, attempt) {
  // Archify resolves meta.output against the working directory, so run it beside the output.
  // One evidence folder per language: Archify refuses to write into an existing one, so clear ours first.
  const outDir = join(work, `review-${lang}`);
  rmSync(outDir, { recursive: true, force: true });
  const run = spawnSync('node', [join(archify, 'bin', 'archify.mjs'), 'finalize', type, candidatePath, basename(out),
    ...(repoRoot ? ['--repo-root', resolve(repoRoot)] : []), '--quality', ctx.quality, '--json', '--out-dir', outDir],
  { cwd: dirname(out), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  let receipt = null;
  try { receipt = JSON.parse(run.stdout); } catch { /* non-JSON failure: keep stderr */ }
  const diagnostics = receipt?.diagnostics ?? collect(receipt) ?? [];
  if (!diagnostics.length && run.status !== 0) diagnostics.push({ code: 'finalize/exit', message: (run.stderr || run.stdout || '').slice(-1500) });
  const errors = diagnostics.filter((d) => (d.severity ?? 'error') === 'error');
  return {
    ok: run.status === 0 && (receipt?.ok ?? true),
    diagnostics: errors.length ? errors : diagnostics,
    warnings: diagnostics.filter((d) => d.severity === 'warning').map((d) => `${d.code}: ${(d.message ?? '').slice(0, 160)}`),
  };
}

// Some receipts nest gate results; flatten any diagnostics arrays found.
function collect(receipt) {
  if (!receipt) return null;
  const found = [];
  const walk = (o) => {
    if (Array.isArray(o)) return o.forEach(walk);
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) (k === 'diagnostics' && Array.isArray(v) ? found.push(...v) : walk(v));
  };
  walk(receipt);
  return found;
}

function repository(root) {
  const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8' }).trim();
  const url = git('remote', 'get-url', 'origin').replace(/\/\/[^@/]+@/, '//');
  const web = /^https:\/\/(github\.com|gitlab\.com|gitee\.com)\//.test(url);
  return { url, revision: git('rev-parse', 'HEAD'), link_mode: web ? 'web' : 'local-only' };
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
