import test from 'node:test';
import assert from 'node:assert/strict';
import {landingChoice} from '../src/app/portico-landing.ts';

const a = {id: 'a'}, b = {id: 'b'};

test('one server opens by itself; several open the last used; otherwise the picker', () => {
  assert.deepEqual(landingChoice([a], undefined), {kind: 'open', server: a});
  assert.deepEqual(landingChoice([a], 'gone'), {kind: 'open', server: a});
  assert.deepEqual(landingChoice([a, b], 'b'), {kind: 'open', server: b});
  assert.deepEqual(landingChoice([a, b], undefined), {kind: 'pick'});
  assert.deepEqual(landingChoice([a, b], 'gone'), {kind: 'pick'}, 'a server no longer listed is not reopened');
  assert.deepEqual(landingChoice([], 'a'), {kind: 'none'});
});
