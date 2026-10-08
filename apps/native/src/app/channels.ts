import {useCallback, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {NativeModules} from 'react-native';
import type {ChannelApi} from '../../../../packages/client-core/src/channel-guide';
import {legacyChannelSources, type ChannelSource} from '../../../../packages/client-core/src/guide/index';
import {defaultI18n} from '../../../../packages/i18n/src/index';
import {NativeQueueStore} from '../bridge/queue-storage';
import {viewerScope} from './content';
import {hasRealOrigin, useSession} from './session';
import {REMINDER_LEAD_MS, liveReminders, localTimezone, parseChannelMemory, rememberChoice, toggledReminders, type ChannelMemory, type ChannelSort, type ChannelView, type Reminder} from './channels-model';

export * from './channels-model';

/**
 * Channels (Spec — Channels and Guide §2, §6, §8.1): the viewer's channel sources for the rail and
 * the Channels screens, a guide data source per entry over today's `/v1/guide` (the §8.1 stopgap),
 * the per-source view and sort memory, and in-app reminders.
 *
 * Follows the web's `app/channels.tsx`. Like it, the adapter keeps the raw `GuideChannel` and
 * `GuideProgramme` objects by id: tuning, recording and favorites still take the raw types, and the
 * program sheet needs the description the §9 types don't carry yet.
 */

// ── Sources for the rail and the screens ─────────────────────────

type SourcesSnapshot = Readonly<{sources: readonly ChannelSource[]; loading: boolean; failed: boolean}>;
const emptySources: SourcesSnapshot = Object.freeze({sources: [], loading: false, failed: false});

/** One read per signed-in viewer, shared by the rail and the screens (no provider needed). */
class SourcesStore {
  private snapshot: SourcesSnapshot = {sources: [], loading: true, failed: false};
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  constructor(private api: ChannelApi, private serverId: string) {}
  /** A new sign-in as the same viewer brings a new API: the store uses it from now on (the old
   * one's credentials are gone), and a load that failed is tried again with it. */
  bind(api: ChannelApi) {
    if (api === this.api) return;
    this.api = api;
    if (this.snapshot.failed) { this.set({...this.snapshot, loading: true}); if (this.listeners.size) this.load(); }
  }
  get = () => this.snapshot;
  subscribe = (fn: () => void) => { this.listeners.add(fn); if (this.listeners.size === 1 && !this.controller && this.snapshot.loading) this.load(); return () => { this.listeners.delete(fn); }; };
  load = () => {
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.set({...this.snapshot, loading: true});
    legacyChannelSources(this.api, this.serverId, localTimezone(), defaultI18n.t('channels.custom.name'), Date.now(), controller.signal).then(
      sources => { if (!controller.signal.aborted) this.set({sources: [...sources].sort((a, b) => a.position - b.position), loading: false, failed: false}); },
      () => { if (!controller.signal.aborted) this.set({...this.snapshot, loading: false, failed: true}); },
    ).finally(() => { if (this.controller === controller) this.controller = undefined; });
  };
  private set(next: SourcesSnapshot) { this.snapshot = next; for (const l of [...this.listeners]) l(); }
}
const sourceStores = new Map<string, SourcesStore>();
function sourcesStore(key: string, api: ChannelApi, serverId: string): SourcesStore {
  let store = sourceStores.get(key);
  if (!store) {
    store = new SourcesStore(api, serverId);
    sourceStores.set(key, store);
    while (sourceStores.size > 4) sourceStores.delete(sourceStores.keys().next().value!);
  }
  store.bind(api);
  return store;
}
const noSubscribe = () => () => {};
const noSnapshot = () => emptySources;

/** The viewer's channel sources. Channels is hidden while there are none (§2.0). */
export function useChannelSources(): SourcesSnapshot & {refresh: () => void} {
  const {api, session} = useSession();
  const serverId = session?.viewer.serverId ?? '';
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const store = useMemo(() => (serverId && hasRealOrigin(api) ? sourcesStore(`${scope.viewerId}|${api.baseUrl}`, api, serverId) : null), [api, serverId, scope.viewerId]);
  const snapshot = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.get ?? noSnapshot);
  const refresh = useCallback(() => store?.load(), [store]);
  return {...snapshot, refresh};
}

// ── Per-source memory (on the device until the preference registry has `channels.view.*`) ──

const store = new NativeQueueStore();
const memoryCache = new Map<string, ChannelMemory>();

