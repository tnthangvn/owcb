#!/usr/bin/env node
// Turn <project>/src/plan.json into worker briefs and manifest page entries.
//   node plan.mjs briefs   <project-dir> --archify <archify-dir>   writes src/pages/<id>/{brief.md,inventory-slice.json}
//   node plan.mjs manifest <project-dir>                           merges plan pages into manifest.json
//   node plan.mjs compile  <project-dir> [--page <id>]             spec.<lang>.json → staged out/ via compile-spec.mjs (explainers: finalize candidate[.<lang>].archify.md)
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SKILL_DIR = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const [cmd, projectArg, ...rest] = process.argv.slice(2);
if (!cmd || !projectArg) fail('usage: plan.mjs briefs|manifest|compile <project-dir> [--archify <dir>] [--page <id>]');
const project = resolve(projectArg);
const plan = JSON.parse(readFileSync(join(project, 'src', 'plan.json'), 'utf8'));

const output = (page, lang) => join(page.folder ?? '', `${page.id}.${lang}.html`).replace(/^\.\//, '');
// Workers finalize into their own folder (no shared Archify lock, receipts stay unpublished); `manifest` publishes.
const staged = (page, lang) => join(project, 'src', 'pages', page.id, 'out', `${page.id}.${lang}.html`);

if (cmd === 'briefs') {
  const archify = resolve(rest[rest.indexOf('--archify') + 1] ?? fail('--archify <dir> required'));
  const inv = JSON.parse(readFileSync(join(project, 'src', 'inventory.json'), 'utf8'));
  const items = new Map(inv.items.map((i) => [i.id, i]));
  const features = new Map(inv.features.map((f) => [f.id, f]));
  const template = readFileSync(join(SKILL_DIR, 'templates', 'worker-prompt.md'), 'utf8');
  const principles = readFileSync(join(SKILL_DIR, 'references', 'working-principles.md'), 'utf8').replace(/^# .*\n/, '');
  const [base, ...others] = plan.languages;

  for (const page of plan.pages) {
    const dir = join(project, 'src', 'pages', page.id);
    mkdirSync(dir, { recursive: true });
    const slice = { features: [], items: [] };
    const seen = new Set();
    for (const id of page.covers) {
      const f = features.get(id);
      if (f) {
        slice.features.push(f);
        for (const child of f.items) if (!seen.has(child) && items.has(child)) seen.add(child), slice.items.push(items.get(child));
      } else if (items.has(id) && !seen.has(id)) {
        seen.add(id), slice.items.push(items.get(id));
      } else if (!items.has(id)) {
        fail(`${page.id}: covers unknown id ${id}`);
      }
    }
    writeFileSync(join(dir, 'inventory-slice.json'), JSON.stringify(slice, null, 2) + '\n');

    const isExplainer = page.type === 'explainer';
    const cand = isExplainer ? 'candidate.archify.md' : 'candidate.json';
    const enSteps = others.map((l) => isExplainer
      ? `Translate \`${dir}/${cand}\` into \`${dir}/candidate.${l}.archify.md\` (${l}; set \`@meta locale=${l}\`; keep ids, anchors, sources and structure), then finalize it to \`${staged(page, l)}\` with \`--out-dir ${dir}/review-${l}\` (delete that folder first if it exists).`
      : `Translate \`${dir}/spec.vi.json\` into \`${dir}/spec.${l}.json\`: change only reader-facing text (label, sublabel, title, subtitle, detail, note, text, items, tag, comment); keep ids, enums, sources, column names and code identifiers. Check with \`node ${SKILL_DIR}/scripts/i18n.mjs check-pair ${dir}/spec.vi.json ${dir}/spec.${l}.json\` (must print ok), then compile with \`node ${SKILL_DIR}/scripts/compile-spec.mjs ${dir}/spec.${l}.json ${staged(page, l)} --lang ${l} --repo-root ${plan.repo} --work ${dir}/build-${l}\` (after the vi compile has finished — never both at once).`).join(' ');

    const fill = {
      PAGE_ID: page.id,
      TITLE_VI: page.title.vi ?? '', TITLE_EN: page.title.en ?? '',
      TYPE: page.type, AUDIENCE: page.audience, QUESTION: page.question,
      COVERS: page.covers.join(', '),
      INVENTORY_SLICE: join(dir, 'inventory-slice.json'),
      REPO: plan.repo, COMMIT: plan.commit, ORIGIN: plan.origin,
      ARCHIFY: archify, SKILL_DIR, WORK_DIR: dir,
      OUT_VI: staged(page, base),
      EN_STEP: enSteps || 'No other language requested.',
      EXTRA_NOTES: page.notes ? `- Orchestrator notes: ${page.notes}` : '',
      WORKING_PRINCIPLES: principles.trim(),
    };
    let brief = template.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in fill ? fill[k] : m));
    if (isExplainer) brief = brief.replaceAll(`${dir}/candidate.json`, `${dir}/${cand}`);
    writeFileSync(join(dir, 'brief.md'), brief);
    mkdirSync(join(dir, 'out'), { recursive: true });
  }
  console.log(`briefs: ${plan.pages.length} page(s) under ${join(project, 'src', 'pages')}`);
} else if (cmd === 'manifest') {
  const path = join(project, 'manifest.json');
  const manifest = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {
    version: 1, project: basename(project), title: plan.title, summary: plan.summary,
    languages: plan.languages, groups: plan.groups, pages: [],
  };
  manifest.languages = plan.languages;
  manifest.source = { kind: plan.kind ?? 'codebase', repo: basename(plan.repo), commit: plan.commit };
  manifest.generatedAt = new Date().toISOString();
  manifest.generator = { ...(manifest.generator ?? {}), ...(plan.generator ?? {}) };
  for (const g of plan.groups) if (!manifest.groups.some((x) => x.id === g.id)) manifest.groups.push(g);
  const kept = manifest.pages.filter((p) => !plan.pages.some((q) => q.id === p.id));
  // Publish staged outputs and move any Archify receipt that landed beside a published page back into src/.
  for (const p of plan.pages) {
    const dir = join(project, 'src', 'pages', p.id);
    for (const l of plan.languages) {
      const from = staged(p, l);
      const to = join(project, output(p, l));
      if (existsSync(from) && (!existsSync(to) || statSync(from).mtimeMs > statSync(to).mtimeMs)) {
        mkdirSync(dirname(to), { recursive: true });
        copyFileSync(from, to);
      }
      const folder = dirname(to);
      if (!existsSync(folder)) continue;
      for (const f of readdirSync(folder)) {
        if (f.startsWith(`${p.id}.${l}.`) && f.endsWith('.json')) {
          mkdirSync(join(dir, 'receipts'), { recursive: true });
          renameSync(join(folder, f), join(dir, 'receipts', f));
        }
      }
    }
  }
  const fromPlan = plan.pages
    .map((p) => ({
      id: p.id, group: p.group, title: p.title, summary: p.summary, type: p.type, audience: p.audience,
      files: Object.fromEntries(plan.languages.map((l) => [l, output(p, l)]).filter(([, f]) => existsSync(join(project, f)))),
      covers: p.covers,
    }))
    .filter((p) => Object.keys(p.files).length);
  const skipped = plan.pages.length - fromPlan.length;
  // Group order follows plan.groups; legacy and other kept pages stay after.
  manifest.pages = [...fromPlan, ...kept];
  manifest.groups.sort((a, b) => order(a.id) - order(b.id));
  writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest: ${fromPlan.length} plan page(s) with output, ${skipped} skipped (no HTML yet), ${kept.length} kept`);
} else if (cmd === 'compile') {
  const only = rest.includes('--page') ? rest[rest.indexOf('--page') + 1] : null;
  const archify = join(SKILL_DIR, '..', 'archify');
  let failed = 0;
  for (const page of plan.pages.filter((p) => !only || p.id === only)) {
    const dir = join(project, 'src', 'pages', page.id);
    // Languages run one after another: Archify locks the output folder during delivery.
    for (const [i, lang] of plan.languages.entries()) {
      const out = staged(page, lang);
      let cmdArgs;
      if (page.type === 'explainer') {
        const md = join(dir, i === 0 ? 'candidate.archify.md' : `candidate.${lang}.archify.md`);
        if (!existsSync(md)) { console.log(`skip ${page.id} ${lang}: no ${basename(md)}`); continue; }
        const review = join(dir, `review-${lang}`);
        rmSync(review, { recursive: true, force: true }); // Archify refuses an existing evidence folder
        cmdArgs = [join(archify, 'bin', 'archify.mjs'), 'finalize', 'explainer', md, out, '--repo-root', plan.repo, '--json', '--out-dir', review];
      } else {
        const spec = join(dir, `spec.${lang}.json`);
        if (!existsSync(spec)) { console.log(`skip ${page.id} ${lang}: no spec.${lang}.json (agent-authored page)`); continue; }
        cmdArgs = [join(SKILL_DIR, 'scripts', 'compile-spec.mjs'), spec, out, '--lang', lang, '--repo-root', plan.repo, '--work', join(dir, `build-${lang}`)];
      }
      const run = spawnSync('node', cmdArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      const ok = run.status === 0;
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${page.id} ${lang}${ok ? '' : '\n' + (run.stderr || run.stdout).trim().split('\n').slice(0, 8).map((l) => '     ' + l).join('\n')}`);
    }
  }
  if (failed) { console.error(`${failed} compile(s) failed — hand those pages to an agent with the printed diagnostics`); process.exit(1); }
} else {
  fail(`unknown command ${cmd}`);
}

function order(id) {
  const i = plan.groups.findIndex((g) => g.id === id);
  return i < 0 ? 999 : i;
}

function fail(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
