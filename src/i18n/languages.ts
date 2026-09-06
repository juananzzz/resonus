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
import ru from './locales/ru.json';
import it from './locales/it.json';
import zhCN from './locales/zh-CN.json';
import uk from './locales/uk.json';
import pl from './locales/pl.json';

type Dict = Record<string, string>;
/**
 * When each greeting starts, as [morning, afternoon, evening] in hours of the
 * 24h clock. What is left over, from midnight to the start of the morning, is
 * the fourth greeting ("Good night").
 *
 * This is part of a language, not a setting: English calls 6pm the evening and
 * Spanish is still in the afternoon at that hour. A language that says nothing
 * gets `DEFAULT_GREETING_HOURS`.
 */
type GreetingHours = readonly [number, number, number];
type LangDef = { code: string; name: string; dict?: Dict; greeting?: GreetingHours };

/**
 * English hours, and the fallback for any language that hasn't said otherwise:
 * afternoon from midday and evening from six, which is what most of the
 * languages we ship are closer to.
 */
export const DEFAULT_GREETING_HOURS: GreetingHours = [5, 12, 18];

export const LANGUAGES = [
  { code: 'en', name: 'English' },
  // Spanish and Catalan run late: midday is not the afternoon yet, and at 6pm
  // nobody says "buenas noches". These two are why the hours are per language.
  { code: 'es', name: 'Español', dict: es, greeting: [6, 13, 21] },
  { code: 'de', name: 'Deutsch', dict: de },
  { code: 'ca', name: 'Català', dict: ca, greeting: [6, 13, 21] },
  { code: 'ru', name: 'Русский', dict: ru },
  { code: 'it', name: 'Italiano', dict: it },
  { code: 'zh-CN', name: '简体中文', dict: zhCN },
  { code: 'uk', name: 'Українська', dict: uk },
  { code: 'pl', name: 'Polski', dict: pl },
] as const satisfies readonly LangDef[];

export type Language = (typeof LANGUAGES)[number]['code'];

/** Each language's name in its own language, for the pickers. */
export const LANGUAGE_NAMES = Object.fromEntries(
  LANGUAGES.map((l) => [l.code, l.name]),
) as Record<Language, string>;

/** The dictionaries, by language. English is the key itself, so it has none. */
export const DICTIONARIES = Object.fromEntries(
  LANGUAGES.filter((l) => 'dict' in l).map((l) => [l.code, (l as { dict: Dict }).dict]),
) as Partial<Record<Language, Dict>>;

/** When each greeting starts in this language (see `GreetingHours`). */
export function greetingHours(lang: Language): GreetingHours {
  const def = LANGUAGES.find((l) => l.code === lang) as LangDef | undefined;
  return def?.greeting ?? DEFAULT_GREETING_HOURS;
}

/** Is `v` a language we support? Guards what comes back from disk. */
export function isLanguage(v: unknown): v is Language {
  return typeof v === 'string' && LANGUAGES.some((l) => l.code === v);
}
