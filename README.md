# Resonus 🎵

An open-source Android music player that connects to your own
[Navidrome](https://www.navidrome.org/) server (via the Subsonic API). A simple,
Spotify-style client focused on the essentials.

> Built with [Expo](https://expo.dev) (React Native + TypeScript).
>
> ⚡ **Vibe-coded** — this whole app was built collaboratively with an AI coding
> assistant ([Claude Code](https://claude.com/claude-code)), prompt by prompt.

## Features

- 🔐 Log in to any Navidrome/Subsonic server (token-based auth, stored
  encrypted). **Multiple saved profiles** to switch between accounts.
- 🏠 Home with recently played, recently added and most played albums, plus
  quick-access shortcuts.
- 🔎 Search for songs, albums and artists (debounced).
- 🎤 Artist pages with top songs, album grid and similar artists.
- 📚 Library with playlists, artists and a pinned **Favorites** shortcut.
- ❤️ Favorite/unfavorite tracks and artists (Subsonic star/unstar).
- 🎶 Per-track menu: add to playlist, play next, add to queue, go to
  album/artist, **lyrics**, sleep timer.
- 📝 **Lyrics** view (Subsonic `getLyrics`).
- ▶️ Player with editable queue, shuffle, repeat (off/all/one), volume, sleep
  timer and an always-visible mini player (dynamic colour from the artwork).
- 🔊 Background playback and **scrobbling** to the server (which can forward to
  Last.fm if your Navidrome is configured for it).
- ⚙️ Settings: streaming quality (bitrate), library scan status, clear cache.

### Not included (yet)

Offline downloads, equalizer, crossfade, and full lock-screen / notification
media controls. The last three need a native audio engine
(`react-native-track-player`) instead of `expo-audio`; offline downloads need a
local file/store layer.

## Requirements

- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io).
- A running Navidrome server reachable from the device.
- An Android emulator or device (see below).

## Getting started

```bash
pnpm install
pnpm android   # builds and runs on a connected emulator/device
```

For the dev server only: `pnpm start`. On the login screen enter your server
URL, username and password.

## Build a standalone APK

The whole Android toolchain is local — no cloud required:

```bash
# from the project, with an Android SDK + JDK 17 installed:
pnpm android --variant release
```

(Or use [EAS Build](https://docs.expo.dev/build/introduction/) with
`pnpm dlx eas-cli build -p android` for a cloud build.)

## Project structure

```
src/
├── api/subsonic.ts     Subsonic API client (auth, albums, artists, search, star…)
├── store/              Global state with Zustand (session and player)
├── lib/                Utilities (query client, storage, formatting)
├── hooks/              Reusable hooks (e.g. useDebounce)
├── components/         Reusable UI components
├── theme/              Colors, spacing and typography
└── app/                Screens and navigation (expo-router)
```

## License

[MIT](./LICENSE) © juananzzz
