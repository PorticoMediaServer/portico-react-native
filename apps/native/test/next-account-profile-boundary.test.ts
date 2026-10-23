import test from 'node:test';
import assert from 'node:assert/strict';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

test('actual shell profile switch keeps its captured server, publishes the selected viewer and retires only the old family', async () => {
  let alternate = false;
  const app = await standardHomeApp({accountRole: 'owner', nativeResponse: async (request: any, f: any) => {
    const viewer = {...f.viewer, ...(alternate ? {profileId: 'alternate', role: 'member'} : {})};
    if (request.path === '/v1/me') return {status: 200, body: {viewer}};
    if (request.path === '/v1/direct') return {status: 200, body: {authority: 'local', serverId: f.pin.serverId, canManage: !alternate,
      capabilities: {manageAccount: !alternate, managePeople: !alternate, manageServer: !alternate, manageSignIn: !alternate},
      account: {id: 'account', username: 'synthetic_owner', primaryProfileId: 'profile', role: 'owner', revision: 1, disabled: false, allowedLibraries: ['movies']},
      profiles: [{id: 'profile', name: 'Main viewer', primary: true, position: 0, art: 'mint', revision: 1, pinRevision: 1, pinRequired: false},
        {id: 'alternate', name: 'Second viewer', primary: false, position: 1, art: 'blue', revision: 1, pinRevision: 1, pinRequired: true}]}};
    if (request.path === '/v1/direct/profiles/alternate/select') {
      assert.equal(request.body.pin, '1234'); alternate = true;
      return {status: 200, body: {session: {...f.session, accessToken: 'alternate_access', sessionFamilyId: 'alternate_family', viewer: {...f.viewer, profileId: 'alternate', role: 'member'}}}};
    }
    if (request.path === '/v1/sessions/current') {
      assert.equal(new Headers(request.headers).get('Authorization'), 'Bearer fixture_access_only', 'only captured previous family is revoked');
      return {status: 204};
    }
    return undefined;
  }});
  try {
    assert.ok(app.hosts().some((host: any) => host.name === 'Pressable' && app.nativeLabel(host) === 'Profiles'), JSON.stringify(app.hosts().filter((host: any) => host.name === 'Text' || host.name === 'Pressable').map((host: any) => app.nativeLabel(host))));
    await app.tapLabel('Profiles'); await app.tapLabel('Switch profile');
    assert.ok(app.hosts().some((host: any) => host.name === 'Text' && app.nativeLabel(host) === 'Who’s watching on Synthetic living room?'));
    assert.ok(app.hosts().some((host: any) => host.name === 'Pressable' && app.nativeLabel(host) === 'Second viewer'),
      JSON.stringify(app.hosts().filter((host: any) => host.name === 'Pressable').map((host: any) => app.nativeLabel(host))));
    await app.tapLabel('Second viewer');
    await app.fill('Four-digit PIN', '1234'); await app.tapLabel('Continue');
    const {nativeAppSessions} = await import('../src-next/platform/app-session-storage.ts');
    const selected = await nativeAppSessions.selected();
    assert.equal(selected?.connection.session.viewer.profileId, 'alternate');
    assert.equal(selected?.connection.session.sessionFamilyId, 'alternate_family');
    assert.equal((await nativeAppSessions.read()).servers.length, 1);
    assert.ok(app.card(), 'normal shell restores the new profile');
    await app.tapLabel('Profiles');
    assert.equal(app.hosts().some((host: any) => host.name === 'Pressable' && app.nativeLabel(host) === 'Server dashboard'), false, 'non-main owner profile receives no management action');
    assert.equal(app.requests.filter((request: any) => request.path === '/v1/sessions/current').length, 1);
  } finally {await app.unmount(); app.disposeLoader();}
});
