/**
 * Minimal reactive i18n. The ENGLISH text is the key; each extra language has
 * its JSON dictionary in `locales/` (English key → translation).
 * `useT()` returns a `t` function bound to the current language (from the
 * settings store), so changing the language re-renders and translates on the
 * fly.
 *
 * To add a new language: a single row in `src/i18n/languages.ts` (the single
 * source of truth for languages) plus its `locales/<code>.json`. If its plural
 * rule is not binary, add its forms in `PLURALS` and its function in
 * `PLURAL_RULE`. See the guide in TRANSLATING.md. English is the key;
 * untranslated strings fall back to it.
 */
import { useCallback } from 'react';

import { useSettings } from '@/store/settings';
import { DICTIONARIES, type Language } from './languages';

type Vars = Record<string, string | number>;

function translate(text: string, lang: Language, vars?: Vars): string {
  const table = DICTIONARIES[lang];
  let out = table?.[text] ?? text;
  if (vars) {
    for (const key of Object.keys(vars)) {
      out = out.split(`{${key}}`).join(String(vars[key]));
    }
  }
  return out;
}

/** Translation outside components (e.g. in stores). Reads the current language. */
export function tg(text: string, vars?: Vars): string {
  return translate(text, useSettings.getState().language, vars);
}

export type TFunction = (text: string, vars?: Vars) => string;

/** Reactive hook: returns `t` bound to the current language. */
export function useT(): TFunction {
  const lang = useSettings((s) => s.language);
  return useCallback((text: string, vars?: Vars) => translate(text, lang, vars), [lang]);
}

/**
 * Per-language plural forms for counters. English ('en') is mandatory
 * (fallback); the rest are optional. Each language provides as many forms as
 * its rule uses (see `PLURAL_RULE`): 2 for en/es/ca/de (one/other), 3 for
 * languages like Russian (one/few/many).
 */
const PLURALS: Record<string, Partial<Record<Language, string[]>>> = {
  song: { es: ['canción', 'canciones'], en: ['song', 'songs'], de: ['Titel', 'Titel'], ca: ['cançó', 'cançons'], ru: ['композиция', 'композиции', 'композиций'], it: ['canzone', 'canzoni'] },
  album: { es: ['álbum', 'álbumes'], en: ['album', 'albums'], de: ['Album', 'Alben'], ca: ['àlbum', 'àlbums'], ru: ['альбом', 'альбома', 'альбомов'], it: ['album', 'album']  },
};

/**
 * Per-language plural rule: given `n`, returns the form index in PLURALS.
 * Languages not listed here use the binary rule (one / other), correct for
 * en/es/ca/de. To add one with more forms, register its function here and
 * provide its forms in PLURALS.
 */
const PLURAL_RULE: Partial<Record<Language, (n: number) => number>> = {
  // Russian (CLDR): 3 forms [one, few, many]. one 1,21,31… · few 2–4,22–24… ·
  // many 0,5–20,25… (11–14 fall into many due to exceptions).
  ru: (n) => {
    const d = n % 10;
    const c = n % 100;
    if (d === 1 && c !== 11) return 0;
    if (d >= 2 && d <= 4 && (c < 12 || c > 14)) return 1;
    return 2;
  },
};

function pluralIndex(lang: Language, n: number): number {
  const rule = PLURAL_RULE[lang];
  return rule ? rule(n) : n === 1 ? 0 : 1;
}

function countLabel(kind: keyof typeof PLURALS, n: number, lang: Language): string {
  const forms = PLURALS[kind][lang] ?? PLURALS[kind].en!;
  // Clamp in case the rule asks for an index that language didn't fill in.
  const idx = Math.min(pluralIndex(lang, n), forms.length - 1);
  return `${n} ${forms[idx]}`;
}

/** "N song/songs" (or equivalent) per language. */
export function songsLabel(n: number, lang: Language): string {
  return countLabel('song', n, lang);
}

/** "N album/albums" (or equivalent) per language. */
export function albumsLabel(n: number, lang: Language): string {
  return countLabel('album', n, lang);
}
