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
fs.copyFileSync(path.join(source, 'main.jsbundle'), value('--bundle-output'));
fs.cpSync(path.join(source, 'assets'), value('--assets-dest'), {recursive: true});
console.log('Using the verified production JavaScript bundle prepared on Linux');
