#!/usr/bin/env node
// Delete what failed runs left behind; keep everything that passed.
//   node clean.mjs <project-dir> [--latest] [--dry-run]
// Removed: review folders whose finalize did not pass (or never finished), candidate attempts that
// preceded the passing one, and pending delivery receipts. Kept: passing review folders, the passing
// candidate, staged/compiled pages, delivery receipts, specs, logs.
// --latest also removes passing review folders that a newer pass of the same page and language replaced.
import { readdirSync, readFileSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const [project, ...flags] = process.argv.slice(2);
if (!project) fail('usage: clean.mjs <project-dir> [--dry-run]');
const dry = flags.includes('--dry-run');
const latestOnly = flags.includes('--latest');
const pages = join(project, 'src', 'pages');
if (!existsSync(pages)) fail(`no ${pages}`);

const removed = [];
const passing = [];
for (const dir of walkDirs(pages)) {
  const name = dir.split('/').pop();
  if (/^review-/.test(name)) {
    if (passed(dir)) passing.push(dir);
    else remove(dir);
  } else if (/^build-[a-z]{2}(-[A-Za-z]+)?$/.test(name)) {
    pruneAttempts(dir);
  }
}
for (const file of walkFiles(pages)) if (file.endsWith('.delivery-pending.json')) remove(file);

// Newest pass per page + language wins; the language comes from the summary file name (<id>.<lang>.finalize-summary.json).
let keptReviews = passing.length;
if (latestOnly) {
  const newest = new Map();
  for (const dir of passing) {
    const summary = readdirSync(dir).find((f) => f.endsWith('.finalize-summary.json'));
    const lang = summary.split('.').slice(-3, -2)[0];
    const key = `${relative(pages, dir).split('/')[0]}|${lang}`;
    const time = statSync(join(dir, summary)).mtimeMs;
    const prev = newest.get(key);
    if (!prev) newest.set(key, { dir, time });
    else if (time > prev.time) { remove(prev.dir); newest.set(key, { dir, time }); }
    else remove(dir);
  }
  keptReviews = newest.size;
}

console.log(`${dry ? 'would remove' : 'removed'} ${removed.length} path(s); kept ${keptReviews} passing review folder(s)${latestOnly ? ' (newest per page/language)' : ''}`);
for (const p of removed.slice(0, 40)) console.log(`  - ${relative(project, p)}`);
if (removed.length > 40) console.log(`  … ${removed.length - 40} more`);

// A review folder passed when its finalize summary says so; no summary means the run never finished.
function passed(dir) {
  const summary = readdirSync(dir).find((f) => f.endsWith('.finalize-summary.json'));
  if (!summary) return false;
  try {
    const s = JSON.parse(readFileSync(join(dir, summary), 'utf8'));
    return s.status === 'pass' || s.ok === true;
  } catch {
    return false;
  }
}

// compile-spec.mjs writes candidate.<lang>.<attempt>.json per relax round and reuses review-<lang>.
// If the newest review passed, the newest attempt is the passing candidate; the rest failed or are stale.
function pruneAttempts(buildDir) {
  const attempts = readdirSync(buildDir)
    .map((f) => /^candidate\.([a-zA-Z-]+)\.(\d+)\.json$/.exec(f))
    .filter(Boolean)
    .map((m) => ({ file: join(buildDir, m[0]), lang: m[1], n: Number(m[2]) }));
  for (const lang of new Set(attempts.map((a) => a.lang))) {
    // Newest last: a rerun rewrites low attempt numbers, so numbering alone can point at a stale file.
    const mine = attempts.filter((a) => a.lang === lang).sort((a, b) => statSync(a.file).mtimeMs - statSync(b.file).mtimeMs);
    // The newest review folder of this language belongs to the last attempt (older runs used numbered names).
    const reviews = readdirSync(buildDir)
      .filter((f) => f === `review-${lang}` || f.startsWith(`review-${lang}-`))
      .map((f) => join(buildDir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    const keepLast = reviews.length > 0 && passed(reviews[0]);
    for (const a of keepLast ? mine.slice(0, -1) : mine) remove(a.file);
  }
}

function remove(path) {
  removed.push(path);
  if (!dry) rmSync(path, { recursive: true, force: true });
}

function* walkDirs(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (!statSync(path).isDirectory()) continue;
    yield path;
    if (!/^review-/.test(name)) yield* walkDirs(path);
  }
}

function* walkFiles(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* walkFiles(path);
    else yield path;
  }
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
