/** The search box at the top of Settings: finds a setting by its name. */
import { normQ } from './librarySort';
import { SETTINGS_INDEX, type SettingEntry } from './settingsIndex.generated';

export interface SettingHit {
  key: string;
  label: string;
  /** Where it is, as the screens on the way are titled. */
  where: string;
  screen: string;
}

const MAX_HITS = 30;

/**
 * Settings whose name contains the query, in the language on screen; then the
 * ones on a screen whose title does. `roots` are the categories this profile
 * has: a result must not lead somewhere the index itself does not.
 */
export function searchSettings(
  query: string,
  t: (key: string) => string,
  roots: ReadonlySet<string>,
  index: SettingEntry[] = SETTINGS_INDEX,
): SettingHit[] {
  const q = normQ(query.trim());
  if (!q) return [];
  const starts: SettingHit[] = [];
  const inside: SettingHit[] = [];
  const byPlace: SettingHit[] = [];
  for (const e of index) {
    if (!roots.has(e.root)) continue;
    const label = t(e.label);
    const where = e.path.map(t).join(' › ');
    const hit = { key: `${e.screen}|${e.label}|${where}`, label, where, screen: e.screen };
    const at = normQ(label).indexOf(q);
    if (at === 0) starts.push(hit);
    else if (at > 0) inside.push(hit);
    else if (normQ(where).includes(q)) byPlace.push(hit);
  }
  return [...starts, ...inside, ...byPlace].slice(0, MAX_HITS);
}
