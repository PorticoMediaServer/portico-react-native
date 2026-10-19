const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {test} = require('node:test');

const wrapper = path.join(__dirname, 'apple-prebuilt-bundle.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apple-prebuilt-bundle-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const source = path.join(root, 'bundle');
  fs.mkdirSync(path.join(source, 'assets', 'assets'), {recursive: true});
  fs.writeFileSync(path.join(source, 'main.jsbundle'), 'production bundle');
  fs.writeFileSync(path.join(source, 'assets', 'assets', 'logo.png'), 'image bytes');
  const bundleOutput = path.join(root, 'main.jsbundle');
  return {root, source, bundleOutput};
}
function run(f, destination, options = {}) {
  const env = {...process.env};
  delete env.PORTICO_PREBUILT_BUNDLE;
  if (options.source !== null) env.PORTICO_PREBUILT_BUNDLE = options.source ?? f.source;
  return spawnSync(process.execPath, [wrapper, 'bundle',
    '--platform', options.platform ?? 'ios', '--dev', options.dev ?? 'false',
    '--bundle-output', f.bundleOutput, '--assets-dest', destination],
  {env, encoding: 'utf8'});
}

for (const kind of ['Xcode app symlink', 'existing directory', 'new directory']) {
  test(`copies the bundle and assets to ${kind}`, t => {
    const f = fixture(t);
    const destination = path.join(f.root, 'BuildProductsPath', 'Release-appletvos', 'Portico.app');
    const actualApp = kind === 'Xcode app symlink'
      ? path.join(f.root, 'InstallationBuildProductsLocation', 'Applications', 'Portico.app')
      : destination;
    let linkTarget;
    let originalLink;
    if (kind !== 'new directory') {
      fs.mkdirSync(actualApp, {recursive: true});
      fs.writeFileSync(path.join(actualApp, 'Info.plist'), 'existing app metadata');
    }
    if (kind === 'Xcode app symlink') {
      fs.mkdirSync(path.dirname(destination), {recursive: true});
      linkTarget = path.relative(path.dirname(destination), actualApp);
      fs.symlinkSync(linkTarget, destination, 'dir');
      originalLink = fs.lstatSync(destination);
    }
    const result = run(f, destination);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(f.bundleOutput, 'utf8'), 'production bundle');
    assert.equal(fs.readFileSync(path.join(actualApp, 'assets', 'logo.png'), 'utf8'), 'image bytes');
    assert.equal(fs.existsSync(path.join(actualApp, 'main.jsbundle')), false);
    if (kind !== 'new directory') {
      assert.equal(fs.readFileSync(path.join(actualApp, 'Info.plist'), 'utf8'), 'existing app metadata');
    }
    if (linkTarget) {
      const link = fs.lstatSync(destination);
      assert.equal(link.isSymbolicLink(), true);
      assert.equal(link.ino, originalLink.ino);
      assert.equal(link.dev, originalLink.dev);
      assert.equal(fs.readlinkSync(destination), linkTarget);
      assert.equal(fs.realpathSync(destination), actualApp);
    }
  });
}

for (const kind of ['file', 'broken symlink', 'symlink to file']) {
  test(`rejects an asset destination that is a ${kind} without writing output`, t => {
    const f = fixture(t);
    const destination = path.join(f.root, 'Portico.app');
    const target = path.join(f.root, 'target');
    if (kind === 'file') fs.writeFileSync(destination, 'keep');
    else {
      if (kind === 'symlink to file') fs.writeFileSync(target, 'keep');
      fs.symlinkSync(target, destination);
    }
    const result = run(f, destination);
    assert.notEqual(result.status, 0);
    assert.equal(fs.existsSync(f.bundleOutput), false);
    if (kind === 'file') assert.equal(fs.readFileSync(destination, 'utf8'), 'keep');
    else {
      assert.equal(fs.readlinkSync(destination), target);
      if (kind === 'broken symlink') assert.equal(fs.existsSync(target), false);
      else assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
    }
  });
}

test('rejects unsupported builds, missing environment, and incomplete sources', t => {
  const f = fixture(t);
  const destination = path.join(f.root, 'Portico.app');
  for (const options of [{platform: 'android'}, {dev: 'true'}, {source: null},
    {source: path.join(f.root, 'missing')}]) {
    assert.notEqual(run(f, destination, options).status, 0);
  }
  fs.rmSync(path.join(f.source, 'assets'), {recursive: true});
  assert.notEqual(run(f, destination).status, 0);
  assert.equal(fs.existsSync(f.bundleOutput), false);
  assert.equal(fs.existsSync(destination), false);
});
