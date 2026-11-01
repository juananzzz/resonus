# Translating Resonus

Thanks for helping translate Resonus. If anything here is unclear, say so in your
pull request or ask on [Discord](https://discord.gg/pecE8MTPVr).

## How it works

Nothing here needs a toolchain: you edit one JSON file and open a pull request.
That is the whole of it.

1. **Fork** the repo, on GitHub.
2. **Edit your language's file**, `src/i18n/locales/<code>.json`. Right there in
   the GitHub editor is fine, and is how most of this app has been translated.
3. **Open a pull request.** A check runs on it straight away and tells you if
   something is off (a comma, a lost `{name}`) before anybody reviews it.

Partial is fine. Anything you don't translate falls back to English, so you can
do fifty strings today and fifty next month.

## Where to find out what a string means

This is the part worth knowing about, because a locale file on its own is a wall
of English words with nothing around them.

**[docs/TRANSLATION-CONTEXT.md](docs/TRANSLATION-CONTEXT.md)** lists **every
string in the app**, under the screen it shows up on, with what it means
wherever the English is ambiguous on its own:

| String | What it is |
| --- | --- |
| `Direction` | Sort sheet: the ascending vs descending toggle. Not a compass direction |
| `Plain` | A value of `Background`: a flat colour behind the player, no picture |
| `Free` | Free disk space in the storage bar (Other / Downloads / Free). Not "free of charge" |

Open it next to the file you are editing.

If you have Node and pnpm, `pnpm i18n:status <code>` says the same thing about
your file alone: everything still to do, each string under the screen it shows
up on and, where there is one, the note explaining it. The screen is worked out
from the code rather than written down, so it is there even for the strings
nobody has explained yet, and often it is the whole answer on its own.

If a string still isn't clear after that,
[tell us](#when-a-string-still-isnt-clear). The answer gets written into the
repo, not into a reply.

## If you'd rather work locally

Optional, and only worth it if you already have Node and pnpm. It writes a file
with just what is left to do, each string carrying that same context on the line
above it, which saves going back and forth to the page:

```sh
pnpm install
pnpm i18n:scaffold ru      # writes translate-ru.jsonc: everything still to do
                           # ...fill it in...
pnpm i18n:merge ru         # takes it back into src/i18n/locales/ru.json
pnpm i18n:status ru        # what is left
```

```jsonc
  // Settings › Player · A value of `Background`: a flat colour behind the player, no picture
  "Plain": "",

  // Favorites, Playlist · in useSongSort · Sort sheet: the ascending vs descending toggle. Not a compass direction
  "Direction": "",
```

`merge` skips every line you left empty, so a half-finished round only adds what
you actually translated and your pull request shows those lines and nothing
else.

## The rules

- The **English text is the key**. Each language has a JSON file in
  `src/i18n/locales/` mapping the English string to its translation.
- `{name}`, `{n}` and the like are **placeholders**: keep them exactly as they
  are and translate only the words around them.
- **A good translation reads naturally, it isn't literal.** If word-for-word
  would sound odd, adapt it: stay close to the *meaning*. "Quick grid" needn't
  contain the word for "grid", and folding two UI terms into one natural word
  is welcome.

## Adding a new language

1. Create `src/i18n/locales/<code>.json` with the strings you have translated
   (`{ "English text": "your translation" }`). Locally, `pnpm i18n:scaffold
   <code>` writes you the whole thing to fill in and `pnpm i18n:merge <code>`
   creates the file from it.
2. Add one row to `LANGUAGES` in `src/i18n/languages.ts`:
   `{ code: '<code>', name: '<native name>', dict: <import> }`. It is the single
   source of truth: the type, the settings picker and the persistence all come
   from it, so nothing else needs touching.
3. Add your language's words for "song", "album", "playlist", "artist" and
   "episode" to `PLURALS` in `src/i18n/index.ts`. Every language needs them,
   yours included: see below.
4. Add your language to the list in `README.md`, and yourself to
   [the table below](#translation-contributors).

Prefer not to touch the code? Open the PR with just the `.json` and your words
for those five, and we'll add the rows.

## Plurals

Counted strings like "3 songs" are not in your `.json` file. The noun goes with
the number, so each language keeps its own forms in `PLURALS`
(`src/i18n/index.ts`), and **every language needs its five entries there**: one
each under `song`, `album`, `playlist`, `artist` and `episode`. Without them the
counts under playlists, artists and downloads stay in English while the rest of
the app is in your language.

What is already set up for you is the *rule*, which works out when each form is
used. The *words* are the part you add:

```ts
song: { …, es: ['canción', 'canciones'] },
```

Most languages need **2** forms, one and other, in that order. If yours does not
change the noun at all, write the same word twice, the way German does:
`de: ['Titel', 'Titel']`.

Some need more: Russian, Ukrainian and Polish need **3**, and a language with
more than 2 also registers its rule in `PLURAL_RULE`. Russian's looks like this:

| Category | When | Example counts |
| --- | --- | --- |
| one  | `n%10 == 1 && n%100 != 11` | 1, 21, 31 |
| few  | `n%10` in 2–4 && `n%100` not in 12–14 | 2, 3, 4, 22 |
| many | everything else | 0, 5–20, 25 |

If a `{n}` string **baked into the JSON** doesn't inflect correctly in your
language, say so in your PR and we'll move it into the plural system.

## One English word, two words in your language

English `About` is one word; Russian needs a different one for *About the
artist* and *About the app*. Most languages translate the base key once and use
it everywhere. If yours needs to tell two uses apart, add an **override key**
shaped `Base::context`, only in your file:

```jsonc
"About": "Подробности",             // base: the fallback for every use
"About::artist": "Об исполнителе",  // only on the artist screen
"About::app": "О программе"          // only on the About-app screen
```

The app tries `::context` first and falls back to the base, so overrides are
always optional. `pnpm i18n:status <locale>` lists the ones available to you. If
a key needs a context that doesn't exist yet, tell us.

## When the greetings change over

Home greets you with `Good morning`, `Good afternoon`, `Good evening` or
`Good night`. **The hours they change at are part of the language too**: at six
in the evening English is well into the evening and Spanish is still in the
afternoon.

By default the morning starts at 5, the afternoon at noon and the evening at
6pm. Spanish and Catalan run later (6, 13, 21). It is three numbers rather than
text, so you cannot set it from your `.json`: **tell us yours in the PR** and we
add them to your row in `LANGUAGES`. If your language uses one word for two consecutive slots (Spanish
says "Buenas noches" for both), just translate both keys the same way.

## Checking what's left

```sh
pnpm i18n:status              # summary table for every language
pnpm i18n:status ru           # missing / same / stale, each with its screen
                              # and, where there is one, what it means
pnpm i18n:status --todo ru    # just the untranslated keys, one per line
```

- **missing**: not in your file yet (falls back to English).
- **same**: present but identical to the English (sometimes right, e.g.
  "Radio"; otherwise still to do).
- **stale**: in your file but no longer in English; safe to delete.

A string you had already done can come back as **missing**: it means the English
was reworded. The old translation is dropped rather than carried over, because
nobody has read the new sentence in your language yet, and a translation nobody
has checked sitting there looking finished is worse than a gap.

`pnpm i18n:status --gaps` is the other direction: the strings that have nothing
to go on but the screen they are on. If one of those was the one that stumped
you, that is exactly the one worth telling us about.

## When a string still isn't clear

**Tell us, and the answer goes in the file rather than in a reply.** Notes live
in [`src/i18n/context.jsonc`](src/i18n/context.jsonc), one line per string, and
from then on every translator of every language is shown it. Write it yourself
in your PR if you like:

```jsonc
"Rate": "Verb: rate the song with stars. Not \"bitrate\"",
```

That file also holds `keepEnglish`, for any string meant to **stay in English**.
Those aren't counted as missing. The list is empty today.

## If the English itself reads badly

Say so. You are reading these sentences more carefully than anyone else does,
and an awkward one in the source becomes an awkward one in every language. It has
happened: "Show what a playlist says about itself, under its name" was flagged
by a translator and is now "Show playlist and album descriptions under their names".

Say it in your pull request or on Discord. You don't have to change it
yourself. When one is reworded its translations are dropped and turn up as
missing, so it is much better said early than translated around.

## Translation contributors

| Language | Contributor(s) |
| --- | --- |
| English | [juananzzz](https://github.com/juananzzz) |
| Español | [juananzzz](https://github.com/juananzzz) |
| Deutsch | [Psychotoxical](https://github.com/Psychotoxical), [CraftoHohenvels](https://github.com/CraftoHohenvels) |
| Català | [juananzzz](https://github.com/juananzzz) |
| Русский | [ztx-lyghters](https://github.com/ztx-lyghters) |
| Italiano | [Anakin-bb8](https://github.com/Anakin-bb8) |
| 简体中文 | [xcdmrCHP](https://github.com/xcdmrCHP) |
| Українська | [albedych](https://github.com/albedych) |
| Polski | [pegaz19803-spec](https://github.com/pegaz19803-spec) |
| Svenska | [Jonatan Nyberg](https://github.com/NickWick13) |
| Português (Brasil) | [Victor Santos](https://github.com/vicsantus) |
| Türkçe | [Section](https://github.com/sectns) |
| Français | [Willyflam](https://github.com/Willyflam) |
