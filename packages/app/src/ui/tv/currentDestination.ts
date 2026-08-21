import type {PorticoRoute} from '../navigation';
import type {TVNavigationState} from '../tvNavigationState';
import {isTVPrimaryRoute, type TVPrimaryRouteName} from '../tvNavigationPolicy';

type RouteState = {key?: string; name: string; params?: unknown; state?: TVNavigationState};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function porticoRouteForTVScreen(name: string, params?: unknown): PorticoRoute | undefined {
  const values = params && typeof params === 'object' ? params as Record<string, unknown> : {};
  if (name === 'HomeRoot' || name === 'Home') return {name: 'home'};
  if (name === 'LibraryRoot' || name === 'Library') return {name: 'library', libraryId: optionalString(values.libraryId), pivot: optionalString(values.pivot)};
  if (name === 'ChannelsRoot' || name === 'Channels') return {name: 'channels', tab: optionalString(values.tab)};
  if (name === 'SavedRoot' || name === 'Saved') return {name: 'saved', tab: optionalString(values.tab)};
  if (name === 'Search') return {name: 'search', query: optionalString(values.query)};
  if (name === 'Settings') return {name: 'settings', section: optionalString(values.section)};
  if (name === 'Person' && optionalString(values.personId)) return {name: 'person', personId: String(values.personId)};
  if (name === 'Detail' && optionalString(values.mediaId)) return {...values, name: 'detail'} as Extract<PorticoRoute, {name: 'detail'}>;
  if (name === 'Player' && optionalString(values.mediaId)) return {...values, name: 'player'} as Extract<PorticoRoute, {name: 'player'}>;
  return undefined;
}

export interface TVCurrentDestination {
  atPrimaryRoot: boolean;
  primary?: TVPrimaryRouteName;
  route: PorticoRoute;
  sectionStackKey?: string;
  semanticKey: string;
}

function activeRoute(state: TVNavigationState | undefined): RouteState | undefined {
  if (!state?.routes.length) return undefined;
  return state.routes[state.index ?? 0] as RouteState | undefined;
}

/**
 * The sole semantic view of committed React Navigation state. This is a
 * projection, not route history: navigator state remains the only authority.
 */
export function resolveTVCurrentDestination(state: TVNavigationState | undefined): TVCurrentDestination {
  const root = activeRoute(state);
  const tabsState = root?.name === 'Product' ? root.state : state;
  const tab = activeRoute(tabsState);
  const primary = tab && isTVPrimaryRoute(tab.name) ? tab.name : undefined;
  const sectionState = primary ? tab?.state : undefined;
  const section = activeRoute(sectionState);
  let leaf = root;
  while (leaf?.state) leaf = activeRoute(leaf.state);
  const route: PorticoRoute = leaf
    ? porticoRouteForTVScreen(leaf.name, leaf.params) ?? {name: 'home'}
    : {name: 'home'};
  const atPrimaryRoot = Boolean(
    root?.name === 'Product'
      && primary
      && sectionState
      && (sectionState.index ?? 0) === 0
      && section
      && /Root$/.test(section.name),
  );
  return {
    atPrimaryRoot,
    primary,
    route,
    sectionStackKey: sectionState?.key,
    semanticKey: JSON.stringify([primary ?? '-', route]),
  };
}

export interface TVActivationTransaction<T> {
  id: number;
  intent: T;
  intentKey: string;
  sourceSemanticKey: string;
  status: 'requested' | 'committing' | 'committed' | 'cancelled';
}

/**
 * Semantic activation authority. Identical pending/committed requests join or
 * no-op; a different request explicitly cancels the previous request. Commits
 * remain fenced to the source committed-navigation snapshot.
 */
export class TVNavigationActivationTransactions<T> {
  private nextId = 0;
  private current?: TVActivationTransaction<T>;

  begin(source: TVCurrentDestination, intent: T, intentKey = JSON.stringify(intent)): TVActivationTransaction<T> {
    if (this.current
      && this.current.sourceSemanticKey === source.semanticKey
      && this.current.intentKey === intentKey
      && this.current.status !== 'cancelled') return this.current;
    if (this.current && this.current.status !== 'committed') this.current.status = 'cancelled';
    const transaction: TVActivationTransaction<T> = {
      id: ++this.nextId,
      intent,
      intentKey,
      sourceSemanticKey: source.semanticKey,
      status: 'requested',
    };
    this.current = transaction;
    return transaction;
  }

  commit(transaction: TVActivationTransaction<T>, current: TVCurrentDestination): T | undefined {
    if (this.current?.id !== transaction.id
      || transaction.status !== 'requested'
      || transaction.sourceSemanticKey !== current.semanticKey) {
      if (transaction.status === 'requested') transaction.status = 'cancelled';
      return undefined;
    }
    transaction.status = 'committing';
    transaction.status = 'committed';
    return transaction.intent;
  }

  cancel(): void {
    if (this.current && this.current.status !== 'committed') this.current.status = 'cancelled';
    this.current = undefined;
  }
}
