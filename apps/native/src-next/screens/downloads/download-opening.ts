import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {authorityKey} from '../../shell/model';
import {closeNativeDownload, getNativeDownloadSnapshot, type NativeDownloadRequest} from './request';

type Context = Pick<NativeShellBootstrapContext, 'api' | 'session' | 'authority' | 'current' | 'navigation'>;
const principalOf = (context: Context) => {
  const session = context.session();
  return session ? JSON.stringify([session.viewer.serverId, session.viewer.authority, session.viewer.accountId,
    session.viewer.profileId, session.viewer.role, session.sessionFamilyId, session.tokenGeneration,
    session.authorizationHorizon, session.deviceId, session.installationId]) : undefined;
};

/** Business lifetime for exactly one shell sheet opening. Retained exit paint
 * must not retain this object as an interactive controller or restart it. */
export function createNativeDownloadOpening(context: Context, request: NativeDownloadRequest) {
  const abort = new AbortController(), api = context.api, route = context.navigation.getSnapshot();
  const originalAuthority = Object.freeze({...context.authority()}), authority = authorityKey(originalAuthority);
  const principal = principalOf(context), lifetime = request.lifetime, navigation = context.navigation;
  let retired = false, pending: object | undefined;
  const paintCurrent = () => {
    try {
      if (lifetime && (lifetime.signal.aborted || lifetime.isCurrent() !== true)) return false;
      if (!principal || !context.current() || context.navigation !== navigation
        || context.api !== api || authorityKey(context.authority()) !== authority || principalOf(context) !== principal) return false;
      const now = context.navigation.getSnapshot();
      return now.route === route.route && now.revision === route.revision;
    } catch {return false;}
  };
  // Check store identity again after supplied callbacks: they may replace an
  // equal-valued request while this original opening is being inspected.
  const current = () => !retired && !abort.signal.aborted && getNativeDownloadSnapshot() === request && paintCurrent()
    && !retired && !abort.signal.aborted && getNativeDownloadSnapshot() === request;
  const retire = () => {if (!retired) {retired = true; abort.abort();}};
  const close = (): boolean => {retire(); return closeNativeDownload(request);};
  return Object.freeze({request, signal: abort.signal, current, retire,
    /** Inert exit paint only: ordinary close retires business authority, while
     * a route/viewer change must also remove its retained pixels immediately. */
    paintCurrent,
    claim: (): object | undefined => {
      if (pending || retired) return undefined;
      const ticket = pending = {};
      if (current() && pending === ticket) return ticket;
      if (pending === ticket) pending = undefined;
      return undefined;
    },
    owns: (ticket: object) => pending === ticket && current(),
    release: (ticket: object) => {if (pending === ticket) pending = undefined;},
    // Compare-close may retire the original request after its page leaves. It
    // can never dismiss a successor, even when every displayed value is equal.
    close,
    viewDownloads: (): boolean => {
      if (!current() || !close() || getNativeDownloadSnapshot() !== undefined || !paintCurrent()
        || getNativeDownloadSnapshot() !== undefined) return false;
      navigation.open({kind: 'downloads'}, originalAuthority);
      return true;
    },
  });
}

export type NativeDownloadOpening = ReturnType<typeof createNativeDownloadOpening>;
