import type {DirectSnapshot} from '../../../../../../packages/client-core/src/profile-management';
import type {NativeScreenLifetime} from '../lifetime';

type Context = {account: DirectSnapshot; api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}};

/** The same primary-profile membership boundary applies to both Server destinations. */
export function nativeServerAdmission(account: DirectSnapshot, lifetime: NativeScreenLifetime): 'owner' | 'administrator' | 'denied' {
  if (!lifetime.current() || !account.canManage || account.account.primaryProfileId !== lifetime.authority.profileId || account.account.disabled) return 'denied';
  return account.account.role === 'owner' ? 'owner' : account.account.role === 'admin' ? 'administrator' : 'denied';
}

/** A TV settings reader cannot accidentally acquire a mutation or an administrator-only
 * scope. Recheck before every request; the lifetime rejects retired in-flight responses. */
export function createTVServerReader(context: Context, lifetime: NativeScreenLifetime) {
  return {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    if (nativeServerAdmission(context.account, lifetime) !== 'owner' || method && method !== 'GET' || body !== undefined) return Promise.reject(new Error('native_tv_server_read_denied'));
    return lifetime.request(next => context.api.request<T>(path, 'GET', undefined, next), signal);
  }};
}
