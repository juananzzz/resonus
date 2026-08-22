/**
 * Config plugin: puts a *release* signingConfig into android/app/build.gradle
 * during `expo prebuild`. The keystore and its passwords are read from the
 * environment, which the CI workflow fills in from the repository's Secrets:
 *
 *   RESONUS_KEYSTORE_FILE       absolute path to the .jks
 *   RESONUS_KEYSTORE_PASSWORD   the store's password
 *   RESONUS_KEY_ALIAS           the key's alias
 *   RESONUS_KEY_PASSWORD        the key's password
 *
 * With those unset, as in a local debug build, release keeps signing with the
 * debug key, so ordinary development is not held up by any of this.
 *
 * android/ is in .gitignore and prebuild regenerates it, so this has to be a
 * plugin: an edit to build.gradle by hand would not survive.
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

  // 1) Adds the signingConfigs.release block, right after signingConfigs opens.
  if (!out.includes('signingConfigs.release') && !out.includes('release {\n            if (System.getenv')) {
    out = out.replace(
      /signingConfigs \{\n/,
      `signingConfigs {\n${RELEASE_SIGNING_CONFIG}`,
    );
  }

  // 2) The release buildType signs with it when there is a keystore to sign with.
  out = out.replace(
    /(\/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\.\n\s*)signingConfig signingConfigs\.debug/,
    `$1signingConfig System.getenv('RESONUS_KEYSTORE_FILE') ? signingConfigs.release : signingConfigs.debug`,
  );

  return out;
}

module.exports = function withReleaseSigning(config, options) {
  if (options?.android === false || (config.platforms && !config.platforms.includes('android'))) {
    return config;
  }
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning solo soporta build.gradle en Groovy');
    }
    cfg.modResults.contents = applyReleaseSigning(cfg.modResults.contents);
    return cfg;
  });
};
