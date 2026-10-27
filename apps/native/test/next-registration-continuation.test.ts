import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';
import {ApiError} from '../../../packages/client-core/src/index';
import {CodedError} from '../../../packages/client-core/src/server-messages';
import {MFARequiredError} from '../../../packages/client-core/src/hosted-security';

async function port() {
  const original = {kind: 'registration', registrationId: 'original', status: 'contact_pending', revision: '1', maskedAddress: 'a***@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), contactVerified: false};
  const requests: any[] = []; let read: any = {...original, contactVerified: true}, onRead = () => {};
  const api = {options: async () => ({providers: []}), register: async () => original,
    registration: async (id: string) => {assert.equal(id, 'original'); onRead(); return {...await read};},
    verifyRegistration: async (id: string, input: unknown) => {requests.push({id, input}); if (requests.length < 3) throw new ApiError(409, 'username_unavailable', 'taken', false); return {};}};
  const bridge = {loadContinuation: async () => null, newBinding: async () => 'a'.repeat(43), saveContinuation: async () => {}, newRequestId: async () => 'request', cancel() {}};
  const nativeAccounts = {onCancel: () => () => {}, accountClient: () => api, authenticatePorticoAccount: async (work: (signal: AbortSignal) => Promise<unknown>, current: () => boolean) => {assert.ok(current()); return work(new AbortController().signal);}};
  const {NativePorticoSignIn} = await screenModule(new URL('../src-next/platform/portico-sign-in.ts', import.meta.url), {
    react: {default: {}}, 'react-native': {NativeModules: {PorticoAccountAuth: bridge}},
    '../../../../packages/client-core/src/hosted-security': {MFARequiredError}, '../../../../packages/client-core/src/server-messages': {CodedError},
    '../../../../packages/client-core/src': {ApiError}, '../../../../packages/contracts/src/hosted/routes': {},
    './accounts': {nativeAccounts}, './abort-signals': {}, './account-authority': {hostedUrl: 'https://example.test'},
  });
  const source = new NativePorticoSignIn(); await source.prepare();
  const registration = await source.register('taken', 'Name', 'password', 'a@example.test');
  return {source, registration, requests, setRead: (value: unknown, notify?: () => void) => {read = value; onRead = notify ?? (() => {});}};
}

test('native verified collision remains bound to its original registration for repeated replacement attempts', async () => {
  const p = await port(), current = {isCurrent: () => true};
  await assert.rejects(p.source.verifyRegistration('123456', p.registration, current), {code: 'username_unavailable'});
  const first = p.source.registrationAfterCollision(p.registration); assert.ok(first?.contactVerified);
  await assert.rejects(p.source.verifyRegistration('', first, current, {username: 'second', displayName: 'Name'}), {code: 'username_unavailable'});
  const second = p.source.registrationAfterCollision(first); assert.ok(second);
  await p.source.verifyRegistration('', second, current, {username: 'Available', displayName: 'Name'});
  assert.deepEqual(p.requests.map(x => x.id), ['original', 'original', 'original']);
  assert.deepEqual(p.requests[2].input, {code: '', username: 'available', displayName: 'Name'}); p.source.dispose();
});

test('native collision rejects a successor and a retired caller', async () => {
  const p = await port(); p.setRead({...p.registration, registrationId: 'successor', contactVerified: true});
  await assert.rejects(p.source.verifyRegistration('123456', p.registration, {isCurrent: () => true}), {code: 'account_changed'});
  assert.equal(p.source.registrationAfterCollision(p.registration), undefined);
  await assert.rejects(p.source.verifyRegistration('123456', p.registration, {isCurrent: () => false}), {code: 'cancelled'}); p.source.dispose();
});

test('native collision cannot publish after the original caller is retired', async () => {
  const p = await port(); let live = false;
  await assert.rejects(p.source.verifyRegistration('123456', p.registration, {isCurrent: () => live}), {code: 'cancelled'});
  assert.equal(p.requests.length, 0); assert.equal(p.source.registrationAfterCollision(p.registration), undefined);
  live = true; p.source.dispose();
  await assert.rejects(p.source.verifyRegistration('123456', p.registration, {isCurrent: () => live}));
  assert.equal(p.requests.length, 0);
});


test('native ignores a late verified lookup after the original caller leaves', async () => {
  const p = await port(); let live = true, release!: (value: unknown) => void, started!: () => void;
  const waiting = new Promise<void>(resolve => {started = resolve;});
  p.setRead(new Promise(resolve => {release = resolve;}), started);
  const pending = p.source.verifyRegistration('123456', p.registration, {isCurrent: () => live});
  await waiting; live = false; release({...p.registration, contactVerified: true});
  await assert.rejects(pending, {code: 'cancelled'});
  assert.equal(p.source.registrationAfterCollision(p.registration), undefined); p.source.dispose();
});
