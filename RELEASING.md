# Publicar una release (APK en GitHub Releases)

El APK se genera y se publica con GitHub Actions (`.github/workflows/release.yml`)
al empujar un tag `v*`. El workflow hace `expo prebuild` + `gradlew assembleRelease`
firmando con tu keystore (guardada en los Secrets del repo) y crea un **borrador**
de Release con el APK adjunto, para que lo revises antes de publicarlo.

## Una sola vez: keystore + secrets

1. Genera tu keystore de release (¡guárdala y haz copia! si la pierdes no podrás
   actualizar la app para quien ya la tenga instalada):

   ```sh
   keytool -genkeypair -v -keystore resonus-release.jks \
     -alias resonus -keyalg RSA -keysize 2048 -validity 10000
   ```

2. Pásala a base64 (una sola línea):

   ```sh
   base64 -w0 resonus-release.jks > keystore.b64
   ```

3. En GitHub: **Settings → Secrets and variables → Actions → New repository secret**,
   crea estos cuatro:

   | Secret | Valor |
   |---|---|
   | `ANDROID_KEYSTORE_BASE64` | contenido de `keystore.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | la contraseña del almacén |
   | `ANDROID_KEY_ALIAS` | `resonus` |
   | `ANDROID_KEY_PASSWORD` | la contraseña de la clave |

   La keystore y `keystore.b64` **no** se suben a git.

## Cada release

1. Sube la versión en `app.json`: `expo.version` (nombre visible) y
   `expo.android.versionCode` (entero, debe **incrementarse** en cada release).
   Cuadra también el texto de la pantalla About si hace falta.
2. Commitea, crea el tag y empújalo:

   ```sh
   git tag v0.1.0-beta
   git push origin v0.1.0-beta
   ```

3. El workflow construye el APK y crea un **borrador** de Release con
   `resonus-v0.1.0-beta.apk`. Ábrelo en la pestaña Releases, revisa las notas y
   pulsa **Publish**.

## Notas

- La firma se inyecta con el config plugin `plugins/withReleaseSigning.js` durante
  el prebuild (la carpeta `android/` está en `.gitignore` y se regenera). En builds
  locales sin esas variables de entorno, el release sigue firmándose con la clave de
  debug, así que no afecta al desarrollo.
- El APK es universal (todas las arquitecturas). Vale para distribuir por GitHub.
