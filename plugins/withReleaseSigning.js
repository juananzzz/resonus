/**
 * Config plugin: inyecta una signingConfig de *release* en android/app/build.gradle
 * durante `expo prebuild`. La keystore y las contraseñas se leen de variables de
 * entorno (las pone el workflow de CI desde los Secrets del repo):
 *
 *   RESONUS_KEYSTORE_FILE       ruta absoluta al .jks
 *   RESONUS_KEYSTORE_PASSWORD   contraseña del almacén
 *   RESONUS_KEY_ALIAS           alias de la clave
 *   RESONUS_KEY_PASSWORD        contraseña de la clave
 *
 * Si esas variables no están definidas (p. ej. en un build local de debug), el
 * release sigue usando la firma de debug, así no se rompe el desarrollo normal.
 *
 * Como android/ está en .gitignore y se regenera con prebuild, esto debe hacerse
 * por plugin (una edición a mano de build.gradle se perdería).
 */
const { withAppBuildGradle } = require('@expo/config-plugins');

const RELEASE_SIGNING_CONFIG = `        release {
            if (System.getenv('RESONUS_KEYSTORE_FILE')) {
                storeFile file(System.getenv('RESONUS_KEYSTORE_FILE'))
                storePassword System.getenv('RESONUS_KEYSTORE_PASSWORD')
                keyAlias System.getenv('RESONUS_KEY_ALIAS')
                keyPassword System.getenv('RESONUS_KEY_PASSWORD')
            }
        }
`;

function applyReleaseSigning(gradle) {
  let out = gradle;

  // 1) Añade el bloque signingConfigs.release (justo tras abrir signingConfigs).
  if (!out.includes('signingConfigs.release') && !out.includes('release {\n            if (System.getenv')) {
    out = out.replace(
      /signingConfigs \{\n/,
      `signingConfigs {\n${RELEASE_SIGNING_CONFIG}`,
    );
  }

  // 2) El buildType release usa la firma de release si hay keystore en el entorno.
  out = out.replace(
    /(\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*)signingConfig signingConfigs\.debug/,
    `$1signingConfig System.getenv('RESONUS_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
  );

  return out;
}

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning solo soporta build.gradle en Groovy');
    }
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
