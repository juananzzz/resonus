<p align="center">
  <img src="./assets/images/icon-transparent.png" width="120" alt="Resonus icon" />
</p>

<h1 align="center">Resonus</h1>

<p align="center">
  A clean Android client for your self-hosted music server.
</p>

---

Resonus connects to **Navidrome** or any **OpenSubsonic**-compatible server (Subsonic API). Browse your library, search, manage playlists, and play music with background playback and lock-screen controls.

## Getting started

Node.js 20+ and [pnpm](https://pnpm.io) required.

```bash
pnpm install
pnpm android    # builds and runs on a connected device/emulator
```

On the login screen, enter your server URL, username and password.

## Build an APK

```bash
pnpm android --variant release
```

Requires Android SDK and JDK 17 locally. For cloud builds, use `pnpm dlx eas-cli build -p android`.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | [Expo](https://expo.dev) SDK 55 + React Native 0.83 |
| Navigation | [expo-router](https://docs.expo.dev/router/introduction/) |
| Audio | [react-native-track-player](https://rntp.dev/) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Data | [TanStack Query](https://tanstack.com/query) |
| Language | TypeScript |

## Project structure

```
src/
├── api/          Subsonic API client
├── app/          Screens and navigation
├── components/   Reusable UI components
├── hooks/        Shared hooks
├── i18n/         Translations (Spanish / English)
├── lib/          Utilities
├── store/        Zustand stores
└── theme/        Colors, spacing, typography
```

## Scripts

| Command | Description |
|---|---|
| `pnpm start` | Start Metro dev server |
| `pnpm android` | Build and run on Android |
| `pnpm lint` | Run ESLint |
| `pnpm typecheck` | Type-check with TypeScript |

## Roadmap

- [ ] Android Auto
- [ ] Offline downloads
- [ ] Equalizer and crossfade
- [ ] Jellyfin support
- [ ] iOS support
- [ ] Unit tests

## License

[MIT](./LICENSE) © juananzzz
