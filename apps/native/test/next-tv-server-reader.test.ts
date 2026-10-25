import test from 'node:test';
import assert from 'node:assert/strict';
import type {DirectSnapshot} from '../../../packages/client-core/src/profile-management';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {createTVServerReader, nativeServerAdmission} from '../src-next/screens/settings-live/server/tv-server-reader';
const authority = {serverId: 'server', accountId: 'account', profileId: 'primary', epoch: 'one', viewerFence: 'fence'};
const account = {canManage: true, account: {role: 'owner', primaryProfileId: 'primary', disabled: false}} as DirectSnapshot;
function scope() {return new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});}

test('members, secondary profiles, disabled accounts and administrators never read owner TV settings', async () => {
  const variants = [
    {...account, account: {...account.account, role: 'member' as const}},
    {...account, account: {...account.account, primaryProfileId: 'other'}},
    {...account, account: {...account.account, disabled: true}},
    {...account, canManage: false},
    {...account, account: {...account.account, role: 'admin' as const}},
  ];
  for (const value of variants) {
    let reads = 0;
    const lifetime = scope();
    const reader = createTVServerReader({account: value, api: {request: async <T,>() => {reads++; return {} as T;}}}, lifetime);
    await assert.rejects(reader.request('/v1/admin/libraries'));
    assert.equal(reads, 0);
    lifetime.dispose();
  }
});

test('owner reader allows GET only and rejects a response after authority retirement', async () => {
  const lifetime = scope();
  let reads = 0, finish!: (value: unknown) => void;
  const reader = createTVServerReader({account, api: {request: <T,>() => {reads++; return new Promise<unknown>(resolve => {finish = resolve;}) as Promise<T>;}}}, lifetime);
  assert.equal(nativeServerAdmission(account, lifetime), 'owner');
  await assert.rejects(reader.request('/v1/admin/libraries', 'POST', {}));
  assert.equal(reads, 0);
  const pending = reader.request('/v1/admin/libraries');
  assert.equal(reads, 1);
  lifetime.dispose(); finish({items: []});
  await assert.rejects(pending, {name: 'AbortError'});
  await assert.rejects(reader.request('/v1/admin/libraries'));
  assert.equal(reads, 1);
});
