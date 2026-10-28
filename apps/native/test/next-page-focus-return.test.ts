import assert from 'node:assert/strict';
import test from 'node:test';
import {canReturnToPage} from '../src-next/shell/page-focus-return.ts';

test('player exit restores every captured shell destination, not just Home', () => {
  for (const destination of [{kind: 'home'}, {kind: 'search'}, {kind: 'saved'}, {kind: 'live'}, {kind: 'library', libraryId: 'movies'}] as const) {
    assert.equal(canReturnToPage(JSON.stringify(destination), {destination, homeVisible: destination.kind === 'home', contentVisible: true}, false, false), true);
  }
});
test('retired page identity and every covering state refuse opener restoration', () => {
  const destination = {kind: 'library', libraryId: 'movies'} as const, captured = JSON.stringify(destination);
  const current = {destination, homeVisible: false, contentVisible: true};
  for (const replacement of [{destination: {kind: 'search'} as const}, {destination: {kind: 'library', libraryId: 'music'} as const}, {contentVisible: false}, {homeObscured: true}, {mediaExpanded: true}, {selectionActive: true}]) {
    assert.equal(canReturnToPage(captured, {...current, ...replacement}, false, false), false);
  }
  assert.equal(canReturnToPage(captured, current, true, false), false);
  assert.equal(canReturnToPage(captured, current, false, true), false);
  const home = {kind: 'home'} as const;
  assert.equal(canReturnToPage(JSON.stringify(home), {destination: home, homeVisible: false}, false, false), false);
});
