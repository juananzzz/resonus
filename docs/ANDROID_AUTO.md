# Android Auto — implementation plan

Goal: add Android Auto (browse + playback controls in the car) to Resonus.

## Progress

- **Phase 1 (browse-only spike) — in progress.** Ported wavio's `car-auto`
  module into `modules/car-auto/` (local Expo module, autolinked). Kotlin
  compiles clean against Media3 **1.8.0** (the version RNTP 5 already pulls —
  do NOT use wavio's 1.4.1, it would clash). Service renamed to
  `ResonusCarBrowserService`. JS bridge at `src/lib/carAuto.ts`; a dummy tree is
  pushed on startup (`pushDummyTreeForSpike`) to verify browse in the emulator.
- **Testing without a car/DHU**: use the **Android Automotive OS (AAOS)**
  emulator. A media app exposes the *same* `MediaBrowserService` to both AA
  projection and AAOS, so the AAOS emulator validates browse + controls.
  Image: `system-images;android-34-ext9;android-automotive-playstore;x86_64`;
  AVD `resonus_car`. (DHU + a real phone is only needed for AA *projection*.)
  Run: boot `resonus_car`, then `pnpm android` targeting it; open the car's
  Media app and look for Resonus + the dummy tree.
- Still TODO: real browse tree from the data layer (phase 2), engine swap
  RNTP→expo-audio + JsProxyPlayer wiring (phase 3), final manifest polish (4).

Reference: the open-source app **wavio** (MIT) by Joel-Mercier solves this
cleanly: https://github.com/Joel-Mercier/wavio — see `apps/mobile/modules/car-auto`.
We can adapt its Kotlin with attribution.

## The architecture (how wavio does it)

A single **local Expo native module** in Kotlin that owns ONE Media3
`MediaLibrarySession`, which provides **both** the lock-screen/notification
controls **and** the Android Auto browse UI — **without a second audio engine**.
The real audio output stays in JS (`expo-audio`).

Pieces (under `apps/mobile/modules/car-auto/`):

- **`WavioCarBrowserService`** — a `MediaLibraryService` (Media3). Exposes the
  JS-built browse tree to Android Auto (`onGetLibraryRoot`/`onGetChildren` in a
  `MediaLibrarySession.Callback`). Its player is the `JsProxyPlayer`.
- **`JsProxyPlayer`** — a Media3 `SimpleBasePlayer` whose state is **pushed from
  JS** and whose transport commands (play/pause/next/prev/seek) are **forwarded
  back to JS** via module events. It does NOT decode audio.
- **`BrowseTreeCache`** — stores the JS-provided tree (and persists to disk).
- **`CarArtwork`** — loads cover art for the car UI.
- **`CarAutoModule`** (Expo `Module`) — the JS↔native bridge. JS functions:
  - `setNodes(json)` — push the browse tree (root → playlists/albums/artists/songs).
  - `setNowPlaying(json)`, `setQueue(json)`, `setQueueIndex(n)`,
    `setPlaybackState(json)` — keep the native session in sync with JS playback.
  - Emits events `"play"` (a leaf was tapped → mediaId + parent) and
    `"transport"` (a transport button was pressed) → JS reacts and drives audio.
- **`expo-module.config.json`** registers `expo.modules.carauto.CarAutoModule`.
- Manifest: a `<service>` for the MediaLibraryService with the
  `androidx.media3.session.MediaLibraryService` / `android.media.browse.MediaBrowserService`
  intent filter, plus `res/xml/automotive_app_desc.xml` and the
  `com.google.android.gms.car.application` `<meta-data>`.

## What it means for Resonus

- **No language change, no app/UI rewrite.** Screens, stores, Subsonic client,
  i18n stay. We add a Kotlin native module + a JS bridge service.
- **The audio engine changes**: this pattern uses `expo-audio` as the output and
  the native `MediaLibrarySession` as the single control surface. So we would
  **revert the react-native-track-player migration back to `expo-audio`** — the
  car-auto session would then provide lock-screen + notification + Android Auto.
  The player store's public API can stay the same; only its internals change
  (drive expo-audio + push state to `CarAuto.*`, listen to `play`/`transport`).

## Phases

1. **Revert RNTP → expo-audio** as the audio output (wavio patches expo-audio —
   check `patches/expo-audio@*.patch` there).
2. **Port the `car-auto` module** (the ~6 Kotlin files + `index.ts` +
   `expo-module.config.json`), adapted to our store. It lives in
   `modules/car-auto/` and is picked up by expo-modules-autolinking.
3. **Build the browse tree from Subsonic** (playlists, albums, artists, songs)
   and push it with `setNodes`; keep `setNowPlaying/setQueue/setPlaybackState`
   in sync from the player store; handle `play`/`transport` events.
4. **Android Auto manifest**: service declaration + `automotive_app_desc.xml` +
   `com.google.android.gms.car.application` meta-data.
5. **Test with the DHU** (Desktop Head Unit) — `~/Android/Sdk` →
   `extras/google/auto/desktop-head-unit`. Enable "Unknown sources" in the
   Android Auto app's developer settings, run `adb forward tcp:5277 tcp:5277`.

## Notes / gotchas

- Requires a **development build** (native module). Already the case for us.
- New Architecture: verify the module compiles under it (we're on it).
- Only one MediaSession should be active — that's why RNTP is dropped in this
  design (it brings its own session).
- iOS CarPlay is a separate thing (wavio uses `react-native-carplay`).
