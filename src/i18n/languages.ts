/**
 * SINGLE SOURCE OF TRUTH for the app's languages.
 *
 * To add a language you only touch THIS file: import its `<code>.json` and add
 * one row below (code, native name, dictionary). Everything else — the
 * `Language` type, the display names, the dictionaries map, the settings picker
 * and the persistence whitelist — is derived from this list, so nothing else
 * needs editing and nothing can fall out of sync.
 *
 * English is the source text (the keys), so it has no dictionary. If a language
 * needs more than 2 plural forms (e.g. Russian), also add its forms in `PLURALS`
 * and its rule in `PLURAL_RULE` (`./index.ts`). See TRANSLATING.md.
 */
import ca from './locales/ca.json';
import de from './locales/de.json';
import es from './locales/es.json';

type Dict = Record<string, string>;
type LangDef = { code: string; name: string; dict?: Dict };

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español', dict: es },
  { code: 'de', name: 'Deutsch', dict: de },
  { code: 'ca', name: 'Català', dict: ca },
] as const satisfies readonly LangDef[];

export type Language = (typeof LANGUAGES)[number]['code'];

/** Nombre de cada idioma en su propio idioma (para los selectores). */
export const LANGUAGE_NAMES = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.name]),
) as Record<Language, string>;

/** Diccionarios por idioma. El inglés es la clave, así que no lleva tabla. */
export const DICTIONARIES = Object.fromEntries(
  LANGUAGES.filter((l) => 'dict' in l).map((l) => [l.code, (l as { dict: Dict }).dict]),
) as Partial<Record<Language, Dict>>;

/** ¿Es `v` un código de idioma soportado? (valida lo leído de disco). */
export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && LANGUAGES.some((l) => l.code === v);
}
