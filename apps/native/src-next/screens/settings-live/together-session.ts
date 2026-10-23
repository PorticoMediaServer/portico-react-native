import {GroupSessionService} from '../../../../../packages/client-core/src/group-session';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {openEventStream} from '../../platform/event-stream';
import {nativeRouteCrypto} from '../../platform/server-connections';
import {NativeScreenLifetime} from './lifetime';

const sessions = new WeakMap<NativeShellBootstrapContext, GroupSessionService>();

/** One real room service per restored authority, borrowed by the screen and
 * player follower. Leaving a screen never creates, closes or replaces a room. */
export function nativeTogetherSession(context: NativeShellBootstrapContext): GroupSessionService {
  if (!context.current()) throw Object.assign(new Error('native_together_retired'), {name: 'AbortError'});
  const existing = sessions.get(context);
  if (existing) return existing;
  const lifetime = new NativeScreenLifetime(context);
  const service = new GroupSessionService({
    api: {
      baseUrl: context.api.baseUrl,
      request: <T>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => context.api.request<T>(path, method, body, next), signal),
    },
    stream: async (path, lastEventId, signal) => {
      lifetime.assert();
      const session = context.session();
      if (!session) throw Object.assign(new Error('native_together_retired'), {name: 'AbortError'});
      // The group service owns this reader's AbortSignal and aborts it on room
      // leave/disposal. A one-request wrapper would close SSE as soon as opened.
      const response = await openEventStream(context.api, path, {Accept: 'text/event-stream', Authorization: `Bearer ${session.accessToken}`,
        ...(lastEventId ? {'Last-Event-ID': lastEventId} : {})}, signal);
      lifetime.assert(); return response;
    },
    key: () => {lifetime.assert(); return [...nativeRouteCrypto.random(24)].map(byte => byte.toString(16).padStart(2, '0')).join('');},
    i18n: defaultI18n,
  });
  sessions.set(context, service);
  let unsubscribe = () => {};
  const dispose = () => {
    if (sessions.get(context) !== service) return;
    sessions.delete(context); unsubscribe(); service.dispose(); lifetime.dispose();
  };
  unsubscribe = context.subscribeAuthority(() => {if (!lifetime.current()) dispose();});
  return service;
}
