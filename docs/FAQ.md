# FAQ

Not here? Ask on [Discord](https://discord.gg/pecE8MTPVr) or open an
[issue](https://github.com/juananzzz/resonus/issues).

## How do I get Resonus to show up in Android Auto?

Android Auto only lists apps it got from the Play Store, so it has to be told to
accept the rest. The switch is on the phone and you only set it once:

1. Open Android Auto's settings on the phone (Settings › Connected devices ›
   Android Auto, or the Android Auto app).
2. Tap **Version** about ten times, until it offers to turn on developer
   settings. Accept.
3. Go to **Developer settings** and turn on **Unknown sources**.
4. Connect the phone to the car again.

Resonus should be in the car's app list from then on.

## How do I install Resonus on iOS?

Resonus on iOS is an unsigned `.ipa` from the
[Releases](https://github.com/juananzzz/resonus/releases/latest) page, so it has
to be sideloaded. Any method that can install an unsigned `.ipa` works. These are
the ones we suggest:

1. **SideStore**
   - Official guide, needs a computer: [prerequisites](https://docs.sidestore.io/docs/installation/prerequisites), [installation](https://docs.sidestore.io/docs/installation/install)
   - Unofficial method, on the device with no computer: [SideInstaller guide](https://sideinstaller.net/)
2. **AltStore**
   - Official guide, needs a computer: [Windows](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows), [macOS](https://faq.altstore.io/altstore-classic/how-to-install-altstore-macos)

With either one you can
[add Resonus as an AltSource](https://altdirect.app/?url=https://raw.githubusercontent.com/juananzzz/resonus/main/Source.json)
to get updates.

## Is Resonus on F-Droid?

Not yet. Once it is, keep in mind that F-Droid builds the app itself and signs
it with its own key, so the APK from GitHub (or Obtainium) and the one from
F-Droid cannot update each other. Moving from one to the other means
uninstalling first; Settings › About › Export settings keeps your settings to
import afterwards. The F-Droid build is updated by F-Droid, a few days after
each release here, so it has no update check of its own.

## How do I get lyrics that light up word by word?

The lyrics have to be timed word by word, and a normal `.lrc` isn't: it only
times the lines. What works is a `.ttml` file (the format Apple Music uses) or
an enhanced `.lrc`, which has a `<mm:ss.xx>` in front of each word. Put it next
to the song with the same name, like `01 - Song.flac` and `01 - Song.ttml`.

- **Navidrome**: 0.63 or newer. It picks the file up on the next scan and sends
  the words to Resonus. Older versions only send whole lines.
- **Jellyfin**: when it has word timings for the song, Resonus uses them.
- **Music on the phone**: the same `.ttml` or `.lrc` next to the file.

Downloaded songs keep the word timings, so it works offline too. Songs you
downloaded before this was added only have whole lines until you download them
again.
