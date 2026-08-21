import {
  TVRailFocusHandoff,
  tvRailHandoffCanComplete,
  tvFocusTargetForScope,
  type TVRailFocusTerminal,
} from './tvRailFocusHandoff';

describe('TVRailFocusHandoff', () => {
  test.each<TVRailFocusTerminal>(['completed', 'interrupted', 'cancelled'])(
    'returns the exact remembered destination after a %s collapse',
    terminal => {
      const target = {id: 'remembered-content'};
      const handoff = new TVRailFocusHandoff<typeof target>();
      const token = handoff.begin(target);
      expect(handoff.terminalize(token, terminal)).toBe(target);
      expect(handoff.complete(target)).toBe(true);
      expect(handoff.active).toBe(false);
    },
  );

  test('duplicate and stale terminal callbacks cannot restore another target', () => {
    const handoff = new TVRailFocusHandoff<{id: string}>();
    const stale = handoff.begin({id: 'old'});
    const currentTarget = {id: 'current'};
    const current = handoff.begin(currentTarget);
    expect(handoff.terminalize(stale, 'interrupted')).toBeUndefined();
    expect(handoff.terminalize(current, 'completed')).toBe(currentTarget);
    expect(handoff.complete(currentTarget)).toBe(true);
    expect(handoff.terminalize(current, 'cancelled')).toBeUndefined();
  });

  test('an absent destination remains contained until the current route supplies one', () => {
    const handoff = new TVRailFocusHandoff<{id: string}>();
    const token = handoff.begin(undefined);
    const target = {id: 'current-route-default'};
    expect(handoff.terminalize(token, 'cancelled')).toBeUndefined();
    expect(handoff.supplyTarget(target)).toBe(target);
    expect(handoff.complete(target)).toBe(true);
  });
});

test('route scoping rejects an exact node retained from another screen', () => {
  const target = {id: 'home-control'};
  const remembered = {scope: 'home', target};
  expect(tvFocusTargetForScope('home', remembered)).toBe(target);
  expect(tvFocusTargetForScope('settings', remembered)).toBeUndefined();
});

test('a newer rail focus or re-expansion invalidates an interrupted collapse', () => {
  const base = {collapseFocusEpoch: 4, currentFocusEpoch: 4, currentToken: 8, expanded: false, token: 8};
  expect(tvRailHandoffCanComplete(base)).toBe(true);
  expect(tvRailHandoffCanComplete({...base, currentFocusEpoch: 5})).toBe(false);
  expect(tvRailHandoffCanComplete({...base, expanded: true})).toBe(false);
  expect(tvRailHandoffCanComplete({...base, currentToken: 9})).toBe(false);
});
