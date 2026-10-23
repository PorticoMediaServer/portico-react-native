const manifest = require('./package.json');

// The React Native Apple CLI represents both iOS and tvOS as `ios`.
// Keep the target selection local to the tvOS Podfile invocation so its
// autolinking JSON and codegen agree, without changing iOS or Android.
const tvOS = process.env.PORTICO_APPLE_TARGET === 'tvos';
const webViewDeclared = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]
  .some(dependencies => Object.hasOwn(dependencies ?? {}, 'react-native-webview'));

module.exports = tvOS ? {
  project: {ios: {sourceDir: 'tvos'}},
  ...(webViewDeclared ? {
    dependencies: {'react-native-webview': {platforms: {ios: null}}},
  } : {}),
} : {};
