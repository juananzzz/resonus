# Resonus 🎵

An open-source Android music player for your own self-hosted music server.
A clean, Spotify-style client focused on the essentials.

Works with **Navidrome** and any **OpenSubsonic**-compatible server (Subsonic
API). Jellyfin support is planned.

> ⚡ **Vibe-coded** — this whole app was built collaboratively with an AI coding
> assistant ([Claude Code](https://claude.com/claude-code)), prompt by prompt.

## Features

- 🔐 **Log in** to any Navidrome / OpenSubsonic server (token-based auth, stored
  encrypted). **Multiple saved profiles** to switch between accounts.
- 🏠 **Home** with recently played, recently added and most played albums, plus
  quick-access shortcuts.
- 🔎 **Search** for songs, albums and artists (debounced).
- 🎤 **Artist** pages with top songs, an album grid and similar artists.
- 📚 **Library** with playlists, artists and a pinned Favorites shortcut.
- ❤️ **Favorites** — star/unstar tracks and artists (Subsonic star/unstar).
- 🎶 **Per-track menu**: add to playlist, play next, add to queue, go to
  album/artist, lyrics, sleep timer.
- 📝 **Lyrics** view.
- ▶️ **Player** with editable queue, shuffle, repeat (off/all/one), volume, a
  sleep timer and an always-visible mini player (dynamic colour from the
  artwork).
- 🔊 **Background playback** with lock-screen / notification media controls.
- 📡 **Scrobbling** to the server (which can forward to Last.fm if your server
  is configured for it).
- 🌍 **Spanish & English** (in-app language switch; easy to add more).
- ⚙️ **Settings**: streaming quality (bitrate), library scan status, clear cache.

### Not included (yet)

Offline downloads, equalizer and crossfade. The latter two need custom native
audio work; offline downloads need a local file/store layer.

## Tech stack

- [Expo](https://expo.dev) SDK 55 (React Native 0.83, New Architecture) + TypeScript
- [expo-router](https://docs.expo.dev/router/introduction/) for file-based navigation
- [react-native-track-player](https://rntp.dev/) for audio + media controls
- [Zustand](https://zustand-demo.pmnd.rs/) for state, [TanStack Query](https://tanstack.com/query) for data fetching
- A small hand-rolled Subsonic API client and i18n layer

## Requirements

- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io)
- A running Navidrome / OpenSubsonic server reachable from the device
- An Android emulator or device

## Getting started

```bash
pnpm install
pnpm android   # builds and runs on a connected emulator/device
```

For just the dev server: `pnpm start`. On the login screen pick your server
type and enter its URL, username and password.

## Build a standalone APK

The whole Android toolchain is local — no cloud account required:

```bash
# with an Android SDK + JDK 17 installed:
pnpm android --variant release
```

(Or use [EAS Build](https://docs.expo.dev/build/introduction/) with
`pnpm dlx eas-cli build -p android` for a cloud build.)

## Project structure

```
src/
├── api/          Subsonic API client (auth, albums, artists, search, star…)
├── app/          Screens and navigation (expo-router)
├── components/   Reusable UI components
├── hooks/        Reusable hooks (useDebounce, useDominantColor)
├── i18n/         Translations and the useT() hook
├── lib/          Utilities (query client, storage, playback service, format)
├── store/        Global state with Zustand (auth, player, settings, …)
└── theme/        Colors, spacing, typography and layout constants
```

## Scripts

| Command | Description |
|---|---|
| `pnpm android` | Build and run on Android |
| `pnpm start` | Start the Metro dev server |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Type-check with `tsc` |

## License

[MIT](./LICENSE) © juananzzz
