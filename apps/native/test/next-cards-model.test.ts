import assert from 'node:assert/strict';
import {test} from 'node:test';
import {activateCard, cardProgress, holdCard, type CardActions} from '../src-next/kit/cards/model.ts';

test('title navigation and server-chosen playback keep independent callback identities', () => {
  const calls: string[] = [];
  const actions: CardActions = {onNavigate: () => calls.push('title:show'), onPlay: () => calls.push('play:next-episode')};
  activateCard(actions);
  activateCard({...actions, primaryAction: 'play'});
  assert.deepEqual(calls, ['title:show', 'play:next-episode']);
});

test('selection toggles by the caller identity and never starts playback or navigation', () => {
  const calls: string[] = [];
  const selection = {active: true, selected: false, onToggle: () => calls.push('toggle:item-id'), onEnter: () => calls.push('enter:item-id')};
  const actions: CardActions = {primaryAction: 'play', onPlay: () => calls.push('play'), onNavigate: () => calls.push('navigate'), selection, onMore: () => calls.push('menu')};
  activateCard(actions);
  holdCard(actions, false);
  holdCard(actions, true);
  assert.deepEqual(calls, ['toggle:item-id', 'enter:item-id', 'menu']);
});

test('TV menu remains a menu even when selection is active, and never invents Select', () => {
  const calls: string[] = [];
  const actions: CardActions = {onNavigate: () => calls.push('navigate'), selection: {active: true, selected: true, onToggle: () => calls.push('toggle'), onEnter: () => calls.push('enter')}};
  holdCard(actions, true);
  assert.deepEqual(calls, []);
  holdCard({...actions, onMore: () => calls.push('more')}, true);
  assert.deepEqual(calls, ['more']);
});

test('a phone card without selectable media retains its genuine long-press menu', () => {
  let menus = 0;
  holdCard({onNavigate() {}, onMore: () => menus++}, false);
  assert.equal(menus, 1);
});

test('unknown and nonfinite progress stays unknown; measured fractions remain bounded', () => {
  assert.equal(cardProgress(undefined), undefined);
  assert.equal(cardProgress(Number.NaN), undefined);
  assert.equal(cardProgress(Infinity), undefined);
  assert.equal(cardProgress(-1), 0);
  assert.equal(cardProgress(0), 0);
  assert.equal(cardProgress(0.38), 0.38);
  assert.equal(cardProgress(3), 1);
});
