/**
 * The manifest declaration that lets other apps (KWGT, launchers) see Resonus
 * as a music player: ACTION_MAIN + CATEGORY_APP_MUSIC on the main activity.
 *
 * The category has to sit on the launcher filter itself, not on a separate
 * MAIN-only filter, because a detector that walks the launcher entry's
 * categories never sees the second one. See plugins/withMusicPlayer.js.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);
const { ensureMusicCategory } = require('../plugins/withMusicPlayer.js') as {
  ensureMusicCategory: (manifest: unknown) => boolean;
};

const ACTION_MAIN = 'android.intent.action.MAIN';
const ACTION_VIEW = 'android.intent.action.VIEW';
const CATEGORY_LAUNCHER = 'android.intent.category.LAUNCHER';
const CATEGORY_DEFAULT = 'android.intent.category.DEFAULT';
const CATEGORY_APP_MUSIC = 'android.intent.category.APP_MUSIC';

function category(name: string) {
  return { $: { 'android:name': name } };
}

function filter(action: string, categories: string[]) {
  return {
    action: [{ $: { 'android:name': action } }],
    category: categories.map(category),
  };
}

function manifestWith(filters: unknown[]) {
  return {
    manifest: {
      application: [
        {
          activity: [
            {
              $: { 'android:name': '.MainActivity' },
              'intent-filter': filters,
            },
          ],
        },
      ],
    },
  };
}

function names(nodes: { $?: { 'android:name'?: string } }[] | undefined) {
  return (nodes ?? []).map((node) => node.$?.['android:name']);
}

function filtersOf(manifest: any) {
  return manifest.manifest.application[0].activity[0]['intent-filter'];
}

describe('ensureMusicCategory', () => {
  it('puts APP_MUSIC on the launcher filter', () => {
    const manifest = manifestWith([
      filter(ACTION_MAIN, [CATEGORY_LAUNCHER]),
      filter(ACTION_VIEW, [CATEGORY_DEFAULT]),
    ]);

    assert.equal(ensureMusicCategory(manifest), true);

    const launcher = filtersOf(manifest).find(
      (item: any) => names(item.action).includes(ACTION_MAIN),
    );
    assert.deepEqual(names(launcher.category), [CATEGORY_LAUNCHER, CATEGORY_APP_MUSIC]);
    const view = filtersOf(manifest).find((item: any) => names(item.action).includes(ACTION_VIEW));
    assert.deepEqual(names(view.category), [CATEGORY_DEFAULT]);
  });

  it('does not add a second category when it is already there', () => {
    const manifest = manifestWith([
      filter(ACTION_MAIN, [CATEGORY_LAUNCHER, CATEGORY_APP_MUSIC]),
    ]);

    assert.equal(ensureMusicCategory(manifest), false);
    assert.deepEqual(names(filtersOf(manifest)[0].category), [
      CATEGORY_LAUNCHER,
      CATEGORY_APP_MUSIC,
    ]);
  });

  it('creates the launcher filter when the template has none', () => {
    const manifest = manifestWith([]);

    assert.equal(ensureMusicCategory(manifest), true);
    assert.deepEqual(names(filtersOf(manifest)[0].action), [ACTION_MAIN]);
    assert.deepEqual(names(filtersOf(manifest)[0].category), [
      CATEGORY_LAUNCHER,
      CATEGORY_APP_MUSIC,
    ]);
  });
});
