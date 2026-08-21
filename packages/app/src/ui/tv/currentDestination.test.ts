import {TVNavigationActivationTransactions, resolveTVCurrentDestination} from './currentDestination';
import type {TVNavigationState} from '../tvNavigationState';

function fixture(leaf: {name: string; params?: object}, stackIndex = 0): TVNavigationState {
  return {
    index: 0,
    key: 'root',
    routeNames: ['Product'],
    routes: [{key: 'product', name: 'Product', state: {
      index: 1,
      key: 'tabs',
      routeNames: ['Home', 'Library'],
      routes: [
        {key: 'home-tab', name: 'Home'},
        {key: 'library-tab', name: 'Library', state: {
          index: stackIndex,
          key: 'library-stack',
          routeNames: ['LibraryRoot', 'Detail'],
          routes: stackIndex === 0 ? [leaf] : [{key: 'library-root', name: 'LibraryRoot'}, leaf],
          stale: false,
          type: 'stack',
        }},
      ],
      stale: false,
      type: 'tab',
    }}],
    stale: false,
    type: 'stack',
  } as unknown as TVNavigationState;
}

test('resolves semantic current destination and primary-root status from committed state', () => {
  expect(resolveTVCurrentDestination(fixture({name: 'LibraryRoot', params: {libraryId: 'music'}}))).toMatchObject({
    atPrimaryRoot: true,
    primary: 'Library',
    route: {libraryId: 'music', name: 'library'},
    sectionStackKey: 'library-stack',
  });
  expect(resolveTVCurrentDestination(fixture({name: 'Detail', params: {mediaId: 'movie'}}, 1))).toMatchObject({
    atPrimaryRoot: false,
    primary: 'Library',
    route: {mediaId: 'movie', name: 'detail'},
  });
});

test('activation transaction is last-wins and fenced to committed source state', () => {
  const root = resolveTVCurrentDestination(fixture({name: 'LibraryRoot'}));
  const detail = resolveTVCurrentDestination(fixture({name: 'Detail', params: {mediaId: 'movie'}}, 1));
  const transactions = new TVNavigationActivationTransactions<string>();
  const stale = transactions.begin(root, 'search');
  const latest = transactions.begin(root, 'settings');
  expect(transactions.commit(stale, root)).toBeUndefined();
  expect(transactions.commit(latest, detail)).toBeUndefined();
  expect(latest.status).toBe('cancelled');
});

test('activation transaction coalesces identical semantic intents and no-ops after commit', () => {
  const root = resolveTVCurrentDestination(fixture({name: 'LibraryRoot'}));
  const transactions = new TVNavigationActivationTransactions<{name: string}>();
  const first = transactions.begin(root, {name: 'Library'}, 'primary:Library');
  expect(transactions.begin(root, {name: 'Library'}, 'primary:Library')).toBe(first);
  expect(transactions.commit(first, root)).toEqual({name: 'Library'});
  expect(first.status).toBe('committed');
  expect(transactions.begin(root, {name: 'Library'}, 'primary:Library')).toBe(first);
  expect(transactions.commit(first, root)).toBeUndefined();
});
