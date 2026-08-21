const path = require('node:path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const workspaceRoot = path.resolve(__dirname, '../..');
const config = {
  projectRoot: __dirname,
  watchFolders: [workspaceRoot],
  resolver: {
    unstable_enablePackageExports: true,
    nodeModulesPaths: [
      path.join(workspaceRoot, 'node_modules'),
      path.join(__dirname, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
