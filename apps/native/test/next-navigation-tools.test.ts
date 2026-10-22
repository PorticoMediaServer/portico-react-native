import test from 'node:test';
import assert from 'node:assert/strict';
import {createNavigationActivity, navigationServerName} from '../src-next/shell/navigation-tools';
import type {NativeShellBootstrapContext} from '../src-next/shell/bootstrap';

test('navigation server label requires the actual selected server identity and safe nonempty display name', () => {
  assert.equal(navigationServerName({id: 'server', name: ' Living room '}, 'server'), 'Living room');
  for (const raw of [null, [], {}, {id: 'other', name: 'Wrong server'}, {id: 'server', name: ''}, {id: 'server', name: '\n'}, {id: 'server', name: 'a\u0000b'}, {id: 'server', name: 'a'.repeat(257)}]) assert.equal(navigationServerName(raw, 'server'), undefined);
});

test('native Activity source uses the live selected transport and aborts/erases a pending read on authority retirement', async () => {
  let current = true, captured: AbortSignal | undefined, calls = 0;
  const listeners = new Set<() => void>();
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => {finish = resolve;});
  const context = {api: {requestRaw: async (_path: string, _method: string, options: {signal: AbortSignal}) => {calls++; captured = options.signal; return pending;}}, events: {},
    session: () => ({sessionFamilyId: 'family', viewer: {serverId: 'server', accountId: 'account', profileId: 'profile', authority: 'local', role: 'owner'}}),
    authority: () => ({epoch: 'current-epoch'}), current: () => current,
    subscribeAuthority: (fn: () => void) => {listeners.add(fn); return () => {listeners.delete(fn);};}} as unknown as Parameters<typeof createNavigationActivity>[0];
  const binding = createNavigationActivity(context)!;
  await binding.service.load(); assert.equal(calls, 0, 'inert until the owning visible surface enables it');
  binding.service.setActive(true); const read = binding.service.load();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(calls, 1); assert.equal(captured?.aborted, false);
  current = false; for (const fn of [...listeners]) fn();
  assert.equal(captured?.aborted, true); assert.equal(binding.service.getSnapshot().document, undefined);
  finish({status: 200, body: {serverName: 'late private body'}}); await read;
  assert.deepEqual(binding.service.getSnapshot(), {phase: 'unavailable'});
  binding.service.dispose(); assert.equal(listeners.size, 0);
  for (const role of ['member', 'admin']) assert.equal(createNavigationActivity({...context, session: () => ({viewer: {role}} as ReturnType<NativeShellBootstrapContext['session']>)}), undefined);
});
