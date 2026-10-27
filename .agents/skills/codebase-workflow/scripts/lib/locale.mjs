// Viewer locale for Archify candidates: meta.locale, plus meta.translations when Archify bundles no catalog.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BUNDLED = new Set(['en', 'zh-CN', 'zh-TW', 'es', 'ko', 'ar']);

export function applyLocale(doc, lang) {
  doc.meta ??= {};
  doc.meta.locale = lang;
  if (BUNDLED.has(lang)) {
    delete doc.meta.translations;
    return doc;
  }
  const catalog = join(SKILL_DIR, 'locales', `${lang}.json`);
  if (!existsSync(catalog)) throw new Error(`no catalog for "${lang}" at ${catalog}`);
  doc.meta.translations = JSON.parse(readFileSync(catalog, 'utf8'));
  return doc;
}

export const isBundled = (lang) => BUNDLED.has(lang);
