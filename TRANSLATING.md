# Translating Resonus

Thanks for helping translate Resonus! If anything here is unclear, open an issue
or ask on [Discord](https://discord.gg/hpDfszr8r).

## How translations work

- The **English text is the key**. Each language has a JSON file in
  `src/i18n/locales/` mapping the English string to its translation.
- Anything not translated falls back to English, so a partial file is fine.
- `{name}`, `{n}`, etc. are **placeholders** — keep them exactly as-is; they get
  replaced at runtime. Only translate the words around them.
- JSON can't hold comments, so the per-string context lives in this file (see
  [String context](#string-context) below), not in the `.json`.

## Adding a new language

1. Create `src/i18n/locales/<code>.json` (English key → your translation).
2. Add one row to `LANGUAGES` in `src/i18n/languages.ts`: import your JSON and
   add `{ code: '<code>', name: '<native name>', dict: <import> }`. That's the
   single source of truth — the `Language` type, the display names, the settings
   picker and the persistence all derive from it, so **nothing else needs
   touching**.
3. Only if your language needs **more than 2** plural forms (one / other): add
   its forms to `PLURALS` and its rule to `PLURAL_RULE` in `src/i18n/index.ts`
   (see [Plurals](#plurals)).

Prefer not to touch the code? Just add the `.json` and open the PR — we'll add
the one-line row for you.

## Adapt for what sounds natural

**A good translation reads naturally, it isn't literal.** If a word-for-word
translation would sound odd, adapt it — stay close to the original *meaning*, not
the wording.

For example, "Quick grid" or "chips" needn't map to the literal words for
"grid"/"chip" if those sound wrong — an equivalent like "Quick access" is fine,
and folding a couple of UI terms into one natural word is welcome.

## Plurals

Counted strings like "3 songs" use per-language plural forms, not a single
template, so each language can inflect the noun correctly.

- Most languages need **2 forms** (one / other): English, Spanish, Catalan,
  German are set up this way in `PLURALS`.
- Some need **more**. Russian, for instance, needs **3** (one / few / many).
  The system supports this: give as many forms as your language's rule uses in
  `PLURALS`, and register the rule in `PLURAL_RULE` (`src/i18n/index.ts`).

Russian rule (CLDR):

| Category | When | Example counts |
| --- | --- | --- |
| one  | `n%10 == 1 && n%100 != 11` | 1, 21, 31 |
| few  | `n%10` in 2–4 && `n%100` not in 12–14 | 2, 3, 4, 22 |
| many | everything else | 0, 5–20, 25 |

If a `{n}` string **baked into the JSON** (not one of the counted labels above)
doesn't inflect correctly in your language, **list it in your PR or an issue** —
we'll move it into the plural system so it can be inflected properly.

## Gendered / context-dependent words

A single English key sometimes maps to several words in another language
depending on gender or context. "Unknown", for example, may need different forms
for an unknown *artist* vs *album* vs *title*. If that's the case, ask and we'll
**split the key** (e.g. `Unknown artist`, `Unknown album`) so each can be
translated correctly.

## Checking what's left to translate

Run the status script to see, per language, how much is done and exactly which
strings are still missing:

```
pnpm i18n:status              # summary table for every language
pnpm i18n:status ru           # details for one language (missing / same / stale)
pnpm i18n:status --todo ru    # just the untranslated keys, one per line
```

- **missing** — the key isn't in your file yet (it falls back to English).
- **same** — present but identical to the English text (sometimes that's correct,
  e.g. "Radio"; otherwise it still needs translating).
- **stale** — a key in your file that no longer exists in English; safe to delete.

## String context

Strings that are ambiguous on their own, grouped by where they show up. If one
tripped you up and isn't here, tell us.

**Sorting & filtering**

| String | Where / what it is |
| --- | --- |
| `Direction` | Sort sheet: the **ascending vs descending** toggle. Not a compass direction |
| `A-Z` / `Alphabetical` / `Ascending` / `Descending` | Sort options (order of a list) |
| `Filter artists` / `Filter genres` | Search box that **narrows** the list as you type |

**Library & scanning** (Settings → Library)

| String | Where / what it is |
| --- | --- |
| `Source` / `Change source` | The **music source** (which server, or local). Not source code |
| `Device` | A **music library/folder** exposed by the server |
| `Scan` / `Rescan` / `Scan status` | Trigger or check the **server's library scan** |
| `Local music` | Music stored **on the phone** |

**Settings section headers** (short titles grouping toggles)

| String | Where / what it is |
| --- | --- |
| `Elements` / `Buttons` | Settings → Player: which player **elements / buttons** to show |
| `Interaction` / `Interface` | Section headers in Settings → Personalization |
| `Extras` | Settings → Playback: extra playback options |
| `Size` / `Sources` | Settings → Quick grid: tile **size** / which **shortcuts** to show |
| `Layout` | The **list vs grid** layout of lists |

**Servers & network** (Login, Settings → Network)

| String | Where / what it is |
| --- | --- |
| `Advanced` | Login screen: link that expands the advanced connection options |
| `Local` / `Local profile` / `This phone` | The **on-device / offline profile** (no server account) |
| `Media server` | Login: the type subtitle under **Jellyfin** |
| `Subsonic-compatible` | Login: the subtitle under **OpenSubsonic / Ampache** |
| `Primary` / `Remote` | A server's **primary vs remote address** (profiles with several URLs) |
| `Server default` | Codec/quality option meaning **"let the server decide"** |
| `Offline · your downloads` | Settings subtitle shown in offline mode |

**Playback, audio & equalizer**

| String | Where / what it is |
| --- | --- |
| `By track` / `By album` | Volume-normalization (ReplayGain) modes: even out loudness per track / album |
| `Hi-Res` / `Lossless` | Audio-quality labels on the player. Keep the widely-understood terms |
| `Bands` / `Reset bands` | The equalizer's **frequency sliders** |
| `Preset` / `Custom` | An **equalizer preset**; "Custom" is the user's own. Not a bitrate |
| `Off` | A setting value meaning **disabled** (crossfade, normalization…) |

**Player, output & queue**

| String | Where / what it is |
| --- | --- |
| `Output` / `Devices` | **Audio output device** (phone / cast target) |
| `Colored background` | Tint the player with the **cover art color** |
| `Skip buttons` | The **seek forward / back** buttons setting |
| `Next` / `Previous` | Player controls: **next / previous track** (accessibility labels) |
| `Next in queue` | Queue screen header: the track playing next |
| `Show cover` | Lyrics screen: button to **go back to the cover art** |

**Artist, playlists & radio**

| String | Where / what it is |
| --- | --- |
| `Popular` | The artist's **popular / top tracks** |
| `Appears on` | Albums the artist **appears on** (features, compilations) |
| `Similar artists` | Related / similar artists |
| `Public playlist` | Toggle to make a playlist **public** on the server |
| `Change cover` | Replace the **cover image** of a playlist / station |
| `Name` | The **Name** field when editing a playlist or station |
| `Website (optional)` / `Stream URL` | Fields when adding a **radio station** |

**Home & personalization**

| String | Where / what it is |
| --- | --- |
| `Discover` | Home section: discovery **suggestions** |
| `Recents` | Library section: **recently opened** items |
| `Greeting` / `Custom greeting` | Home's "Good morning" line, and a **custom** replacement for it |
| `Quick grid` | The grid of **shortcut tiles** on Home |
| `Explore chips` | The row of tappable **category chips** |
| `Song menu` | The **⋯ menu** on a song; a setting picks which actions it shows |
| `Song lists` | The **appearance of song lists** setting |
| `Home sections` | Reorder which **sections appear on Home** |
| `Pin favorites` | Pin favorites to the quick grid |

**Actions & verbs** (easy to translate as the wrong part of speech)

| String | Where / what it is |
| --- | --- |
| `Rate` | Verb: **rate the song** with stars. Not "bitrate" |
| `Restore` | **Restore settings** to defaults |
| `Reorder` | Enter **drag-to-reorder** mode |
| `Turn off` | **Turn off the sleep timer** |
| `Start mix` | Start an auto-generated **radio mix** from this song |
| `More options` / `More` | The **⋯** button and a **"More" (see more)** action |

**Other**

| String | Where / what it is |
| --- | --- |
| `Free` | **Free disk space** in the storage bar (Other / Downloads / Free). Not "free of charge" |
| `Other` | In that same bar: space used by **things other than** downloads |
| `Nothing here is downloaded` | Toast when playing something not downloaded (offline) |
| `Try exploring another genre.` | Empty-state subtitle on a genre screen |
| `Unknown` | Fallback for a missing artist / album / title |
