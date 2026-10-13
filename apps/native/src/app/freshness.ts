import {useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState, Platform, useTVEventHandler} from 'react-native';
import {NavigationContext} from '@react-navigation/native';
import {DocumentPool, serviceDocument, type PooledDocument, type QuietService} from '../../../../packages/client-core/src/freshness-pool';
import {FreshnessHub, type FreshDocument, type FreshDocumentOptions, type FreshnessDependency, type Reachability} from '../../../../packages/client-core/src/freshness-hub';
import type {HttpLocalApi} from '../../../../packages/client-core/src/index';
import {useDeviceEvents} from './device-events';
import {useSession} from './session';
import {viewerScope} from './viewer-scope';

/**
 * Open screens that stay current, quietly (the shared rules are client-core's `freshness-hub`).
 *
 * One hub and one pool of last-known documents per signed-in viewer on one server. They outlive
 * the screens: opening the same title, show or library again shows what was last known at once.
 * A different viewer or server gets a new hub and pool; the old ones are let go with everything
 * they held. So does the same viewer under another role: what an owner was shown (files and
 * their places, people's activity, the owner's tabs) is not kept for the member they have become,
 * and nothing a member was refused is assumed for an owner. Every open screen reads again.
 *
 * On a phone, tablet or television a screen that another screen covers stays mounted. It is not
 * read while it is covered: it only remembers that something it shows has moved, and is brought
 * up to date, in place, when the person comes back to it. Focus and scroll position are the
 * screen's own and are not touched: a quiet read changes the data under stable keys, after the
 * person's input has paused.
 */
type Runtime = {api: HttpLocalApi; scope: string; hub: FreshnessHub; pool: DocumentPool};
let runtime: Runtime | undefined;

export function freshnessFor(api: HttpLocalApi, scope: {viewerId: string; serverId: string}, role = ''): Runtime {
  const key = scope.serverId + '\n' + scope.viewerId + '\n' + role;
  if (runtime && runtime.api === api && runtime.scope === key) return runtime;
  const old = runtime;
  const hub = new FreshnessHub();
  runtime = {api, scope: key, hub, pool: new DocumentPool(hub, {max: 24})};
  // Let go after this render: screens still unmounting release their documents first.
  if (old) setTimeout(() => { old.pool.dispose(); old.hub.dispose(); }, 0);
  return runtime;
}

export function useFreshness(): Runtime {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const role = session?.viewer.role ?? '';
  return useMemo(() => freshnessFor(api, scope, role), [api, scope, role]);
}

/** Tell the hub the person touched something just now (a touch on the root view; television keys are heard by the runtime). */
export function useInputPulse(): () => void {
  const {hub} = useFreshness();
  return useCallback(() => hub.touch(), [hub]);
}

/**
 * Mounted once in the signed-in shell. Feeds the hub what only the app knows: the device's event
 * feed, whether the app is in front, when a remote key was last pressed, and whether the
 * server's address answers.
 */
export function FreshnessRuntime() {
  const {api} = useSession();
  const {hub} = useFreshness();
  const events = useDeviceEvents();
  useEffect(() => { hub.attach(events); }, [hub, events]);
  useEffect(() => {
    const follow = () => hub.setActive(AppState.currentState === 'active');
    follow();
    const listener = AppState.addEventListener('change', follow);
    return () => listener.remove();
  }, [hub]);
  // A held direction key repeats: lists are not rearranged until the remote has been still for a moment.
  useTVEventHandler(() => { if (Platform.isTV) hub.touch(); });
  useEffect(() => {
    const source = {};
    const follow = () => {
      const phase = api.getRouteSnapshot()?.phase;
      // An address that proves another identity is not "can't reach": the shell says what it is.
      hub.report(source, phase !== 'offline' && phase !== 'probing');
    };
    follow();
    const off = api.subscribeRoute(follow);
    return () => { off(); hub.report(source, true); };
  }, [api, hub]);
  return null;
}

/** Whether the server has been out of reach for a while. It clears by itself. */
export function useReachability(): Reachability {
  const {hub} = useFreshness();
  return useSyncExternalStore(hub.subscribeReachability, hub.getReachability);
}

