/**
 * i18n mínimo y reactivo. El texto en INGLÉS es la clave; cada idioma extra
 * tiene su diccionario JSON en `locales/` (clave inglesa → traducción).
 * `useT()` devuelve una función `t` ligada al idioma actual (del store de
 * ajustes), por lo que cambiar el idioma re-renderiza y traduce al vuelo.
 *
 * Para añadir un idioma nuevo (p. ej. 'fr'):
 *   1. Añádelo a `Language` en src/store/settings.ts (y a su `hydrate`).
 *   2. Crea `locales/fr.json` (clave inglesa → traducción) e impórtalo en `dictionaries`.
 *   3. Añade sus formas a `PLURALS` (singular/plural).
 *   4. Añade su opción a `LANGUAGES` en src/app/settings/display.tsx.
 * El inglés no necesita diccionario (es la clave); lo no traducido cae a él.
 */
import { useCallback } from 'react';

import { useSettings, type Language } from '@/store/settings';
import es from './locales/es.json';

/** Diccionarios por idioma. El inglés es la clave, así que no lleva tabla. */
const dictionaries: Partial<Record<Language, Record<string, string>>> = {
  es,
};

type Vars = Record<string, string | number>;

function translate(text: string, lang: Language, vars?: Vars): string {
  const table = dictionaries[lang];
  let out = table?.[text] ?? text;
  if (vars) {
    for (const key of Object.keys(vars)) {
      out = out.split(`{${key}}`).join(String(vars[key]));
    }
  }
  return out;
}

/** Traducción fuera de componentes (p. ej. en stores). Lee el idioma actual. */
export function tg(text: string, vars?: Vars): string {
  return translate(text, useSettings.getState().language, vars);
}

export type TFunction = (text: string, vars?: Vars) => string;

/** Hook reactivo: devuelve `t` ligada al idioma actual. */
export function useT(): TFunction {
  const lang = useSettings((s) => s.language);
  return useCallback((text: string, vars?: Vars) => translate(text, lang, vars), [lang]);
}

/**
 * Formas singular/plural por idioma para los contadores. El inglés ('en')
 * es obligatorio (fallback); el resto son opcionales.
 */
const PLURALS: Record<string, Partial<Record<Language, [string, string]>>> = {
  song: { es: ['canción', 'canciones'], en: ['song', 'songs'] },
  album: { es: ['álbum', 'álbumes'], en: ['album', 'albums'] },
};

function countLabel(kind: keyof typeof PLURALS, n: number, lang: Language): string {
  const forms = PLURALS[kind][lang] ?? PLURALS[kind].en!;
  return `${n} ${forms[n === 1 ? 0 : 1]}`;
}

/** "N canción/canciones" (o su equivalente) según idioma. */
export function songsLabel(n: number, lang: Language): string {
  return countLabel('song', n, lang);
}

/** "N álbum/álbumes" (o su equivalente) según idioma. */
export function albumsLabel(n: number, lang: Language): string {
  return countLabel('album', n, lang);
}
