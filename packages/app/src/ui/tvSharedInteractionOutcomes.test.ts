import {
  TVLogicalFocusRegistry,
  TVSemanticFocusMemory,
} from '@portico-react-native/tv-focus';
import {tvBackAction} from './tvNavigationBack';
import {
  TVNavigationActivationTransactions,
  resolveTVCurrentDestination,
} from './tv/currentDestination';

type FixtureCase = {
  id: string;
  category: string;
  initial: any;
  events: any[];
  expected: any;
};
const fixture =
  require('../../../../scripts/parity/tv-interaction-outcomes.v1.json') as {
    cases: FixtureCase[];
    auditTrace: {issue: string; outcome: string}[];
  };
const byId = Object.fromEntries(
  fixture.cases.map(item => [item.id, item]),
) as Record<string, FixtureCase>;

test('shared TV destination, Back, activation, focus, modal, and player outcomes are internally coherent', () => {
  const destination = resolveTVCurrentDestination({
    index: 0,
    key: 'root',
    routeNames: ['Product'],
    routes: [
      {
        key: 'product',
        name: 'Product',
        state: {
          index: 0,
          key: 'tabs',
          routeNames: ['Library'],
          routes: [
            {
              key: 'library',
              name: 'Library',
              state: {
                index: 0,
                key: 'library-stack',
                routeNames: ['LibraryRoot'],
                routes: [{key: 'library-root', name: 'LibraryRoot'}],
                stale: false,
                type: 'stack',
              },
            },
          ],
          stale: false,
          type: 'tab',
        },
      },
    ],
    stale: false,
    type: 'stack',
  });
  expect(destination.route.name).toBe(
    byId['destination-primary-replaces-history'].expected.current,
  );
  expect(destination.atPrimaryRoot).toBe(true);

  const historyBack = byId['back-history-before-root-reveal'];
  expect(
    tvBackAction({
      canGoBack: historyBack.initial.history.length > 0,
      transientOpen: false,
    }),
  ).toBe(historyBack.expected.outcomes[0]);

  const rootBack = byId['back-root-reveal-then-system'];
  const rootOutcomes = [
    tvBackAction({atPrimaryRoot: true, canGoBack: false, transientOpen: false}),
    tvBackAction({
      atPrimaryRoot: true,
      canGoBack: false,
      railOpen: true,
      railOrigin: 'back-root',
      transientOpen: false,
    }),
  ].map(outcome => (outcome === 'system' ? 'system-exit' : outcome));
  expect(rootOutcomes).toEqual(rootBack.expected.outcomes);
  const dpadRail = byId['back-dpad-rail-restores-invoker'];
  expect(
    tvBackAction({
      canGoBack: dpadRail.initial.history.length > 0,
      railOpen: dpadRail.initial.rail === 'open',
      railOrigin: dpadRail.initial.railOrigin === 'dpad' ? 'content' : 'none',
      transientOpen: false,
    }),
  ).toBe(dpadRail.expected.outcomes[0]);

  const repeat = byId['activation-held-select-coalesces'];
  const activations = new TVNavigationActivationTransactions<string>();
  const source = resolveTVCurrentDestination(undefined);
  const firstActivation = activations.begin(
    source,
    repeat.events[0].intent,
    repeat.events[0].intent,
  );
  const joinedActivation = activations.begin(
    source,
    repeat.events[1].intent,
    repeat.events[1].intent,
  );
  expect(joinedActivation).toBe(firstActivation);
  expect(activations.commit(firstActivation, source)).toBe(
    firstActivation.intent,
  );
  expect(firstActivation.status).toBe(repeat.expected.finalState);
  const stale = byId['activation-stale-completion-cancelled'];
  const staleActivations = new TVNavigationActivationTransactions<string>();
  const staleTransaction = staleActivations.begin(
    source,
    stale.events[0].intent,
    stale.events[0].intent,
  );
  const changedSource = {
    ...source,
    semanticKey: `${source.semanticKey}:route-13`,
  };
  expect(
    staleActivations.commit(staleTransaction, changedSource),
  ).toBeUndefined();
  expect(staleTransaction.status).toBe(stale.expected.finalState);

  for (const id of [
    'focus-removed-item-falls-back-semantically',
    'focus-reorder-preserves-semantic-id',
  ]) {
    const vector = byId[id];
    const registry = new TVLogicalFocusRegistry<object>();
    registry.registerContainer({
      id: vector.initial.container instanceof Array ? id : 'fixture',
    });
    const original =
      vector.initial.container instanceof Array
        ? vector.initial.container
        : vector.events[0].targets;
    original.forEach((focusId: string, index: number) =>
      registry.registerNode({
        containerId: vector.initial.container instanceof Array ? id : 'fixture',
        id: focusId,
        order: index,
      }),
    );
    const targets = vector.events[0].targets as string[];
    targets.forEach((focusId: string) => registry.mount(focusId, {}));
    const remembered = registry.target(vector.initial.focused)
      ? vector.initial.focused
      : registry.nearestMounted(vector.initial.focused)?.focusId;
    expect(remembered).toBe(vector.expected.focused);
  }
  const modal = byId['focus-modal-traps-and-restores-invoker'];
  const modalMemory = new TVSemanticFocusMemory();
  modalMemory.remember('settings', modal.initial.focused, 1, 1);
  expect(modalMemory.recall('settings', 1, 1)).toBe(modal.expected.focused);
  expect(modal.expected.blockedBoundaries).toBe(1);
  expect(byId['focus-content-to-rail-boundary'].expected.container).toBe(
    'scene.rail',
  );

  expect(
    byId['player-five-transport-to-utilities'].expected.transportOrder,
  ).toEqual(['previous', 'seek-back', 'play-pause', 'seek-forward', 'next']);
  expect(
    byId['player-five-transport-to-utilities'].expected.utilityOrder,
  ).toEqual(['volume', 'subtitles', 'quality', 'speed', 'sleep', 'queue']);
  expect(byId['player-five-transport-to-utilities'].expected.focused).toBe(
    'player.utility.volume',
  );
  expect(
    byId['player-back-unwinds-panel-before-exit'].expected.outcomes,
  ).toEqual(['close-panel', 'close-utility', 'exit-video']);
  expect(byId['player-audio-back-returns-to-browsing'].expected).toMatchObject({
    stopPlayback: false,
    persistenceScope: 'in-app-only',
  });
});

test('shared TV fixture traces every approved remaining Roku audit outcome', () => {
  expect(fixture.auditTrace.map(item => item.issue)).toEqual([
    'RK-31',
    'RK-33',
    'RK-34',
    'RK-35',
    'RK-36',
    'RK-37',
    'RK-38',
    'RK-39',
    'RK-40',
  ]);
  expect(fixture.auditTrace.every(item => item.outcome.trim().length > 0)).toBe(
    true,
  );
});
