// Stub de @expo-google-fonts/material-symbols (ver metro.config.js).
// Cubre cualquier export nombrado (MaterialSymbols_400Regular, useFonts, …)
// con una función inocua; solo se llamaría desde SymbolView/NativeTabs.
module.exports = new Proxy(
  {},
  {
    get: () => () => null,
  }
);
