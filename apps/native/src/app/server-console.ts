import {useFreshness} from './freshness';
import {dependsOn, type FreshnessDependency} from '../../../../packages/client-core/src/freshness-hub';
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {ConsoleClient} from '../../../../packages/client-core/src/console';
import {viewerScope} from '../../../../packages/client-core/src/presentation/index';
import {parseEnvelope} from '../../../../packages/client-core/src/administration';
import {useSession} from './session';
import {say} from './errors';

/**
 * The Server pages' plumbing on this app: the console client for the signed-in owner, a read that
 * keeps its last good value, and a serialised action. The documents, the labels and the save
 * model are client-core's (`server-admin/`); this file only binds them to React Native.
 */

/** One console client per signed-in owner. */
export function useConsole(): ConsoleClient {
  const {api, session} = useSession();
  const {viewerId, serverId} = viewerScope(session, api);
  const client = useMemo(() => new ConsoleClient(api, {viewerId, serverId}), [api, viewerId, serverId]);
  useEffect(() => () => client.dispose(), [client]);
  return client;
}

/** The server every administration answer must name. */
export function useServerId(): string {
  const {system, session} = useSession();
  return system?.id ?? session?.viewer.serverId ?? '';
}

/**
 * One refresh for a whole page: every read on the page joins the scope, and pulling the page down
 * (or its Refresh) reads them all again. No panel shows a refresh of its own.
 */
export class RefreshScope {
  private reloads = new Set<() => void>();
  join(reload: () => void): () => void { this.reloads.add(reload); return () => { this.reloads.delete(reload); }; }
  refresh = () => { for (const reload of this.reloads) reload(); };
}
export const RefreshScopeContext = createContext<RefreshScope | null>(null);

/** How the now-playing driver sees this app: in front or not. */
export const appEnvironment = {
  setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimer: (t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>),
  hidden: () => AppState.currentState !== 'active',
  onVisibility: (fn: () => void) => { const sub = AppState.addEventListener('change', fn); return () => sub.remove(); },
};

export type Read<T> = {data?: T; error?: string; loading: boolean; at?: number; reload: () => void};

/** The server's work as it happens: a scan's progress and a task's change of state arrive on the event feed. */
export const TASK_EVENTS: readonly FreshnessDependency[] = Object.freeze([dependsOn.event('operation.updated'), dependsOn.event('library.scan.updated'), dependsOn.event('job.updated')]);