export function useChannelMemory(entry: string) {
  const {api, session} = useSession();
  const viewer = useMemo(() => viewerScope(session, api).viewerId, [session, api]);
  const key = `channels:v1:${viewer}`;
  const [memory, setMemory] = useState<ChannelMemory>(() => memoryCache.get(key) ?? {views: {}, sorts: {}});
  useEffect(() => {
    let active = true;
    store.change(key, raw => { const m = parseChannelMemory(raw); return {record: m, value: m}; }).then(m => { if (active) { memoryCache.set(key, m); setMemory(m); } }, () => {});
    return () => { active = false; };
  }, [key]);
  const update = useCallback((choice: {view?: ChannelView; sort?: ChannelSort}) => {
    setMemory(prev => {
      const next = rememberChoice(prev, entry, choice);
      memoryCache.set(key, next);
      void store.change(key, () => ({record: next, value: next})).catch(() => {});
      return next;
    });
  }, [key, entry]);
  return {
    view: memory.views[entry],
    sort: memory.sorts[entry] ?? 'number',
    setView: (v: ChannelView) => update({view: v}),
    setSort: (s: ChannelSort) => update({sort: s}),
  };
}

// ── Reminders (§3.5 "Remind me", decision 3: in-app only, per profile on this device) ──

type ReminderState = {viewer: string; list: readonly Reminder[]};
let reminders: ReminderState = {viewer: '', list: []};
const reminderListeners = new Set<() => void>();
const reminderKey = (viewer: string) => `channels.reminders:v1:${viewer}`;
function setReminders(next: ReminderState, persist: boolean) {
  reminders = next;
  if (persist && next.viewer) void store.change(reminderKey(next.viewer), () => ({record: next.list, value: null})).catch(() => {});
  for (const l of [...reminderListeners]) l();
}
const subscribeReminders = (fn: () => void) => { reminderListeners.add(fn); return () => { reminderListeners.delete(fn); }; };
const getReminders = () => reminders;

/** The signed-in profile's reminders, loaded once per profile. */
export function useReminders(): {list: readonly Reminder[]; has: (programId: string) => boolean; toggle: (r: Reminder) => boolean; remove: (programId: string) => void} {
  const {api, session} = useSession();
  const viewer = useMemo(() => (session ? viewerScope(session, api).viewerId : ''), [session, api]);
  const state = useSyncExternalStore(subscribeReminders, getReminders);
  useEffect(() => {
    if (!viewer || reminders.viewer === viewer) return;
    setReminders({viewer, list: []}, false);
    store.change(reminderKey(viewer), raw => { const list = liveReminders(Array.isArray(raw) ? raw : []); return {record: list, value: list}; }).then(
      list => { if (reminders.viewer === viewer) setReminders({viewer, list}, false); },
      () => {},
    );
  }, [viewer]);
  const list = state.viewer === viewer ? state.list : [];
  return {
    list,
    has: programId => list.some(r => r.programId === programId),
    toggle: r => {
      const next = toggledReminders(list, r);
      setReminders({viewer, list: next.list}, true);
      return next.on;
    },
    remove: programId => setReminders({viewer, list: list.filter(r => r.programId !== programId)}, true),
  };
}

/** When the next reminder is due (2 minutes before its start), for the in-app banner host. */
export function useDueReminder(): {due: Reminder | null; dismiss: () => void} {
  const {list, remove} = useReminders();
  const [due, setDue] = useState<Reminder | null>(null);
  const ids = list.map(r => `${r.programId}@${r.start}`).join('|');
  useEffect(() => {
    const timers = list.map(r => {
      const at = r.start - REMINDER_LEAD_MS - Date.now();
      if (at > 2 ** 31 - 1) return undefined;
      return setTimeout(() => { setDue(r); remove(r.programId); }, Math.max(0, at));
    });
    return () => timers.forEach(id => id !== undefined && clearTimeout(id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);
  useEffect(() => { if (!due) return; const id = setTimeout(() => setDue(null), 60_000); return () => clearTimeout(id); }, [due]);
  return {due, dismiss: () => setDue(null)};
}

/** A request id for channel preference writes (the native runtime's generator). */
export const newRequestId = () => Promise.resolve(NativeModules.PorticoRuntime?.newRequestId?.() as string | Promise<string> | undefined).then(value => {
  if (!value) throw new Error('Could not create an operation identifier.');
  return String(value);
});
