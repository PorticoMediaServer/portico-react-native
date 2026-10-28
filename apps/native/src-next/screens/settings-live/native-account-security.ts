import type {LocalSession} from '../../../../../packages/client-core/src';
import type {DirectSnapshot} from '../../../../../packages/client-core/src/profile-management';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeScreenLifetime} from './lifetime';

export type NativeAccountSecurityKind = 'password' | 'twoStep' | 'devices';
type AccountSource = Readonly<{account: DirectSnapshot; session: () => LocalSession | undefined}>;

/** Account management belongs to the main profile; Hosted credentials are not local credentials. */
export function nativeAccountSecurityAllowed(source: AccountSource, kind: NativeAccountSecurityKind): boolean {
  const snapshot = source.account, account = snapshot.account, session = source.session();
  return !!session && !account.disabled && snapshot.canManage && snapshot.capabilities.manageAccount
    && session.viewer.serverId === snapshot.serverId && session.viewer.accountId === account.id
    && session.viewer.profileId === account.primaryProfileId
    && (kind === 'devices' || !account.hostedAccountId);
}

const retired = () => Object.assign(new Error('native_account_security_retired'), {name: 'AbortError'});

/** One original Settings opening. No Hosted port or latest-session fallback is available here. */
export function createNativeAccountSecurityScope(context: NativeShellBootstrapContext, lifetime: NativeScreenLifetime, kind: NativeAccountSecurityKind) {
  if (!lifetime.current() || !context.current() || !nativeAccountSecurityAllowed(context, kind)) throw retired();
  const session = context.session()!, navigation = context.navigation.getSnapshot();
  if (navigation.route.kind !== 'shell' || navigation.route.destination.kind !== 'settings') throw retired();
  const serverId = session.viewer.serverId, accountId = session.viewer.accountId, profileId = session.viewer.profileId, familyId = session.sessionFamilyId;
  const abort = new AbortController(), cleanups: (() => void)[] = [];
  let active = true;
  const current = () => {
    if (!active || abort.signal.aborted || lifetime.signal.aborted || !lifetime.current() || !context.current()) return false;
    const now = context.session();
    if (!now || now.sessionFamilyId !== familyId || now.viewer.serverId !== serverId || now.viewer.accountId !== accountId || now.viewer.profileId !== profileId
      || !nativeAccountSecurityAllowed(context, kind)) return false;
    const route = context.navigation.getSnapshot();
    return active && route.revision === navigation.revision && route.route === navigation.route;
  };
  const dispose = () => {if (!active) return; active = false; abort.abort(); for (const cleanup of cleanups.splice(0)) cleanup();};
  const changed = () => {if (!current()) dispose();};
  const subscribe = (start: (listener: () => void) => () => void) => {const stop = start(changed); if (active) cleanups.push(stop); else stop();};
  subscribe(context.navigation.subscribe); subscribe(context.subscribeAuthority);
  lifetime.signal.addEventListener('abort', dispose, {once: true});
  cleanups.push(() => lifetime.signal.removeEventListener('abort', dispose));
  changed();
  const request = async <T,>(path: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> => {
    if (!current() || signal?.aborted) throw retired();
    const round = new AbortController(), stop = () => round.abort();
    abort.signal.addEventListener('abort', stop, {once: true}); signal?.addEventListener('abort', stop, {once: true});
    try {
      if (!current() || signal?.aborted) throw retired();
      const value = await lifetime.request(next => {
        if (!current() || signal?.aborted) throw retired();
        return context.api.request<T>(path, method, body, next);
      }, round.signal);
      if (!current() || signal?.aborted) throw retired();
      return value;
    } finally {abort.signal.removeEventListener('abort', stop); signal?.removeEventListener('abort', stop);}
  };
  return Object.freeze({current, dispose, request, signal: abort.signal, serverId, familyId, installationId: session.installationId});
}
export type NativeAccountSecurityScope = ReturnType<typeof createNativeAccountSecurityScope>;
