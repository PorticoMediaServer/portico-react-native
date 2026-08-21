import {boundedPlayerPosition, playerTimelinePressTarget, playerTimelineRemoteDelta} from './playerTimelineModel';

test('timeline model clamps positions and maps remote directions without geometry guesses', () => {
  expect(boundedPlayerPosition(-4, 100)).toBe(0);
  expect(boundedPlayerPosition(140, 100)).toBe(100);
  expect(playerTimelineRemoteDelta('left', 15)).toBe(-15);
  expect(playerTimelineRemoteDelta('right', 15)).toBe(15);
  expect(playerTimelineRemoteDelta('select', 15)).toBeUndefined();
});

test('touch timeline targeting rejects missing geometry', () => {
  expect(playerTimelinePressTarget(50, 100, 200)).toBe(100);
  expect(playerTimelinePressTarget(50, 0, 200)).toBeUndefined();
});
