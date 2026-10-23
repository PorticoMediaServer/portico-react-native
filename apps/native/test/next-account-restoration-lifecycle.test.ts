import test from 'node:test';
import assert from 'node:assert/strict';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

test('a retired restore cannot publish its late private Home after exact-family sign-out', async () => {
  let release!: () => void, entered!: () => void, held = true;
  const gate = new Promise<void>(resolve => {release = resolve;}), started = new Promise<void>(resolve => {entered = resolve;});
  const app = await standardHomeApp({mountUI: false, nativeResponse: async (request: any) => {
    if (request.path === '/v1/home' && held) {held = false; entered(); await gate;}
    if (request.path === '/v1/sessions/current') return {status: 204};
    return undefined;
  }});
  try {
    await app.mount(); await started;
    const {nativeAccounts} = await import('../src-next/platform/accounts.ts');
    const {nativeAppSessions} = await import('../src-next/platform/app-session-storage.ts');
    const selected = await nativeAppSessions.selected(); assert.ok(selected);
    await nativeAccounts.signOutServer(selected.connection.pin.serverId, selected.connection.session.sessionFamilyId);
    await app.settle(); release(); await app.settle();
    assert.equal(await nativeAppSessions.selected(), undefined);
    assert.ok(app.hosts().some((host: any) => host.name === 'Pressable' && app.nativeLabel(host) === 'Use a local server'));
    assert.equal(app.hosts().some((host: any) => host.name === 'Pressable' && String(host.props.accessibilityLabel).startsWith('Native boundary test movie')), false);
    assert.deepEqual(app.errors, []);
  } finally {release(); await app.unmount(); app.disposeLoader();}
});
