import {tvBackAction, tvBackOverrideRegistry} from './tvNavigationBack';

test('TV Back closes transient UI before touching route history', () => {
  expect(tvBackAction({canGoBack: true, transientOpen: true})).toBe(
    'close-transient',
  );
});

test('TV Back invokes the active player override after transients and before routes', () => {
  expect(
    tvBackAction({canGoBack: true, overrideOpen: true, transientOpen: false}),
  ).toBe('invoke-override');
  expect(
    tvBackAction({canGoBack: true, overrideOpen: true, transientOpen: true}),
  ).toBe('close-transient');
});

test('the latest mounted override owns exactly one Back action', () => {
  const first = jest.fn();
  const second = jest.fn();
  const releaseFirst = tvBackOverrideRegistry.register(first);
  const releaseSecond = tvBackOverrideRegistry.register(second);
  expect(tvBackOverrideRegistry.invoke()).toBe(true);
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  releaseFirst();
  expect(tvBackOverrideRegistry.active).toBe(true);
  releaseSecond();
  expect(tvBackOverrideRegistry.active).toBe(false);
});

test('TV Back pops the standard navigator when no transient UI or rail is open', () => {
  expect(tvBackAction({canGoBack: true, transientOpen: false})).toBe(
    'navigate-back',
  );
});

test('first discrete TV Back at a primary root focuses the rail, then passes exit to the system', () => {
  expect(
    tvBackAction({atPrimaryRoot: true, canGoBack: false, transientOpen: false}),
  ).toBe('open-rail');
  expect(
    tvBackAction({
      atPrimaryRoot: true,
      canGoBack: false,
      railOpen: true,
      railOrigin: 'back-root',
      transientOpen: false,
    }),
  ).toBe('system');
});

describe.each([
  ['secondary history', false, true, 'content', 'close-rail'],
  ['secondary without history', false, false, 'content', 'close-rail'],
  ['primary root opened from content', true, false, 'content', 'close-rail'],
  ['primary root opened by first Back', true, false, 'back-root', 'system'],
] as const)(
  'rail Back origin/history matrix: %s',
  (_case, atPrimaryRoot, canGoBack, railOrigin, expected) => {
    test(`resolves ${expected} before route history`, () => {
      expect(
        tvBackAction({
          atPrimaryRoot,
          canGoBack,
          railOpen: true,
          railOrigin,
          transientOpen: false,
        }),
      ).toBe(expected);
    });
  },
);

test('held and system-reserved Back/Menu behavior always remains with the OS', () => {
  expect(
    tvBackAction({
      atPrimaryRoot: true,
      canGoBack: true,
      eventKind: 'held',
      transientOpen: true,
    }),
  ).toBe('system');
  expect(
    tvBackAction({
      atPrimaryRoot: true,
      canGoBack: true,
      eventKind: 'system-reserved',
      transientOpen: true,
    }),
  ).toBe('system');
});
