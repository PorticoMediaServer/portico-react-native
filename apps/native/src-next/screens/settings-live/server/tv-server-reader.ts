import type {DirectSnapshot} from '../../../../../../packages/client-core/src/profile-management';
import {routePath} from '../../../../../../packages/contracts/src/routes';
import type {NativeScreenLifetime} from '../lifetime';

type Context = {account: DirectSnapshot; api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}};

/** The same primary-profile membership boundary applies to both Server destinations. */
export function nativeServerAdmission(account: DirectSnapshot, lifetime: NativeScreenLifetime): 'owner' | 'administrator' | 'denied' {
  if (!lifetime.current() || !account.canManage || account.account.primaryProfileId !== lifetime.authority.profileId || account.account.disabled) return 'denied';
  return account.account.role === 'owner' ? 'owner' : account.account.role === 'admin' ? 'administrator' : 'denied';
}

/** The server reads an administrator's TV pages actually make. People is shared
 * with administrators and the approved coded-events page is theirs; the owner's
 * message log, storage measurements, catalogue and remote-access reads are not.
 * An administrator is admitted to these exact paths, never to the role's whole
 * surface, so a page bug cannot turn the tier into an owner read. Keep this list
 * beside the page that reads it. */
const administratorReads: ReadonlySet<string> = new Set([
  routePath('get_admin_access_devices'),
  routePath('get_admin_access_invitations'),
  routePath('get_admin_access_members'),
  '/v1/admin/access/events', // generated route id arrives with the §16 checkpoint
]);

/** A TV settings reader is GET-only for the owner or an administrator whose primary
 * profile this is. An administrator may read only the shared administrator pages
 * listed above. It cannot acquire a mutation or another scope. Recheck before every
 * request; the lifetime rejects retired in-flight responses. */
export function createTVServerReader(context: Context, lifetime: NativeScreenLifetime) {
  return {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const admission = nativeServerAdmission(context.account, lifetime);
    if (admission === 'denied' || method && method !== 'GET' || body !== undefined) return Promise.reject(new Error('native_tv_server_read_denied'));
    if (admission === 'administrator' && !administratorReads.has(path)) return Promise.reject(new Error('native_tv_server_read_denied'));
    return lifetime.request(next => context.api.request<T>(path, 'GET', undefined, next), signal);
  }};
}
