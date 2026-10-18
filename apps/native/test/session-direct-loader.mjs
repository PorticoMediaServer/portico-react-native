// Direct sign-in boundaries for session tests, layered over `session-hook-loader.mjs`: the address
// lookup, pairing, the sign-in request and the saved connection answer from
// `session-direct-stub.mjs`; everything else in those modules, and the commit, stays real.
import {fileURLToPath} from 'node:url';
const session = new URL('../src/app/session.tsx', import.meta.url).href;
const controls = new URL('./session-direct-stub.mjs', import.meta.url).href;
const replaced = new Map([
  ['../src/app/direct-connect.ts', ['findDirectServer']],
  ['../../../packages/client-core/src/server-connections.ts', ['connectPairedServer', 'rememberNativeSession']],
  ['../../../packages/client-core/src/profile-management.ts', ['directSignIn']],
].map(([path, names]) => [fileURLToPath(new URL(path, import.meta.url)), names]));
export async function resolve(specifier, context, next) {
  const found = await next(specifier, context);
  const names = context.parentURL === session && found.url.startsWith('file:') ? replaced.get(fileURLToPath(found.url)) : undefined;
  return names ? {...found, url: found.url + '?direct-stub=' + names.join(','), shortCircuit: true} : found;
}
export async function load(url, context, next) {
  const marker = url.indexOf('?direct-stub=');
  if (marker < 0) return next(url, context);
  const real = url.slice(0, marker), names = url.slice(marker + '?direct-stub='.length);
  return {format: 'module', shortCircuit: true, source: `export * from ${JSON.stringify(real)};\nexport {${names}} from ${JSON.stringify(controls)};`};
}
