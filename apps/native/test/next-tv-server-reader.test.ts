import test from 'node:test';
import assert from 'node:assert/strict';
import type {DirectSnapshot} from '../../../packages/client-core/src/profile-management';
import {routePath} from '../../../packages/contracts/src/routes';
import {NativeScreenLifetime} from '../src-next/screens/settings-live/lifetime';
import {createTVServerReader, nativeServerAdmission} from '../src-next/screens/settings-live/server/tv-server-reader';
const authority = {serverId: 'server', accountId: 'account', profileId: 'primary', epoch: 'one', viewerFence: 'fence'};
const account = {canManage: true, account: {role: 'owner', primaryProfileId: 'primary', disabled: false}} as DirectSnapshot;
function scope() {return new NativeScreenLifetime({authority: () => authority, current: () => true, subscribeAuthority: () => () => {}});}

test('members, secondary profiles and disabled accounts never read owner TV settings', async () => {
  const variants = [
    {...account, account: {...account.account, role: 'member' as const}},
    {...account, account: {...account.account, primaryProfileId: 'other'}},
    {...account, account: {...account.account, disabled: true}},
    {...account, canManage: false},
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

test('an administrator reads only the shared People pages, never the owner log, storage, catalogue or remote access', async () => {
  const value = {...account, account: {...account.account, role: 'admin' as const}};
  let reads = 0;
  const lifetime = scope();
  const reader = createTVServerReader({account: value, api: {request: async <T,>() => {reads++; return {} as T;}}}, lifetime);
  // The shared People page is the administrator's real audience.
  for (const path of [routePath('get_admin_access_members'), routePath('get_admin_access_invitations'), routePath('get_admin_access_devices')]) {
    await reader.request(path);
  }
  assert.equal(reads, 3);
  // The owner's pages are not part of that audience, even though the tier would pass.
  for (const path of [
    routePath('get_admin_logs'), routePath('get_admin_storage_usage'), routePath('get_data_storage_usage'),
    routePath('get_networking_certificate'), routePath('get_networking_remote'), routePath('get_connectivity_status'),
    '/v1/admin/libraries', '/v1/titles',
  ]) {
    await assert.rejects(reader.request(path), /native_tv_server_read_denied/);
  }
  assert.equal(reads, 3);
  lifetime.dispose();
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
