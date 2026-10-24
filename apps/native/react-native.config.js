const manifest = require('./package.json');

// The React Native Apple CLI represents both iOS and tvOS as `ios`.
// Pod installation uses the explicit flag; Xcode reruns Fabric codegen in a
// separate process with PLATFORM_NAME and no Podfile environment. Both must
// exclude components that tvOS cannot link.
const tvOS = process.env.PORTICO_APPLE_TARGET === 'tvos' ||
  ['appletvos', 'appletvsimulator'].includes(process.env.PLATFORM_NAME);
const webViewDeclared = [manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies]
  .some(dependencies => Object.hasOwn(dependencies ?? {}, 'react-native-webview'));

module.exports = tvOS ? {
  project: {ios: {sourceDir: 'tvos'}},
  ...(webViewDeclared ? {
    dependencies: {'react-native-webview': {platforms: {ios: null}}},
  } : {}),
} : {};
