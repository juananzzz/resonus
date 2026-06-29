# Contributing to Resonus

Thanks for wanting to help! Resonus is an Android music player built with
Expo / React Native for Navidrome / OpenSubsonic / Ampache servers, plus a
local offline mode. This guide gets you from zero to a running app and a pull
request, even if you've never touched React Native.

## Prerequisites

- **Node.js 22 or newer** — <https://nodejs.org>
- **pnpm** — `npm install -g pnpm` (this project uses pnpm, not npm)
- **Git**
- **Android Studio** with the Android SDK and at least one emulator (an AVD),
  or a physical Android phone with USB debugging enabled. Android Studio also
  installs the JDK needed to build the app.

## Get the code

1. **Fork** the repo on GitHub (top-right "Fork"), then clone *your* fork:
   ```sh
   git clone https://github.com/<your-user>/resonus.git
   cd resonus
   ```
2. Install dependencies:
   ```sh
   pnpm install
   ```

## Run it on an emulator (or device)

Resonus ships custom native code, so it can't run in the Expo Go app — you
build your own dev app. It's the same flow most contributors use:

1. Open Android Studio → **Device Manager** and start an emulator (▶), or plug
   in a phone with USB debugging on.
2. Build, install and launch:
   ```sh
   pnpm android
   ```
   The **first run is slow**: it generates the native `android/` project and
   compiles with Gradle. Later runs are much faster.
3. For day-to-day **JS/TS changes you don't rebuild** — keep the dev server
   running and the app hot-reloads:
   ```sh
   pnpm start
   ```
   You only need `pnpm android` again when you change **native config**
   (`app.json` plugins, permissions, icons…). In that case regenerate first:
   ```sh
   pnpm expo prebuild --clean -p android && pnpm android
   ```

> The `android/` and `ios/` folders are **generated** and git-ignored (Expo
> Continuous Native Generation). Don't commit them or edit them by hand — change
> `app.json` or a config plugin instead.

## Before you commit

Both of these must pass — CI and reviewers expect them green:

```sh
pnpm typecheck
pnpm lint
```

Conventions:

- **TypeScript**, and match the style of the surrounding code.
- **Strings are translated**: the English text *is* the key. When you add a new
  user-facing string, add it to **both** `src/i18n/locales/en.json` (where key
  and value are identical) and `es.json` (with the Spanish translation), keeping
  the keys alphabetically sorted.
- **Commit messages in English.**

## Open a pull request

1. Create a branch:
   ```sh
   git checkout -b my-change
   ```
2. Commit your work.
3. Push to your fork:
   ```sh
   git push origin my-change
   ```
4. On GitHub, open a **Pull Request** against `main` of
   `juananzzz/resonus`. Describe **what** changed and **why**; for UI changes,
   a screenshot or screen recording really helps.

That's it — thanks for contributing! 🎵
