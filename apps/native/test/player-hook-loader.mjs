import {fileURLToPath} from 'node:url';
const paths = new Set([
  'app/session', 'bridge/useNativePlayback', 'bridge/useNativeAudioSelection',
  'app/server-preferences', 'app/preferences', 'bridge/player-engines',
  'ui', 'app/errors', 'app/top-shelf', 'app/content',
].map(p => fileURLToPath(new URL('../src/' + p, import.meta.url))));
const stub = new URL('./player-hook-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL) {
    const path = fileURLToPath(new URL(specifier, context.parentURL)).replace(/\.(ts|tsx)$/, '');
    if (paths.has(path)) return {url: stub, shortCircuit: true, format: 'module'};
  }
  return next(specifier, context);
}
