// Use a production Apple JavaScript bundle prepared by the Linux CI job.
// React Native's Xcode phase still performs its normal local Hermes compilation.
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const value = flag => {
  const index = args.indexOf(flag);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${flag}`);
  return args[index + 1];
};
if (args[0] !== 'bundle' || value('--platform') !== 'ios' || value('--dev') !== 'false') {
  throw new Error('The prepared bundle supports production Apple builds only');
}
const source = process.env.PORTICO_PREBUILT_BUNDLE;
if (!source) throw new Error('PORTICO_PREBUILT_BUNDLE is required');
const sourceBundle = path.join(source, 'main.jsbundle');
const sourceAssets = path.join(source, 'assets');
if (!fs.statSync(sourceBundle).isFile() || !fs.statSync(sourceAssets).isDirectory()) {
  throw new Error('The prepared bundle must contain main.jsbundle and an assets directory');
}
const bundleOutput = value('--bundle-output');
const assetsDestination = value('--assets-dest');
// Xcode's archive products contain an app symlink into InstallationBuildProductsLocation.
// Resolve it before cpSync, which otherwise treats the link as a non-directory.
// lstat keeps a broken link distinct from a genuinely new destination.
if (!fs.lstatSync(assetsDestination, {throwIfNoEntry: false})) {
  fs.mkdirSync(assetsDestination, {recursive: true});
}
const assetsDirectory = fs.realpathSync(assetsDestination);
if (!fs.statSync(assetsDirectory).isDirectory()) {
  throw new Error('--assets-dest must resolve to a directory');
}
fs.copyFileSync(sourceBundle, bundleOutput);
fs.cpSync(sourceAssets, assetsDirectory, {recursive: true});
console.log('Using the verified production JavaScript bundle prepared on Linux');
