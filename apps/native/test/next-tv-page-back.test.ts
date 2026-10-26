import test from 'node:test';
import assert from 'node:assert/strict';
import {createFocusRegistry} from '../src-next/kit/focus/registry.ts';
import {createTVPageBack} from '../src-next/screens/destinations/tv-page-back.ts';

const first = {regionId: 'grid', childId: 'first'}, ninth = {regionId: 'grid', childId: 'ninth'};
function fixture() {
  const registry = createFocusRegistry();
  let top = false, current = true, scrolls = 0, requests = 0;
  registry.didFocus(ninth);
  const owner = createTVPageBack(registry, {current: () => current, start: () => first, atTop: () => top,
    scrollTop: () => {scrolls++; top = true;}});
  const mount = () => registry.attach(first, {requestTVFocus() {requests++; registry.didFocus(first);}});
  return {registry, owner, mount, retire: () => {current = false;}, counts: () => ({scrolls, requests})};
}
test('Back scrolls a virtualized page before requesting its real starting host, then yields to Home', () => {
  const f = fixture();
  assert.equal(f.owner.back(), true); assert.deepEqual(f.counts(), {scrolls: 1, requests: 0});
  assert.equal(f.owner.back(), true, 'an outstanding first jump cannot skip the page');
  f.mount(); assert.deepEqual(f.counts(), {scrolls: 1, requests: 1});
  assert.equal(f.owner.back(), false);
  assert.equal(f.registry.remembered('grid'), 'first'); f.owner.dispose();
});
test('a retired page or disposed owner never acquires focus when old data mounts', () => {
  for (const action of ['retire', 'dispose']) {
    const f = fixture(); f.owner.back();
    if (action === 'retire') f.retire(); else f.owner.dispose();
    f.mount(); assert.equal(f.counts().requests, 0); f.owner.dispose();
  }
});
test('a later genuine focus move cancels an outstanding Back jump', () => {
  const f = fixture(); f.owner.back(); f.registry.didFocus({regionId: 'rail', childId: 'saved'});
  f.mount(); assert.equal(f.counts().requests, 0); f.owner.dispose();
});
test('Back from the first item still resets nonzero scroll without clearing unrelated row memory', () => {
  const f = fixture(); f.registry.didFocus({regionId: 'other-row', childId: 'remembered'}); f.registry.didFocus(first); f.mount();
  assert.equal(f.owner.back(), true); assert.deepEqual(f.counts(), {scrolls: 1, requests: 1});
  assert.equal(f.registry.remembered('other-row'), 'remembered'); f.owner.dispose();
});

test('an evicted first item is resolved after the explicit scroll and real host attachment', () => {
  const registry = createFocusRegistry(); registry.didFocus(ninth);
  let top = false, loaded = false, requests = 0;
  const owner = createTVPageBack(registry, {current: () => true, start: () => loaded ? first : undefined,
    atTop: () => top, scrollTop: () => {top = true;}});
  assert.equal(owner.back(), true);
  loaded = true; registry.attach(first, {requestTVFocus() {requests++; registry.didFocus(first);}});
  assert.equal(requests, 1); assert.equal(owner.back(), false); owner.dispose();
});
