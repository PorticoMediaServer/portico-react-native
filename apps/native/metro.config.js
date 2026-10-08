const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');
const svgLite = path.resolve(__dirname, 'metro/svg-lite.js');
const svgCssStub = path.resolve(__dirname, 'metro/svg-css-stub.js');
module.exports = mergeConfig(getDefaultConfig(__dirname), {
  watchFolders: [path.resolve(__dirname, '../../packages')],
  resolver: {
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    disableHierarchicalLookup: true,
    extraNodeModules: {
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-native': path.resolve(__dirname, 'node_modules/react-native'),
    },
    // PERF-15: keep react-native-svg's CSS/XML parsers out of the bundle (see metro/svg-lite.js).
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react-native-svg' && !context.originModulePath.includes(`${path.sep}node_modules${path.sep}react-native-svg${path.sep}`)) return {type: 'sourceFile', filePath: svgLite};
      if (moduleName === 'react-native-svg/css') return {type: 'sourceFile', filePath: svgCssStub};
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
