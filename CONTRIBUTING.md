# Contributing to Resonus

Resonus is a music player built with Expo / React Native for Navidrome,
OpenSubsonic, Jellyfin and Ampache servers, plus a local mode with no server.
Android comes first, and there is an experimental iOS build. This guide gets
you from zero to a running app on Android and a pull request.

## Prerequisites

- **Node.js 24**: <https://nodejs.org>. It is what the checks run on. The app
  also builds on 22, but `pnpm test` needs a Node that strips TypeScript types
  on its own.
- **pnpm**: `npm install -g pnpm`. Not optional and not interchangeable with
  npm or yarn: this project patches several of its dependencies (`patches/`,
  above all `expo-audio.patch`, which adds the gapless, lock screen and
  equalizer hooks the app is built on), and pnpm is what applies them. Install
  with anything else and the app will fail to compile in files you never
  touched.
- **JDK 17**: what CI builds with. Android Studio ships one; if you have
  several, point `JAVA_HOME` at 17. Newer JDKs fail with Gradle errors that
  don't say what is wrong.
- **Git**
- **Android Studio** with the Android SDK and at least one emulator (an AVD),
  or a physical Android phone with USB debugging enabled.

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

Resonus ships custom native code, so it can't run in the Expo Go app. You
build your own dev app:

1. Open Android Studio, go to **Device Manager** and start an emulator, or
   plug in a phone with USB debugging on.
2. Build, install and launch:
   ```sh
   pnpm android
   ```
   The **first run is slow**: it generates the native `android/` project and
   compiles with Gradle. Later runs are much faster.
3. For day-to-day **JS/TS changes you don't rebuild**. Keep the dev server
   running and the app hot-reloads:
   ```sh
   pnpm start
   ```
   You only need `pnpm android` again when you change **native config**
   (`app.json` plugins, permissions, icons…) or native code. In that case
   regenerate first:
   ```sh
   pnpm expo prebuild --clean -p android && pnpm android
   ```

> The `android/` and `ios/` folders are **generated** and git-ignored (Expo
> Continuous Native Generation). Don't commit them or edit them by hand;
> change `app.json` or a config plugin instead.

### If the build fails

Reproduce what CI does, which is known to work: Node 22, JDK 17,
`pnpm install --frozen-lockfile`, `pnpm expo prebuild --clean -p android`,
`pnpm android`. See `.github/workflows/release.yml`.

The two usual causes are at the top of this page: a package manager that is not
pnpm, and a JDK that is not 17. If it still fails, open an issue with the last
forty lines of the output rather than a description of it. Gradle errors are
only useful verbatim.

Building an APK to try a change is the slowest way to work and gives you no
logs. It is worth the twenty minutes it takes to get `pnpm android` running.

## Native code

The Expo Modules in `modules/` are ordinary Android Kotlin, plus Swift for the
few that also run on iOS:

| Module | What it does | Platforms |
| --- | --- | --- |
| `alac-decoder` | FFmpeg ALAC decoder for devices that lack one ([README](modules/alac-decoder/README.md)) | Android |
| `apk-install` | Hands a downloaded update to Android's installer | Android |
| `app-locale` | The app's language in Android's per-app language setting | Android |
| `audio-eq` | The system equalizer over the app's audio | Android |
| `audio-route` | Which output the audio is going to | Android, iOS |
| `battery-opt` | Reads and opens Android's battery optimisation settings | Android |
| `car-auto` | Android Auto: the browse tree and the media session | Android |
| `cast-media` | The media session used while casting | Android |
| `cover-clip` | Animated album covers | iOS |
| `home-widget` | The home screen widget | Android, iOS |
| `local-http` | A local server, so renderers can stream music from the phone | Android |
| `material-you` | Reads the accent color Android derives from the wallpaper | Android |
| `radio-art` | Draws the cover image of the mixes started from a song or artist | Android, iOS |
| `upnp-cast` | Finding UPnP/DLNA renderers and playing to them ([Sonos guide](docs/SONOS_INTEGRATION.md)) | Android |

Changing any of them means a rebuild (`pnpm android`); Metro does not hot-reload
native code. To compile just one while you iterate:

