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

- **Navidrome / OpenSubsonic** — multi-profile login (several servers + local).
- **Local mode** — play music from a folder or the whole device, fully offline. Albums grouped by folder, embedded artwork, and a cached catalog so it doesn't re-scan every time.
- **Browse & search** — home, artists (top songs, albums, similar), albums, genres, playlists, favorites.
- **Playback** — background playback, lock-screen & notification controls, queue, shuffle/repeat, sleep timer, lyrics.
- **Android Auto** — browse your library and control playback from the car.
- **Queue sync** — resume where you left off across devices.

## Roadmap

- [ ] Offline downloads (server → device)
- [ ] Equalizer & crossfade
- [ ] Local artwork in Android Auto
- [ ] Ampache support
- [ ] Jellyfin support
- [ ] iOS support

## Translations

Resonus ships in **English and Spanish**, both maintained by the project in the
repository (`src/i18n/locales/en.json` and `es.json`). English is the source
language.

All other languages are open to the community through
[Crowdin](https://crowdin.com/project/resonus), and help is very welcome.

[![Crowdin](https://badges.crowdin.net/resonus/localized.svg)](https://crowdin.com/project/resonus)

To contribute a translation:

1. Open the [Crowdin project](https://crowdin.com/project/resonus) and sign in (it's free).
2. Pick your language — or request a new one if it isn't listed yet.
3. Translate the strings in the web editor. No coding or git needed.

Crowdin syncs translations back to the repository automatically via pull
requests, adding a `src/i18n/locales/<lang>.json` file once a language has real
translations. (English and Spanish aren't listed on Crowdin because they're
maintained directly in the code.)

## License

[MIT](./LICENSE) © juananzzz