/** This screen is the one in front (not covered by a pushed screen). Outside a navigator: always. */
export function useScreenOpen(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => (navigation ? navigation.isFocused() : true));
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => { offFocus(); offBlur(); };
  }, [navigation]);
  return focused;
}

type MakeDocument<S> = () => {service: S; document: FreshDocumentOptions; watch?(document: FreshDocument): () => void};
type Store<T> = {getSnapshot(): T; subscribe(listener: () => void): () => void; dispose?(): void};

/**
 * A document kept in the viewer's pool under `key`: the same service, with what it has loaded,
 * every time the same thing is opened. `make` runs only when the pool has nothing under `key`.
 * The document counts as open while this component is mounted and its screen is in front.
 */
export function usePooled<S extends Store<T>, T>(key: string, make: MakeDocument<S>): {service: S; snapshot: T; document: FreshDocument; memo: Record<string, unknown>} {
  const {pool} = useFreshness();
  const open = useScreenOpen();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const entry = useMemo(() => pool.peek<S>(key, make), [pool, key]);
  const held = useRef<PooledDocument<S> | undefined>(undefined);
  useEffect(() => {
    const mine = pool.acquire<S>(key, make);
    held.current = mine;
    return () => { mine.release(); if (held.current === mine) held.current = undefined; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, key]);
  useEffect(() => { held.current?.setOpen(open); }, [open, pool, key]);
  const snapshot = useSyncExternalStore(entry.service.subscribe, entry.service.getSnapshot);
  return {service: entry.service, snapshot, document: entry.document, memo: entry.memo};
}

/**
 * A failure is not shown at once. While a first load that failed is being tried again by itself
 * (the first couple of attempts, a few seconds), the screen goes on showing that it is loading;
 * after that its own error state shows, with Try again, and the attempts continue behind it.
 */
export function useRecovering(document: FreshDocument): boolean {
  const state = useSyncExternalStore(document.subscribe, document.getState);
  return (state.stale || state.revalidating) && state.failures < 2;
}

/** `usePooled` for a client-core service that reads itself again with `revalidate()`. */
export function usePooledService<S extends QuietService & Store<T>, T>(key: string, create: () => S, dependencies: readonly FreshnessDependency[] | (() => readonly FreshnessDependency[]), options?: {hasContent?(service: S): boolean}) {
  const held = usePooled<S, T>(key, () => serviceDocument(create(), dependencies, options));
  const recovering = useRecovering(held.document);
  const shown = held.snapshot as T & {phase?: string; error?: unknown};
  // An error in its first moments, while the load is being tried again: still loading as far as the person is concerned.
  const quiet = recovering && shown.phase === 'error';
  const snapshot = useMemo(() => (quiet ? {...shown, phase: 'loading', error: null} as T : held.snapshot), [quiet, shown, held.snapshot]);
  return {...held, snapshot};
}

/**
 * Keeps something that is not pooled current while its screen is in front: `revalidate` is
 * called when one of `dependencies` moved, on the hub's usual terms (gathered, paused for input,
 * retried quietly). Returns `markCurrent`, for when the screen has just read it itself.
 */
export function useFreshDocument(dependencies: readonly FreshnessDependency[], revalidate: FreshDocumentOptions['revalidate'], hasContent: () => boolean = () => true): () => void {
  const {hub} = useFreshness();
  const open = useScreenOpen();
  const key = dependencies.join('\n');
  const latest = useRef({revalidate, hasContent});
  latest.current = {revalidate, hasContent};
  const held = useRef<FreshDocument | undefined>(undefined);
  useEffect(() => {
    const document = hub.document({dependencies: key ? key.split('\n') : [], revalidate: context => latest.current.revalidate(context), hasContent: () => latest.current.hasContent()});
    held.current = document;
    return () => { document.dispose(); if (held.current === document) held.current = undefined; };
  }, [hub, key]);
  useEffect(() => { held.current?.setOpen(open); }, [open, hub, key]);
  return useCallback(() => held.current?.markCurrent(), []);
}
