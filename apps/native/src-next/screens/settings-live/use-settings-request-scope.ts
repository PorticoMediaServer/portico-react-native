import {useEffect, useMemo} from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {NativeScreenLifetime} from './lifetime';

/** A stable transport and captured authority for one mounted Settings viewport. */
export function useSettingsRequestScope(context: NativeShellBootstrapContext) {
  const lifetime = useMemo(() => new NativeScreenLifetime(context), [context]);
  useEffect(() => () => lifetime.dispose(), [lifetime]);
  const api = useMemo(() => ({request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) =>
    lifetime.request(next => context.api.request<T>(path, method, body, next), signal)}), [context, lifetime]);
  return {api, lifetime, authority: lifetime.authority};
}
