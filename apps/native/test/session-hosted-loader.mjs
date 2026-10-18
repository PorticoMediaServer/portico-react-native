// Portico Account boundaries for session tests, layered over `session-hook-loader.mjs` and
// `session-direct-loader.mjs`: the account (its credentials and servers), the route to one of its
// servers and that server's answer come from `session-hosted-stub.mjs`; everything else, and the
// commit, stays real.
import {fileURLToPath} from 'node:url';
const session = new URL('../src/app/session.tsx', import.meta.url).href;
const controls = new URL('./session-hosted-stub.mjs', import.meta.url).href;
const replaced = new Map([
  ['./session-hook-stub.mjs', ['useHostedAccount']],
  ['../../../packages/client-core/src/server-connections.ts', ['connectHostedServer']],
  ['../../../packages/client-core/src/portico-servers.ts', ['porticoSignIn']],
].map(([path, names]) => [fileURLToPath(new URL(path, import.meta.url)), names]));
export async function resolve(specifier, context, next) {
  const found = await next(specifier, context);
  const names = context.parentURL === session && found.url.startsWith('file:') ? replaced.get(fileURLToPath(found.url.split('?')[0])) : undefined;
  return names ? {...found, url: found.url + '?hosted-stub=' + names.join(','), shortCircuit: true} : found;
}
export async function load(url, context, next) {
  const marker = url.indexOf('?hosted-stub=');
  if (marker < 0) return next(url, context);
  const real = url.slice(0, marker), names = url.slice(marker + '?hosted-stub='.length);
  return {format: 'module', shortCircuit: true, source: `export * from ${JSON.stringify(real)};\nexport {${names}} from ${JSON.stringify(controls)};`};
}
