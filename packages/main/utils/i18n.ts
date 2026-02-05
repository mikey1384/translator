import { app } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import log from 'electron-log';

type LocaleData = Record<string, any>;

const localeCache = new Map<string, LocaleData | null>();
let enCache: LocaleData | null | undefined;

function getDeep(obj: any, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = key.split('.');
  let cur: any = obj;
  for (const part of parts) {
    if (!cur || typeof cur !== 'object' || !(part in cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

function interpolate(
  template: string,
  vars: Record<string, string | number | null | undefined> | undefined
): string {
  if (!vars) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

function getCandidateLocalePaths(lang: string): string[] {
  const bases = [app.getAppPath(), process.cwd()].filter(Boolean);
  const candidates: string[] = [];
  for (const base of bases) {
    candidates.push(
      path.join(base, 'packages', 'renderer', 'locales', `${lang}.json`)
    );
    candidates.push(
      path.join(base, 'packages', 'renderer', 'dist', 'locales', `${lang}.json`)
    );
  }
  return candidates;
}

async function readLocaleFile(lang: string): Promise<LocaleData | null> {
  const candidates = getCandidateLocalePaths(lang);
  for (const p of candidates) {
    try {
      const raw = await fs.readFile(p, 'utf8');
      return JSON.parse(raw) as LocaleData;
    } catch {
      // Try next candidate
    }
  }
  log.warn(`[i18n] Could not load locale file for "${lang}"`);
  return null;
}

async function getLocaleData(lang: string): Promise<LocaleData | null> {
  if (localeCache.has(lang)) return localeCache.get(lang) ?? null;
  const data = await readLocaleFile(lang);
  localeCache.set(lang, data);
  return data;
}

async function getEnglishData(): Promise<LocaleData | null> {
  if (enCache !== undefined) return enCache;
  enCache = await readLocaleFile('en');
  return enCache;
}

export async function getMainT(
  lang: string
): Promise<
  (
    key: string,
    vars?: Record<string, string | number | null | undefined>,
    defaultValue?: string
  ) => string
> {
  const preferred = (lang || 'en').trim();
  const base = preferred.includes('-') ? preferred.split('-')[0] : preferred;

  const [preferredData, baseData, enData] = await Promise.all([
    getLocaleData(preferred),
    preferred === base ? Promise.resolve(null) : getLocaleData(base),
    getEnglishData(),
  ]);

  return (key, vars, defaultValue) => {
    const raw =
      getDeep(preferredData, key) ??
      getDeep(baseData, key) ??
      getDeep(enData, key) ??
      defaultValue;

    if (typeof raw !== 'string') {
      return typeof defaultValue === 'string'
        ? interpolate(defaultValue, vars)
        : String(raw ?? key);
    }
    return interpolate(raw, vars);
  };
}
