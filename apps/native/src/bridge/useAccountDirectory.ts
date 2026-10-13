import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {AppState} from 'react-native';
import {ApiError, HttpHostedApi, type CredentialSnapshot, type HostedServer} from '../../../../packages/client-core/src/index.ts';
import type {CredentialSessionService} from '../../../../packages/client-core/src/credentials.ts';
import {ServerListWatcher, type ServerListAnswer} from '../../../../packages/client-core/src/portico-servers.ts';
import {listedServers, loadServerList, saveServerList, watcherStorage} from './server-list-cache';

type Credentials = Pick<CredentialSessionService, 'accessSession' | 'getSnapshot' | 'subscribe'>;
type DirectoryStatus = 'idle' | 'loading' | 'ready' | 'error';
type Directory = {owner: string; directoryStatus: DirectoryStatus; directoryError: string; servers: HostedServer[]; checkedAt?: number};
const empty = (owner: string, directoryStatus: DirectoryStatus): Directory => ({owner, directoryStatus, directoryError: '', servers: []});
const failure = (error: unknown) =>
  error instanceof ApiError && error.status === 401
    ? 'Your account sign-in could not be verified. Try again, or use another account to sign in again.'
    : 'Your servers could not be loaded. Check your connection and try again.';

/**
 * The Portico Account's servers (Spec — Hosted at Scale). The list is kept on the device between
 * launches; the account service is asked only when the version check is due (at most every few
 * hours, on returning to the foreground), at sign-in (no kept version yet), and from Settings ›
 * Refresh Servers. Credentials stay with the coordinator; this is picker state only.
 */
export function useAccountDirectory({credentials, snapshot, origin, enabled, fetcher}: {credentials?: Credentials; snapshot: CredentialSnapshot; origin: string; enabled: boolean; fetcher?: typeof fetch}) {
  const accountId = enabled && credentials ? snapshot.session?.account.id ?? '' : '';
  const owner = accountId ? JSON.stringify([origin, accountId]) : '';
  const [directory, setDirectory] = useState<Directory>(() => empty('', 'idle'));
  const watcher = useRef<ServerListWatcher | undefined>(undefined);
  const currentOwner = useRef(owner); currentOwner.current = owner;
  const readEpoch = useRef(0);
  const listServers = useCallback(async (signal?: AbortSignal): Promise<ServerListAnswer> => {
    if (!credentials) throw new Error('No Portico Account.');
    const epoch = readEpoch.current;
    const session = await credentials.accessSession();
    if (signal?.aborted || epoch !== readEpoch.current || owner !== currentOwner.current || session.account.id !== accountId) throw Object.assign(new Error('The directory account changed.'), {code: 'account_changed'});
    const out = await new HttpHostedApi(origin, session.accessToken, fetcher).servers(signal);
    return {items: out.items, version: out.version ?? '', watch: out.watch ?? ''};
  }, [credentials, origin, fetcher, owner, accountId]);
  useEffect(() => {
    watcher.current = undefined;
    if (!owner) {
      setDirectory(empty('', 'idle'));
      return;
    }
    let live = true;
    setDirectory(empty(owner, 'loading'));
    const adopt = (answer: ServerListAnswer) => {
      if (!live) return;
      const servers = listedServers(answer.items);
      setDirectory({owner, directoryStatus: 'ready', directoryError: '', servers, checkedAt: watcher.current?.getRecord()?.checkedAt});
      void saveServerList(accountId, {items: servers}).catch(() => {});
    };
    void loadServerList(accountId).catch(() => ({items: [], record: null})).then(cached => {
      if (!live) return;
      const next = new ServerListWatcher({hostedOrigin: origin, listServers, onServers: adopt, storage: watcherStorage(accountId, cached.record), ...(fetcher ? {fetcher} : {})});
      watcher.current = next;
      // The kept list shows at once; a first sign-in (no kept version) fetches it now.
      if (cached.record) setDirectory({owner, directoryStatus: 'ready', directoryError: '', servers: cached.items, checkedAt: cached.record.checkedAt});
      void next.foreground().then(outcome => {
        if (!live) return;
        if (outcome === 'deferred' && !cached.record) setDirectory({...empty(owner, 'error'), directoryError: failure(undefined)});
        else if (outcome === 'unchanged') setDirectory(prev => (prev.owner === owner ? {...prev, checkedAt: next.getRecord()?.checkedAt} : prev));
      }, e => { if (live && !cached.record) setDirectory({...empty(owner, 'error'), directoryError: failure(e)}); });
    });
    // Returning to the foreground: the version check, only when it is due.
    const sub = AppState.addEventListener('change', state => { if (state === 'active') void watcher.current?.foreground().catch(() => {}); });
    return () => { live = false; readEpoch.current++; sub.remove(); };
  }, [owner, accountId, origin, listServers, fetcher]);

  /** Settings › Refresh Servers (and a chooser's Try again): one check now, then the list if it moved. */
  const refreshServers = useCallback(() => {
    const current = watcher.current;
    if (!current) return;
    setDirectory(prev => (prev.owner === owner && prev.servers.length ? prev : {...empty(owner, 'loading')}));
    void current.refresh().then(outcome => {
      if (outcome !== 'changed') setDirectory(prev => (prev.owner === owner ? {...prev, directoryStatus: 'ready', directoryError: '', checkedAt: current.getRecord()?.checkedAt} : prev));
    }, e => setDirectory(prev => (prev.owner === owner ? {...prev, directoryStatus: prev.servers.length ? 'ready' : 'error', directoryError: failure(e)} : prev)));
  }, [owner]);

  /** A server that refused this account (`access_refused`): off the list until the next list answer. */
  const dropServer = useCallback((serverId: string) => {
    setDirectory(prev => {
      const servers = prev.servers.filter(s => s.id !== serverId);
      if (accountId) void saveServerList(accountId, {items: servers}).catch(() => {});
      return {...prev, servers};
    });
  }, [accountId]);

  /** After accepting an invitation: the new server is on the list at the account's next answer. */
  const checkServersNow = useCallback(() => { void watcher.current?.refresh().catch(() => {}); }, []);

  const visible = directory.owner === owner ? directory : empty(owner, owner ? 'loading' : 'idle');
  return useMemo(() => ({
    servers: visible.servers,
    directoryStatus: visible.directoryStatus,
    directoryError: visible.directoryError,
    serversCheckedAt: visible.checkedAt,
    refreshServers,
    dropServer,
    checkServersNow,
  }), [visible.servers, visible.directoryStatus, visible.directoryError, visible.checkedAt, refreshServers, dropServer, checkServersNow]);
}
