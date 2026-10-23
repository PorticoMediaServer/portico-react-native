import assert from 'node:assert/strict';
import test from 'node:test';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';

test('standard index/App Home actions use restored authority, current documents and real registered controller lifetimes', async t => {
  const app = await standardHomeApp();
  const sessions = () =>
    app.receipts.filter(
      receipt =>
        receipt.path === '/v1/playback/sessions' &&
        receipt.method === 'POST' &&
        receipt.status === 201,
    );
  const genericToast = () =>
    app
      .hosts()
      .some(
        host =>
          host.name === 'Text' &&
          host.children === 'Something went wrong. Try again.',
      );
  try {
    await t.test(
      'standard App reaches real Home after secure-record and verified-route restore',
      () => {
        assert.ok(
          app.hosts().some(host => host.props.testID === 'native-home'),
        );
        assert.ok(
          app.receipts.some(
            receipt =>
              receipt.path === '/v1/networking/identity-proof' &&
              receipt.status === 200,
          ),
        );
        assert.ok(
          app.receipts.some(
            receipt => receipt.path === '/v1/me' && receipt.status === 200,
          ),
        );
        assert.ok(
          app.receipts.some(
            receipt =>
              receipt.path === '/v1/me/devices/current/capabilities' &&
              receipt.status === 204,
          ),
        );
        assert.equal(sessions().length, 0);
      },
    );
    await t.test('phone Continue short tap opens its title without starting playback', async () => {
      const before = app.requests.length;
      await app.tap();
      assert.equal(sessions().length, 0);
      assert.equal(app.requests.slice(before).some(request => request.path.endsWith('/playback-options')), false);
      await app.back();
      assert.ok(app.card(), 'Back restores the genuine mounted Home card');
    });
    await t.test(
      'an HTTP boundary failure reaches the real Home toast and creates no session',
      async () => {
        app.fault({status: 500, code: 'r25_boundary_options_failure'});
        const warning = console.warn;
        try {
          console.warn = () => {throw Error('throwing Home diagnostic sink');};
          await app.more();
          await app.menuPlay();
        } finally {console.warn = warning;}
        assert.ok(
          app.receipts.some(
            receipt =>
              receipt.path === '/v1/items/movie/playback-options' &&
              receipt.status === 500 &&
              receipt.errorCode === 'r25_boundary_options_failure',
          ),
        );
        assert.equal(sessions().length, 0);
        assert.ok(
          genericToast(),
          'the same generic text alone cannot identify the failed call',
        );
        app.fault(undefined);
      },
    );
    await t.test(
      'real Home subscription refresh replaces callbacks and refuses an unoffered retained entry',
      async () => {
        const previous = app.card().props.onPress;
        await app.refresh();
        assert.notEqual(app.card().props.onPress, previous);
        const count = app.requests.length;
        previous();
        await app.settle();
        assert.equal(
          app.requests.length,
          count,
          'a deliberately retained stale callback cannot dispatch a title or playback',
        );
        assert.equal(sessions().length, 0);
        assert.ok(
          genericToast(),
          'a second distinct guarded failure also has generic text',
        );
      },
    );
    await t.test(
      'current native Continue menu Play traverses real options and creates a protocol session',
      async () => {
        const warning = console.warn;
        try {
          console.warn = () => {throw Error('throwing Home diagnostic sink');};
          await app.more();
          await app.menuPlay();
        } finally {console.warn = warning;}
        assert.ok(
          app.receipts.some(
            receipt =>
              receipt.path === '/v1/items/movie/playback-options' &&
              receipt.status === 200,
          ),
        );
        assert.equal(sessions().length, 1);
        assert.equal(
          app.errors.length,
          0,
          'real production Fabric commits have no rendering or nested-update error',
        );
      },
    );
    await t.test(
      'App unmount/restoration registers a genuine phone More menu whose Play resumes into a second session',
      async () => {
        await app.unmount();
        // server-connections intentionally keeps one app-global native monitor. Runtime subscriptions must retire.
        assert.deepEqual(app.subscriptions(), {
          listeners: 1,
          appState: 1,
          pending: 0,
          frames: 0,
        });
        await app.mount();
        await app.more();
        assert.ok(
          app
            .hosts()
            .some(
              host =>
                host.name === 'Pressable' &&
                host.props.accessibilityLabel === 'Play',
            ),
        );
        await app.menuPlay();
        assert.equal(
          sessions().length,
          2,
          'actual HomeWindow membership, controller menu and guarded playback port succeed',
        );
      },
    );
    await t.test(
      'changed server Home fence retires the real authority and removes Home',
      async () => {
        await app.retireHome();
        assert.equal(
          app.hosts().some(host => host.props.testID === 'native-home'),
          false,
        );
        assert.equal(sessions().length, 2);
      },
    );
  } finally {
    await app.unmount();
    app.disposeLoader();
  }
});
