import test from 'node:test';
import assert from 'node:assert/strict';
import {playerControlsRevealDeadline, resolvePlayerPresentation, type PlayerFold, type PlayerPresentationInput} from '../src-next/platform/layout/player-presentation.ts';

// Source-only drafts. Geometry assertions do not establish device continuity or frame fidelity.
const input = (width: number, height: number, folds: readonly PlayerFold[] = []): PlayerPresentationInput => ({
  window: {width, height}, posture: {status: 'available', window: {width, height}, folds}, docked: false, panelOpen: false,
});
const vertical: PlayerFold = {bounds: {left: 445, right: 445, top: 0, bottom: 626}, orientation: 'vertical', state: 'flat'};

test('Q7 flat-wide Duo uses the whole window across the faint crease and letterboxes16:9', () => {
  const p = resolvePlayerPresentation(input(890, 626, [vertical]))!;
  assert.equal(p.mode, 'full-window');
  assert.deepEqual(p.surface, {x: 0, y: 0, width: 890, height: 626});
  assert.deepEqual(p.picture, {x: 0, y: 62.6875, width: 890, height: 500.625});
  assert.equal(p.hideStatusBar, true);
  assert.equal(p.hideNavigation, true);
  assert.equal(p.hingeBand, undefined);
});

test('Q7 flat-tall and closed return the full-width watch picture without splitting on a crease', () => {
  const fold: PlayerFold = {...vertical, bounds: {left: 420, right: 420, top: 0, bottom: 880}};
  for (const next of [input(840, 880, [fold]), input(466, 678)]) {
    const p = resolvePlayerPresentation(next)!;
    assert.equal(p.mode, 'watch');
    assert.equal(p.surface!.width, next.window.width);
    assert.equal(p.surface!.height, next.window.width * 9 / 16);
    assert.equal(p.hingeBand, undefined);
    assert.equal(p.content!.y, p.surface!.height);
  }
});

test('8123g keeps the picture on its physical page and touchable chrome outside the padded hinge band', () => {
  const fold: PlayerFold = {...vertical, state: 'half-opened', bounds: {...vertical.bounds, left: 437, right: 453}};
  const p = resolvePlayerPresentation(input(890, 626, [fold]))!;
  assert.equal(p.mode, 'book');
  assert.deepEqual(p.hingeBand, {x: 421, y: 0, width: 48, height: 626});
  assert.equal(p.surface!.x + p.surface!.width, fold.bounds.left);
  assert.deepEqual(p.content, {x: 469, y: 0, width: 421, height: 626});
  assert.equal(p.controls!.x + p.controls!.width, p.hingeBand!.x);
  assert.equal(p.details!.x + p.details!.width, p.hingeBand!.x);
  assert.equal(p.picture!.x + p.picture!.width, fold.bounds.left, 'the picture never crosses the physical hinge');
  const duo = resolvePlayerPresentation(input(890, 626, [{...vertical, state: 'half-opened'}]))!;
  assert.deepEqual(duo.picture, {x: 0, y: 0, width: 445, height: 250.3125});
  assert.equal(duo.controls!.width, 429, '3g top/bottom/seek chrome ends16pt short of the crease');
});

test('tabletop4/5 keep picture above the horizontal hinge and all controls below, always shown', () => {
  for (const [width, height, top, bottom] of [[626, 890, 437, 453], [840, 880, 432, 448]]) {
    const fold: PlayerFold = {orientation: 'horizontal', state: 'half-opened', bounds: {left: 0, right: width!, top: top!, bottom: bottom!}};
    const p = resolvePlayerPresentation(input(width!, height!, [fold]))!;
    assert.equal(p.mode, 'tabletop');
    assert.equal(p.surface!.height, top! - 16);
    assert.equal(p.controls!.y, bottom! + 16);
    assert.equal(p.controlsAutoHide, false);
    assert.equal(p.controls!.y + p.controls!.height, height);
  }
});

test('full-window panels take the exact right page or tablet-play380pt beside the picture', () => {
  const duo = resolvePlayerPresentation({...input(890, 626, [vertical]), panelOpen: true})!;
  assert.deepEqual(duo.panel, {x: 445, y: 0, width: 445, height: 626});
  assert.equal(duo.surface!.width, 445);
  assert.equal(duo.controlsHidden, true);
  assert.equal(duo.controls, undefined);
  const tablet = resolvePlayerPresentation({...input(1180, 820), panelOpen: true})!;
  assert.deepEqual(tablet.panel, {x: 800, y: 0, width: 380, height: 820});
  assert.deepEqual(tablet.picture, {x: 0, y: 185, width: 800, height: 450});
  const medium = resolvePlayerPresentation({...input(626, 400), panelOpen: true})!;
  assert.equal(medium.panel!.width, 380);
});

test('3f keeps the docked state and measured-slot authority through every posture', () => {
  for (const next of [input(466, 678), input(890, 626, [vertical]), input(840, 880), input(890, 626, [{...vertical, state: 'half-opened'}])]) {
    assert.deepEqual(resolvePlayerPresentation({...next, docked: true, panelOpen: true}), {
      mode: 'docked', hideNavigation: false, hideStatusBar: false, controlsAutoHide: false, controlsHidden: false,
    });
  }
});

test('a stale or unsupported posture cannot reserve a hinge from the old window', () => {
  const next = input(890, 626, [{...vertical, state: 'half-opened'}]);
  for (const posture of [{...next.posture, window: {width: 626, height: 890}}, {...next.posture, status: 'pending' as const},
    {...next.posture, status: 'unavailable' as const, window: null}, {...next.posture, folds: [vertical, vertical]}]) {
    assert.equal(resolvePlayerPresentation({...next, posture})!.mode, 'full-window');
  }
  for (const width of [0, -1, Infinity, NaN]) assert.equal(resolvePlayerPresentation({...next, window: {width, height: 626}}), undefined);
});

test('notes/foldable9 reveals for exactly3s on fold/unfold/turn, except under the3d full-window panel', () => {
  const wide = input(890, 626, [vertical]), book = input(890, 626, [{...vertical, state: 'half-opened'}]), tall = input(626, 890);
  assert.equal(playerControlsRevealDeadline(wide, book, 100), 3100);
  assert.equal(playerControlsRevealDeadline(book, wide, 200), 3200);
  assert.equal(playerControlsRevealDeadline(wide, tall, 300), 3300);
  assert.equal(playerControlsRevealDeadline(wide, {...wide, panelOpen: true}, 400, 3300), 0);
  assert.equal(playerControlsRevealDeadline(undefined, wide, 500), 0);
  assert.equal(playerControlsRevealDeadline(wide, {...tall, docked: true}, 600, 3300), 0);
  assert.equal(playerControlsRevealDeadline(tall, {...wide, panelOpen: true}, 700, 3300), 0, 'unfolding with the panel open does not reveal controls');
  assert.equal(playerControlsRevealDeadline({...wide, panelOpen: true}, wide, 800, 0), 0, 'panel closure alone is not a fold reveal');
  const tabletop = input(626, 890, [{orientation: 'horizontal', state: 'half-opened', bounds: {left: 0, top: 445, right: 626, bottom: 445}}]);
  assert.equal(resolvePlayerPresentation({...tabletop, panelOpen: true})!.controlsHidden, false, 'tabletop keeps its bottom controls visible');
});
