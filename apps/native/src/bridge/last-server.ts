import {NativeQueueStore} from './queue-storage';

/**
 * The server a Portico Account opened last on this device (an id, per account; no credentials), so
 * an account with several servers reopens that one after signing in again.
 */
const store = new NativeQueueStore();
const KEY = 'portico-last-server';
type Record = {[accountId: string]: string};
const valid = (raw: unknown): Record => (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record : {});

export const lastPorticoServer = {
  read: (accountId: string) => store.change<string | undefined>(KEY, raw => ({record: raw, value: typeof valid(raw)[accountId] === 'string' ? valid(raw)[accountId] : undefined})),
  write: (accountId: string, serverId: string) => store.change<void>(KEY, raw => ({record: {...valid(raw), [accountId]: serverId}, value: undefined})),
};
