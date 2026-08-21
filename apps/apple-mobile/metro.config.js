const path = require('node:path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const workspaceRoot = path.resolve(__dirname, '../..');
const clientCoreRoot = path.resolve(workspaceRoot, '../portico-server/packages/portico-client-core');
const config = {
  projectRoot: __dirname,
  watchFolders: [workspaceRoot, clientCoreRoot],
  resolver: {
    unstable_enablePackageExports: true,
    nodeModulesPaths: [
      path.join(workspaceRoot, 'node_modules'),
      path.join(__dirname, 'node_modules'),
    ],
    disableHierarchicalLookup: true,
    extraNodeModules: {'@portico/client-core': clientCoreRoot},
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
