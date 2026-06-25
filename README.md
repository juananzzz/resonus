# Resonus 🎵

An open-source Android music player that connects to your own
[Navidrome](https://www.navidrome.org/) server (via the Subsonic API). A simple,
Spotify-style client focused on the essentials.

> Built with [Expo](https://expo.dev) (React Native + TypeScript).
>
> ⚡ **Vibe-coded** — this whole app was built collaboratively with an AI coding
> assistant ([Claude Code](https://claude.com/claude-code)), prompt by prompt.

## Features

- 🔐 Log in to any Navidrome/Subsonic server. Credentials are stored encrypted
  on the device (token-based auth — the password never travels in clear text).
- 🏠 Home with recently added, most played and random albums.
- 🔎 Search for songs, albums and artists (debounced).
- 🎤 Browse artists and their albums.
- 📚 Library with playlists, artists and a pinned **Favorites** shortcut.
- ❤️ Favorite/unfavorite tracks and artists (Subsonic star/unstar).
- ▶️ Player with queue, shuffle, repeat (off/all/one), progress bar, background
  playback and an always-visible mini player (Spotify-style).

### Not included (yet)

Offline downloads, lyrics, Last.fm scrobbling, equalizer, and full lock-screen
media controls (the latter needs migrating from `expo-audio` to
`react-native-track-player`).

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
