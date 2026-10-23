import assert from 'node:assert/strict';
import test from 'node:test';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

test('a genuine Local refresh advances its inactivity horizon without retiring Home or its persistent Surface', async t => {
  t.mock.timers.enable({apis: ['Date'], now: Date.now()});
  let refreshes = 0;
  const app = await standardHomeApp({nativeResponse: async (request: any, fixture: any) => {
    if (request.path !== '/v1/auth/refresh') return undefined;
    refreshes++;
    assert.equal(request.body.installationId, fixture.installationId);
    return {status: 200, body: {...fixture.session,
      accessToken: 'synthetic_refreshed_access', refreshToken: 'synthetic_refreshed_credential', tokenGeneration: '2',
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), authorizationHorizon: new Date(Date.now() + 90 * 86_400_000).toISOString()}};
  }});
  try {
    const oldPress = app.card().props.onPress;
    const surface = app.hosts().find(host => host.name === 'PorticoPlayer')?.host;
    assert.ok(surface);
    t.mock.timers.tick(59 * 60_000);
    await app.refresh();
    assert.equal(refreshes, 1, 'one real refresh request is shared by the foreground readers');
    assert.ok(app.hosts().some(host => host.props.testID === 'native-home'), 'a renewed Local family returns to Home, rather than the server picker');
    assert.equal(app.hosts().find(host => host.name === 'PorticoPlayer')?.host, surface, 'the same admitted family keeps its actual native Surface');
    assert.notEqual(app.card().props.onPress, oldPress, 'the foreground Home read replaces the old document callback');
    const count = app.requests.length;
    oldPress({nativeEvent: {}, stopPropagation() {}});
    await app.settle();
    assert.equal(app.requests.length, count, 'a retained callback from the replaced Home document remains fenced');
    await app.more();
    assert.ok(app.hosts().some(host => host.name === 'Pressable' && host.props.accessibilityLabel === 'Play'), 'new real Home membership is actionable after rebootstrap');
    assert.equal(app.errors.length, 0);
  } finally {await app.unmount(); app.disposeLoader();}
});
