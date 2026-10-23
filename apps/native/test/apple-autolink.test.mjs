import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('..', import.meta.url));
const configSource = readFileSync(path.join(root, 'react-native.config.js'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const codegen = require('react-native/scripts/codegen/generate-artifacts-executor/utils.js');

function config(target, packageManifest = manifest) {
  const module = {exports: {}};
  vm.runInNewContext(configSource, {
    module, __dirname: root, process: {env: {PORTICO_APPLE_TARGET: target}},
    require: id => id === './package.json' ? packageManifest : require(id),
  });
  return JSON.parse(JSON.stringify(module.exports));
}

test('ordinary iOS and Android keep default autolinking, including declared WebView', () => {
  const installed = {...manifest, dependencies: {...manifest.dependencies, 'react-native-webview': '16.0.0'}};
  for (const target of [undefined, '', 'ios', 'android']) assert.deepEqual(config(target, installed), {});
});

test('tvOS writes autolinking into its own project and disables only declared WebView Apple codegen', () => {
  const installed = {...manifest, dependencies: {...manifest.dependencies, 'react-native-webview': '16.0.0'}};
  const tv = config('tvos', installed);
  assert.deepEqual(tv, {
    project: {ios: {sourceDir: path.join(root, 'tvos')}},
    dependencies: {'react-native-webview': {platforms: {ios: null}}},
  });
  assert.deepEqual(codegen.findDisabledLibrariesByPlatform(tv, 'ios'), ['react-native-webview']);
  assert.deepEqual(codegen.findDisabledLibrariesByPlatform(tv, 'android'), []);
});

test('tvOS does not ask the CLI to resolve a package absent from the application', () => {
  assert.deepEqual(config('tvos', {}), {project: {ios: {sourceDir: path.join(root, 'tvos')}}});
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    assert.deepEqual(config('tvos', {[section]: {'react-native-webview': '16.0.0'}}).dependencies,
      {'react-native-webview': {platforms: {ios: null}}});
  }
});

test('tvOS target flag precedes CLI autolinking while both Apple deployment floors remain 15.1', () => {
  const podfile = readFileSync(path.join(root, 'tvos/Podfile'), 'utf8');
  assert.ok(podfile.indexOf("ENV['PORTICO_APPLE_TARGET'] = 'tvos'") < podfile.indexOf('use_native_modules!'));
  assert.ok(!readFileSync(path.join(root, 'ios/Podfile'), 'utf8').includes('PORTICO_APPLE_TARGET'));
  for (const [platform, setting] of [['ios', 'IPHONEOS'], ['tvos', 'TVOS']]) {
    const project = readFileSync(path.join(root, platform, 'Portico.xcodeproj/project.pbxproj'), 'utf8');
    const floors = [...project.matchAll(new RegExp(`${setting}_DEPLOYMENT_TARGET = ([^;]+);`, 'g'))];
    assert.ok(floors.length > 0);
    assert.ok(floors.every(match => match[1] === '15.1'));
  }
});

test('actual installed CLI selects the tvOS project without changing Android or other dependency declarations', () => {
  const cli = require.resolve('@react-native-community/cli/build/bin.js');
  const read = target => JSON.parse(execFileSync(process.execPath, [cli, 'config'], {
    cwd: root, encoding: 'utf8', env: {...process.env, PORTICO_APPLE_TARGET: target},
  }));
  const ordinary = read('ios');
  const tv = read('tvos');
  assert.equal(ordinary.project.ios.sourceDir, path.join(root, 'ios'));
  assert.equal(tv.project.ios.sourceDir, path.join(root, 'tvos'));
  assert.deepEqual(tv.project.android, ordinary.project.android);
  const ordinaryDependencies = {...ordinary.dependencies};
  const tvDependencies = {...tv.dependencies};
  delete ordinaryDependencies['react-native-webview'];
  delete tvDependencies['react-native-webview'];
  assert.deepEqual(tvDependencies, ordinaryDependencies);
});
