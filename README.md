# Resonus 🎵

Reproductor de música para Android que se conecta a tu propio servidor
[Navidrome](https://www.navidrome.org/) (a través de la API Subsonic). Una
alternativa sencilla y de código abierto, con la estética de un reproductor
moderno pero centrada en lo esencial.

> Hecho con [Expo](https://expo.dev) (React Native + TypeScript).

## Características (MVP)

- 🔐 Inicio de sesión contra cualquier servidor Navidrome/Subsonic. Las
  credenciales se guardan cifradas en el dispositivo (token, nunca la
  contraseña en claro).
- 🏠 Inicio con álbumes recientes, más escuchados y aleatorios.
- 🔎 Búsqueda de álbumes y canciones.
- 📚 Tus listas de reproducción.
- ▶️ Reproductor con cola, play/pausa, anterior/siguiente, barra de progreso
  y reproducción en segundo plano.

### Todavía no incluido

Descargas offline, letras, scrobbling a Last.fm, ecualizador y controles
completos en la pantalla de bloqueo (esto último requiere migrar a
`react-native-track-player` con un *dev build*).

## Requisitos

- [Node.js](https://nodejs.org) 20+ y [pnpm](https://pnpm.io).
- La app [Expo Go](https://expo.dev/go) en tu móvil Android (para desarrollo).
- Un servidor Navidrome accesible.

## Puesta en marcha

```bash
pnpm install
pnpm start
```

Escanea el código QR con la app **Expo Go** (móvil y PC en la misma red). En la
pantalla de login introduce la URL de tu servidor, usuario y contraseña.

## Generar el APK

No hace falta el SDK de Android en local: se compila en la nube con
[EAS Build](https://docs.expo.dev/build/introduction/).

```bash
pnpm dlx eas-cli build -p android --profile preview
```

## Estructura

```
src/
├── api/subsonic.ts     Cliente de la API Subsonic (auth, álbumes, búsqueda…)
├── store/              Estado global con Zustand (sesión y reproductor)
├── lib/                Utilidades (cliente de queries, formato)
├── components/         Componentes de UI reutilizables
├── theme/              Colores, espaciados y tipografías
└── app/                Pantallas y navegación (expo-router)
```

## Licencia

[MIT](./LICENSE) © juananzzz
