module.exports = {
  preset: 'react-native',
  roots: ['<rootDir>/packages', '<rootDir>/apps'],
  setupFiles: [
    'react-native-gesture-handler/jestSetup',
    '<rootDir>/scripts/test-build-contract.js',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/ios/build/', '/Pods/', '/design-reference/'],
  transform: {'^.+\\.(js|jsx|mjs|ts|tsx)$': 'babel-jest'},
  transformIgnorePatterns: [
    'node_modules/(?!((@)?react-native|@react-native-community|@react-navigation|react-native-gesture-handler|react-native-screens|react-native-safe-area-context|react-native-keychain|react-native-get-random-values|lucide-react-native|@noble)/)',
  ],
};
