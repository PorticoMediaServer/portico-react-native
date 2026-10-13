/** X-04 (M21): Apple errors go through the shared presenter: a raw
 * `Error('ECONNRESET …')` renders catalogue copy, never the raw message. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {say, present} from '../src/app/errors.ts';

test('X-04: a raw ECONNRESET error says catalogue copy, not the raw message', () => {
  const body = say(new Error('ECONNRESET at 10.0.0.4:32400'), 'library', 'load');
  assert.doesNotMatch(body, /ECONNRESET/);
  assert.doesNotMatch(body, /10\.0\.0\.4/);
  assert.match(body, /Something went wrong|can’t reach your server/);
});

test('X-04: a dropped connection (TypeError) blames reachability, not the browser', () => {
  const body = say(new TypeError('Failed to fetch'), 'show', 'load');
  assert.doesNotMatch(body, /Failed to fetch/);
  assert.match(body, /can’t reach your server/);
});

test('X-04: cancellations stay silent', () => {
  assert.equal(say(Object.assign(new Error('aborted'), {name: 'AbortError'}), 'home', 'load'), '');
  assert.equal(present(Object.assign(new Error('aborted'), {name: 'AbortError'}), 'home').silent, true);
});


test('a redirect-incapable transport explains the unavailable device without offering a retry', () => {
  const error = Object.assign(new Error('private diagnostic'), {code: 'transport_unavailable'});
  for (const context of ['sign-in', 'playback', 'portico-account'] as const) {
    const shown = present(error, context);
    assert.equal(shown.messageId, 'error.transportUnavailable');
    assert.equal(shown.action, 'none');
    assert.doesNotMatch(shown.body, /private diagnostic|will keep trying/);
  }
});
