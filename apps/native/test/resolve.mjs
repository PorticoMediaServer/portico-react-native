// Node test loader: the bridge modules import `react-native` for the native
// module registry and platform constants. Under node:test there is no native
// runtime, so `react-native` resolves to a small stand-in that records what the
// bridge asked the native side to do. Everything else resolves normally, so the
// code under test is the real, unmodified bridge.
import {fileURLToPath, pathToFileURL} from 'node:url';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const stub = pathToFileURL(path.join(here, 'react-native-stub.mjs')).href;

// The app is bundled by Metro, so its relative imports omit extensions. Node's
// ESM resolver requires them, so extensionless relative specifiers get the same
// candidate list a bundler would try. App source is not modified for tests.
const candidates = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.mjs', '.js'];
const resolutionMiss = error => error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'ERR_UNSUPPORTED_DIR_IMPORT';

export async function resolve(specifier, context, next) {
  if (specifier === '@portico/design') return next(new URL('../../../packages/design/src/index.ts', import.meta.url).href, context);
  if (specifier === 'react-native') return {url: stub, shortCircuit: true, format: 'module'};
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!resolutionMiss(error) || !specifier.startsWith('.')) throw error;
    for (const suffix of candidates) {
      try {
        return await next(specifier + suffix, context);
      } catch (retry) {
        if (!resolutionMiss(retry)) throw retry;
      }
    }
    throw error;
  }
}

// Local test adapter until the canonical shared fixture encodes its file parameter.
// The registry correctly rejects raw slashes in encodedRoutePath; only this fixture
// used an unescaped generation/path. Keep every production route check unchanged.
export async function load(url, context, next) {
  let result;
  try {result = await next(url, context);}
  catch (error) {
    if (error?.code !== 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX' || !url.endsWith('.ts')) throw error;
    // Existing production classes use parameter properties. Transform that supported
    // TypeScript syntax for Node tests, preserving the original runtime code.
    result = {format: 'module', source: stripTypeScriptTypes(await readFile(new URL(url), 'utf8'), {mode: 'transform', sourceUrl: url})};
  }
  if (!url.endsWith('/playback-v1/testing/fake-server.ts')) return result;
  const source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
  return {...result, source: source.replace("file:s.generation+'/master.m3u8'", "file:encodeURIComponent(s.generation+'/master.m3u8')")};
}
