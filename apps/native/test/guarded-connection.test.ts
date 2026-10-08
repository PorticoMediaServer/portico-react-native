/**
 * MU1: the guarded screen's render decision (web parity: the page fails once).
 *
 * `guarded()` in `shell/ScreenBoundary.tsx` re-exports this pure decision function from the
 * store module (which has no React Native imports) so it runs under `node:test` without a
 * renderer; the component itself only maps the four outcomes to bodies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {CONNECTION_EXEMPT_SCREENS, connectionView, type ConnectionStatus} from '../src/app/connection-status.ts';

const hidden: ConnectionStatus = {shown: false, reason: null, generation: 0};
const shown: ConnectionStatus = {shown: true, reason: 'lost', generation: 1};
const recovered: ConnectionStatus = {shown: false, reason: null, generation: 1};

test('exempt screens always keep their content, whatever the connection does', () => {
  assert.deepEqual([...CONNECTION_EXEMPT_SCREENS].sort(), ['About', 'Account', 'Downloads', 'Gallery', 'Servers', 'Settings', 'SettingsPage']);
  for (const name of CONNECTION_EXEMPT_SCREENS) {
    assert.equal(connectionView({name, status: shown, mountedGeneration: 0, focused: true}), 'screen');
    assert.equal(connectionView({name, status: recovered, mountedGeneration: 0, focused: false}), 'screen');
    assert.equal(connectionView({name, status: hidden, mountedGeneration: 0, focused: false}), 'screen');
  }
});

test('a shown status replaces the page on show; covered screens keep their content', () => {
  for (const name of ['Home', 'Detail', 'Library', 'Search', 'Show']) {
    assert.equal(connectionView({name, status: shown, mountedGeneration: 0, focused: true}), 'status');
    // A covered or kept-alive screen isn't visible: unmounting it would only make every stack
    // reload at once on recovery. It keeps its content and remounts when next focused.
    assert.equal(connectionView({name, status: shown, mountedGeneration: 0, focused: false}), 'screen-stale');
  }
});

test('after recovery a focused screen remounts, a covered one waits until shown', () => {
  assert.equal(connectionView({name: 'Home', status: recovered, mountedGeneration: 0, focused: true}), 'remount');
  assert.equal(connectionView({name: 'Detail', status: recovered, mountedGeneration: 0, focused: false}), 'screen-stale');
  assert.equal(connectionView({name: 'Library', status: recovered, mountedGeneration: 1, focused: true}), 'screen');
  assert.equal(connectionView({name: 'Library', status: recovered, mountedGeneration: 1, focused: false}), 'screen');
});

test('a healthy screen with nothing to recover renders as today', () => {
  assert.equal(connectionView({name: 'Home', status: hidden, mountedGeneration: 0, focused: true}), 'screen');
});
