import {fileURLToPath} from 'node:url';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const paths = new Set(['bridge/profile-trust', 'bridge/setup-codes', 'bridge/server-connections', 'bridge/useHostedAccount', 'bridge/useCredentialVerification', 'bridge/profile-transport', 'bridge/offline-downloads', 'bridge/known-servers', 'bridge/NativeActivity', 'bridge/device-platform'].map(p => fileURLToPath(new URL('../src/' + p, import.meta.url))));
const stub = new URL('./session-hook-stub.mjs', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL && paths.has(fileURLToPath(new URL(specifier, context.parentURL)).replace(/\.(ts|tsx)$/, ''))) return {url: stub, shortCircuit: true, format: 'module'};
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (url === new URL('../src/app/session.tsx', import.meta.url).href) return {format: 'module', shortCircuit: true, source: ts.transpileModule(await readFile(new URL(url), 'utf8'), {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}}).outputText};
  return next(url, context);
}