/** A read with retry and stale-result fencing; `every` re-reads while the app is in front. */
export function useRead<T>(fn: () => Promise<T>, deps: readonly unknown[], options: {auto?: boolean; every?: number; /** Read again, quietly, when any of these moves on the event feed (a scan's progress, a task's state). */ on?: readonly FreshnessDependency[]} = {}): Read<T> {
  const [state, setState] = useState<{data?: T; error?: string; loading: boolean; at?: number}>({loading: options.auto !== false});
  const seq = useRef(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const reload = useCallback(() => {
    const n = ++seq.current;
    setState(s => ({...s, loading: true, error: undefined}));
    fn().then(
      data => { if (live.current && n === seq.current) setState({data, loading: false, at: Date.now()}); },
      e => { if (live.current && n === seq.current) setState(s => ({...s, loading: false, error: problem(e)})); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  const scope = useContext(RefreshScopeContext);
  useEffect(() => scope?.join(reload), [scope, reload]);
  useEffect(() => {
    if (options.auto === false) return;
    reload();
    if (!options.every) return;
    const timer = setInterval(() => { if (AppState.currentState === 'active') reload(); }, options.every);
    return () => clearInterval(timer);
  }, [reload, options.auto, options.every]);
  // The feed says when something this read shows has moved; hints that arrive together are answered by one read.
  const {hub} = useFreshness();
  const on = options.on?.join('\n') ?? '';
  useEffect(() => {
    if (!on || options.auto === false) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = hub.watch(on.split('\n'), () => {
      if (timer !== undefined || AppState.currentState !== 'active') return;
      timer = setTimeout(() => { timer = undefined; reload(); }, 600);
    });
    return () => { off(); if (timer !== undefined) clearTimeout(timer); };
  }, [hub, on, reload, options.auto]);
  return {...state, reload};
}

/** One mutation at a time, with one error. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      if (live.current) setError(problem(e, 'action'));
      return false;
    } finally {
      if (live.current) setBusy(false);
    }
  }, [busy]);
  return {busy, error, run, clear: () => setError('')};
}

export {findInPages, saveRebased, sendFresh, untilDone} from './fresh-send';

/** Console failures in plain words (X-04), from the shared presenter. */
export function problem(e: unknown, operation: 'load' | 'action' = 'load'): string {
  return say(e, 'server-console', operation);
}

/** A 404 from a console read means the feature isn't set up on this server: an empty state, never an error. */
export const unconfigured = <T,>(read: Promise<T>): Promise<T | null> => read.catch(e => ((e as {status?: number} | null)?.status === 404 ? null : Promise.reject(e)));

/** 48 lowercase hex characters: the shape every write route accepts. Uniqueness, not secrecy (Hermes has no `crypto`). */
export function operationId(): string {
  let out = '';
  for (let i = 0; i < 48; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

/** A client-core service and its snapshot for the life of the screen. */
export function useService<S extends {subscribe: (l: () => void) => () => void; getSnapshot: () => T; dispose?: () => void}, T>(factory: () => S, deps: readonly unknown[]): {service: S; snapshot: T} {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const service = useMemo(factory, deps);
  const [snapshot, setSnapshot] = useState<T>(() => service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => { unsubscribe(); service.dispose?.(); };
  }, [service]);
  return {service, snapshot};
}

/** Typed calls against the administration envelope: every answer names the server it came from, and one from another server is refused. */
export function useAdmin() {
  const {api} = useSession();
  const serverId = useServerId();
  return useMemo(() => ({
    get: async <T,>(path: string, read: (raw: unknown) => T) => parseEnvelope(await api.request<unknown>(path), serverId, read).result,
    send: async <T,>(path: string, body: unknown, read: (raw: unknown) => T = raw => raw as T, method = 'POST') => parseEnvelope(await api.request<unknown>(path, method, body), serverId, read).result,
  }), [api, serverId]);
}

/** A server page's `nextCursor`, or '' (a malformed one ends the list rather than looping). */
export const nextCursorOf = (raw: unknown): string => {
  const c = (raw as {nextCursor?: unknown} | null)?.nextCursor;
  return typeof c === 'string' && c.length <= 2048 ? c : '';
};
/** Appends a cursor to a list path. */
export const withCursor = (path: string, cursor: string) => (cursor ? `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}` : path);

/**
 * A list read one server page at a time, growing as "Show more" is pressed: every row stays
 * reachable and nothing asks for the whole list at once. With `on`, it is kept current quietly:
 * when the feed says the list moved, every page shown so far is read again in one go, so the rows
 * the owner opened stay open and nothing collapses back to the first page.
 */
export function usePagedList<T>(fetch: (cursor: string) => Promise<{items: T[]; nextCursor: string}>, deps: readonly unknown[], options: {/** False: nothing is read until it turns true (a list behind a row that opens it). */ auto?: boolean; /** Read again, quietly, when any of these moves on the event feed. */ on?: readonly FreshnessDependency[]} = {}): {items?: T[]; error?: string; loading: boolean; more: boolean; loadMore: () => void; reload: () => void} {
  const [extra, setExtra] = useState<{items: T[]; nextCursor: string; pages: number}>();
  const [loadingMore, setLoadingMore] = useState(false);
  // How many pages are shown: what a quiet read reads again (bounded by what the owner asked for).
  const shownPages = useRef(1);
  shownPages.current = 1 + (extra?.pages ?? 0);
  const first = useRead(async () => {
    const head = await fetch('');
    const want = shownPages.current;
    if (want <= 1 || !head.nextCursor) return {head, rest: undefined};
    const items: T[] = [];
    const followed = new Set<string>();
    let cursor = head.nextCursor, pages = 0;
    while (pages < want - 1 && cursor && !followed.has(cursor)) {
      followed.add(cursor);
      const page = await fetch(cursor);
      items.push(...page.items);
      cursor = page.nextCursor;
      pages++;
    }
    return {head, rest: {items, nextCursor: cursor, pages}};
  }, deps, options);
  useEffect(() => { setExtra(first.data?.rest); }, [first.data]);
  const next = extra ? extra.nextCursor : first.data?.head.nextCursor ?? '';
  const loadMore = useCallback(() => {
    if (!next || loadingMore) return;
    setLoadingMore(true);
    fetch(next).then(page => setExtra(e => ({items: [...(e?.items ?? []), ...page.items], nextCursor: page.nextCursor, pages: (e?.pages ?? 0) + 1})), () => {}).finally(() => setLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [next, loadingMore, ...deps]);
  return {items: first.data ? [...first.data.head.items, ...(extra?.items ?? [])] : undefined, error: first.error, loading: first.loading || loadingMore, more: !!next, loadMore, reload: first.reload};
}
