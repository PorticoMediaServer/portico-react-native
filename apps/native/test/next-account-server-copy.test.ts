import test from 'node:test';
import assert from 'node:assert/strict';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

// Independently transcribed frame/spec text. The pending canonical catalogue update is
// deliberately required; these expectations are not derived from the parser or catalogue.
test('actual server picker and sign-out confirmation name the captured verified server', async () => {
  const app = await standardHomeApp({accountRole: 'owner', nativeResponse: async (request: any) => {
    if (request.path === '/v1/sessions/current') return {status: 204};
    return undefined;
  }});
  try {
    await app.tapLabel('Profiles'); await app.tapLabel('Switch server');
    const labels = () => app.hosts().filter((host: any) => host.name === 'Text' || host.name === 'Pressable').map((host: any) => app.nativeLabel(host));
    assert.ok(labels().includes('Synthetic living room'));
    assert.equal(labels().includes('https://standard-home.test'), false);
    assert.equal(labels().includes('Sign in to a server'), false);
    assert.ok(labels().includes('Use a local server'));
    await app.tapLabel('Sign out');
    assert.ok(labels().includes("Sign out of Synthetic living room on this device? You'll need to sign in again."));
    assert.equal(labels().some((value: string) => value.includes('standard-home.test')), false);
    await app.tapLabel('Sign out');
    const {nativeAppSessions} = await import('../src-next/platform/app-session-storage.ts');
    assert.equal((await nativeAppSessions.read()).servers.length, 0);
  } finally {await app.unmount(); app.disposeLoader();}
});