```sh
cd android && ./gradlew :car-auto:compileDebugKotlin
```

Reading their logs:

```sh
adb logcat -s CarAuto     # the Android Auto module
adb logcat | grep -i resonus
```

`modules/car-auto/.../CarAutoLog.kt` has a `verbose` flag, on in debug builds
and off in release builds. It traces browse and playback from the car.

## Android Auto

**An emulator will not do.** Android Auto has to be the real app, and the
system images only carry a stub, so testing needs a phone. What replaces the
car is the **Desktop Head Unit**:

1. Install "Android Auto Desktop Head Unit Emulator" from the Android Studio SDK
   Manager. It lands in `$ANDROID_HOME/extras/google/auto/`.
2. On your machine, with the phone connected by USB:
   ```sh
   adb forward tcp:5277 tcp:5277
   ```
3. On the phone, in the Android Auto settings, tap the version number about ten
   times to unlock developer mode. In **Developer settings** turn on **Unknown
   sources**, so a locally built app shows up in the car's list. Then, from the
   overflow menu, choose **Start head unit server**.
4. Back on your machine, from a terminal in the foreground:
   ```sh
   cd $ANDROID_HOME/extras/google/auto && ./desktop-head-unit
   ```

The head unit server only lasts one session. If the head unit is stuck on
`waiting for phone`, or after you reinstall the app, force stop Android Auto on
the phone and repeat from step 3.

The logcat ring buffer survives the car disconnecting, so a real drive can be
read afterwards by plugging the phone in and running `adb logcat -d -s CarAuto`.

## Before you commit

All of these run on every pull request and must pass:

```sh
pnpm typecheck
pnpm lint        # fails on errors; the warnings are known, leave them
pnpm test
pnpm i18n:check  # if the change touches src/
```

`pnpm i18n:check` reads strings and where they are used off the code, so moving
a `t()` call can fail it even if you changed no text. If it says
`docs/TRANSLATION-CONTEXT.md` is out of date, run `pnpm i18n:docs` and commit the
result.

`pnpm test` only reaches pure logic ([test/README.md](test/README.md) says what
it can and cannot cover). Nearly everything else here is UI or device
integration (the audio session, Android Auto, UPnP, the file system, a server on
the other end), and that is checked by using the app rather than mocked. So a
pull request says what was actually tried and what was not: "tested on a Pixel
with Navidrome, not tested offline" is worth more than a green checkmark.

Conventions:

- **TypeScript**, and match the style of the surrounding code.
- **Comments explain why, not what.** They are the fastest way into this
  codebase, and the reason a decision was made outlives the code that made it.
- **Everything in English**: comments, commit messages, docs.
- **Strings are translated**: the English text *is* the key. Add new
  user-facing strings to `en.json`, `es.json` and `ca.json` in
  `src/i18n/locales/`, appended where they belong rather than sorted: the
  files are not alphabetical, and reordering one buries your change in the
  diff.
  **Do not touch `de.json`, `it.json` or `ru.json`**: they have their own
  translators, and a missing string is the signal that reaches them. See
  [TRANSLATING.md](TRANSLATING.md) for plurals and context, and check where a
  language stands with:
  ```sh
  pnpm i18n:status
  ```
  **If the English is ambiguous on its own**, add a line to
  `src/i18n/context.jsonc` saying what it is, and run `pnpm i18n:docs`.
  `Direction` is a sort order and not a compass; `Rate` is a verb and not a
  bitrate. That one line is what every translator of every language gets
  shown next to the string, and writing it while you still remember costs less
  than answering the question five times. Where the string shows up is worked
  out from your code, so that part needs nothing. `pnpm i18n:status --gaps`
  lists the strings that have no note yet, for reading down and spotting the
  ones that need one.
  **To reword a string that is already in**, don't edit it by hand: the English
  text is the key, so it lives in the call, in three locale files, in the notes
  and in the generated page. `pnpm i18n:rename "old text" "new text"` does all
  of it, and drops the translations of the languages that had one so they come
  back as missing for their translators.

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
   a screenshot or screen recording helps.

One change per pull request. A branch that fixes a bug and also renames things
and also adds a setting is three reviews at once, and the one thing that turns
out to be wrong holds up the two that were right.

