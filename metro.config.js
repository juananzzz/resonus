const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// expo-router arrastra expo-symbols y con él ~6 MB de fuentes MaterialSymbols
// en 7 pesos que solo usan SymbolView/NativeTabs, que esta app no usa
// (expo/expo#43614). Resolvemos ese paquete a un stub para que Metro no
// empaquete las fuentes. Si algún día usamos NativeTabs, quitar esto.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@expo-google-fonts/material-symbols')) {
    return {
      type: 'sourceFile',
      filePath: path.resolve(__dirname, 'src/stubs/material-symbols.js'),
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
