import assert from 'node:assert/strict';
import test from 'node:test';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

test('a genuine Local refresh with an advanced horizon restores Home under a fresh authority', async t => {
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
    t.mock.timers.tick(59 * 60_000);
    await app.refresh();
    assert.equal(refreshes, 1, 'one real refresh request is shared by the foreground readers');
    assert.ok(app.hosts().some(host => host.props.testID === 'native-home'), 'a renewed Local family returns to Home, rather than the server picker');
    assert.notEqual(app.card().props.onPress, oldPress, 'the previous immutable authority is retired');
    const count = app.requests.length;
    oldPress({nativeEvent: {}, stopPropagation() {}});
    await app.settle();
    assert.equal(app.requests.length, count, 'a retained callback from the old authority remains fenced');
    await app.more();
    assert.ok(app.hosts().some(host => host.name === 'Pressable' && host.props.accessibilityLabel === 'Play'), 'new real Home membership is actionable after rebootstrap');
    assert.equal(app.errors.length, 0);
  } finally {await app.unmount(); app.disposeLoader();}
});
