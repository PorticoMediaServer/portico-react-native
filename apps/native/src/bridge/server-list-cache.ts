import type {HostedServer} from '../../../../packages/client-core/src/index';
import type {ServerListRecord, ServerListStorage} from '../../../../packages/client-core/src/portico-servers';
import {NativeQueueStore} from './queue-storage';

/**
 * The Portico Account's server list kept between launches (Spec — Hosted at Scale): the list and
 * the version it was fetched at, per account. A launch shows the kept list and asks the account
 * service only when the version check is due (`ServerListWatcher.foreground`), so opening the app
 * is not an account-service call. Signed route documents are not kept (they go stale; connecting
 * asks for fresh ones) and no credential is stored here.
 */
const store = new NativeQueueStore();
const key = (accountId: string) => `portico.serverList.${accountId}`;
export type CachedServerList = {items: HostedServer[]; record: ServerListRecord | null};

const validRecord = (v: unknown): v is ServerListRecord => {
  const r = v as ServerListRecord | null;
  return !!r && typeof r === 'object' && typeof r.version === 'string' && typeof r.watch === 'string' && Number.isFinite(r.checkedAt) && Number.isFinite(r.nextCheckAt);
};

/** Server rows the chooser can show and connect to (the list answer, without its routes). */
export function listedServers(items: readonly unknown[]): HostedServer[] {
  const out: HostedServer[] = [];
  const seen = new Set<string>();
  for (const raw of items) {
    const s = raw as Partial<HostedServer> | null;
    if (!s || typeof s.id !== 'string' || !s.id || seen.has(s.id) || typeof s.name !== 'string' || typeof s.baseUrl !== 'string' || typeof s.publicKey !== 'string') continue;
    seen.add(s.id);
    out.push(s as HostedServer);
  }
  return out;
}

export async function loadServerList(accountId: string): Promise<CachedServerList> {
  const raw = await store.change(key(accountId), value => ({record: value, value}));
  const v = raw as {items?: unknown; record?: unknown} | null;
  return {items: Array.isArray(v?.items) ? listedServers(v.items) : [], record: validRecord(v?.record) ? v!.record as ServerListRecord : null};
}

export async function saveServerList(accountId: string, patch: Partial<CachedServerList>): Promise<void> {
  await store.change(key(accountId), value => {
    const current = (value ?? {}) as {items?: unknown; record?: unknown};
    const items = patch.items ? patch.items.map(({routes: _routes, ...rest}) => rest) : current.items;
    const record = 'record' in patch ? patch.record : current.record;
    return {record: {items, record}, value: undefined};
  });
}

export async function clearServerList(accountId: string): Promise<void> {
  await store.change(key(accountId), () => ({record: null, value: undefined}));
}

/** The watcher's storage: read synchronously from what was loaded, written in the background. */
export function watcherStorage(accountId: string, loaded: ServerListRecord | null): ServerListStorage {
  let current = loaded;
  return {
    load: () => current,
    save: record => {
      current = record;
      void saveServerList(accountId, {record}).catch(() => {});
    },
  };
}
