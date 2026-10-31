# Publishing a release (APK on GitHub Releases)

The APK is built and published by GitHub Actions (`.github/workflows/release.yml`)
when a `v*` tag is pushed. The workflow runs `expo prebuild` + `gradlew assembleRelease`,
signing with your keystore (kept in the repo Secrets), and creates a **draft**
Release with the APK attached, so you can review it before publishing.

## Once: keystore + secrets

1. Generate your release keystore (keep it and back it up! If you lose it you
   will not be able to update the app for anyone who already has it installed):

   ```sh
   keytool -genkeypair -v -keystore resonus-release.jks \
     -alias resonus -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Convert it to base64 (a single line):

   ```sh
   base64 -w0 resonus-release.jks > keystore.b64
   ```

3. On GitHub: **Settings → Secrets and variables → Actions → New repository secret**,
   create these four:

   | Secret | Value |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | contents of `keystore.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `resonus` |
   | `ANDROID_KEY_PASSWORD` | the key password |

   The keystore and `keystore.b64` are **not** committed to git.

## Every release

1. Bump the version in `app.json`: `expo.version` (visible name) and
   `expo.android.versionCode` (an integer, it must **increase** with every release).
   In `CHANGELOG.md`, move what is under `Unreleased` to a section for that version.
2. Generate the F-Droid notes with `pnpm fastlane:changelog`: they come from
   that version's section of `CHANGELOG.md` and go to
   `fastlane/metadata/android/en-US/changelogs/`. F-Droid reads them from the
   tagged commit, so they have to be in before the tag is created.
3. Commit, create the tag and push it:

   ```sh
   git tag v0.1.0-beta
   git push origin v0.1.0-beta
   ```

4. The workflow builds the APK and creates a **draft** Release with
   `resonus-v0.1.0-beta.apk`. The same tag triggers
   `.github/workflows/unsignedipa.yaml`, which attaches `resonus-v0.1.0-beta.ipa`
   to that same draft. Open it in the Releases tab, review the notes and
   press **Publish**.
5. Publishing it adds the version to `Source.json`, through
   `.github/workflows/altstore-source.yml`, unless it is marked as a pre-release.
   Check that the commit lands on `main`; to rerun it, start that workflow by
   hand with the tag.

To hand somebody a build without a release, run the **Test APK** workflow
(`.github/workflows/test-apk.yml`) from the Actions tab on any branch and send
them the link to the run.

## `Source.json`: the iOS source

`Source.json`, at the repo root, is the AltStore/SideStore source the iOS
version is installed from. The workflow keeps it up to date, but if you ever
edit it by hand:

- **Do not move or rename it.** Its URL is saved inside the AltStore of everyone
  subscribed to the source, so changing it breaks it for all of them at once and
  there is no way to tell them. For the same reason, the link handed out has to
  be the `raw.githubusercontent.com` one: the `blob` URL returns GitHub's HTML
  page and AltStore expects JSON.
- **A new entry goes first in the `versions` array**: AltStore takes the first
  one as the latest version, so one added at the end leaves the file valid and
  nobody updated.

Each entry has `version`, `date` in ISO 8601, `size` in bytes, the
`downloadURL` of the Release's `.ipa` and `localizedDescription` with that
version's changelog in plain text. The workflow fills them all in from the
Release and `CHANGELOG.md`, so a version needs its section there before it is
published.

## Notes

- Signing is injected by the `plugins/withReleaseSigning.js` config plugin during
  prebuild (the `android/` folder is in `.gitignore` and is regenerated). In local
  builds without those environment variables, the release is still signed with the
  debug key, so development is not affected.
- The APK is universal but only with real device architectures
  (`armeabi-v7a` + `arm64-v8a`); x86/x86_64 (emulators) are left out to keep it
  smaller. The release is also minified with R8 (`enableProguardInReleaseBuilds`
  and `enableShrinkResourcesInReleaseBuilds` in `app.json`).
