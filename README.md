<p align="center">
  <img src="./assets/images/icon-transparent.png" width="120" alt="Resonus icon" />
</p>

<h1 align="center">Resonus</h1>

<p align="center">
  A clean Android music player for your self-hosted server — and your local files.
</p>

---

Resonus connects to **Navidrome** or any **OpenSubsonic**-compatible server (Subsonic API), or plays the **music stored on your device**. Browse, search, build queues and listen with background playback, lock-screen controls and **Android Auto**.

## Features

- 🎵 **Navidrome / OpenSubsonic** — multi-profile login (several servers + local).
- 📱 **Local mode** — play music from a folder or the whole device, fully offline. Albums grouped by folder, embedded artwork, and a cached catalog so it doesn't re-scan every time.
- 🔎 **Browse & search** — home, artists (top songs, albums, similar), albums, genres, playlists, favorites.
- ▶️ **Playback** — background playback, lock-screen & notification controls, queue, shuffle/repeat, sleep timer, lyrics.
- 🚗 **Android Auto** — browse your library and control playback from the car.
- ☁️ **Queue sync** — resume where you left off across devices (`savePlayQueue` / `getPlayQueue`).

## Tech

Expo (React Native + TypeScript, New Architecture), expo-router, Zustand, TanStack Query, expo-audio, Media3 (Android Auto module under `modules/car-auto`).

## Run (dev)

```sh
pnpm install
pnpm expo prebuild --clean -p android   # only after native / app.json changes
pnpm android                            # build, install and start Metro
```

## Roadmap

- [ ] Offline downloads (server → device)
- [ ] Equalizer & crossfade
- [ ] Jellyfin support
- [ ] iOS support

## License

[MIT](./LICENSE) © juananzzz
