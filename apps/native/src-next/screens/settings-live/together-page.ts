import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeScreenLifetime} from './lifetime';

export type NativeTogetherPage = Readonly<{key: string; signal: AbortSignal; current: () => boolean; back: () => void}>;
const principal = (context: NativeShellBootstrapContext): string | undefined => {
  const session = context.session();
  return session && JSON.stringify([session.sessionFamilyId, session.tokenGeneration, session.authorizationHorizon, session.deviceId, session.installationId]);
};
/** One original admitted render. Leaving retires its callbacks permanently;
 * the persistent room and follower remain owned by the authority. */
export function nativeTogetherPages(context: NativeShellBootstrapContext, lifetime: Pick<NativeScreenLifetime, 'current' | 'signal'>) {
  type Issued = Readonly<{snapshot: ReturnType<typeof context.navigation.getSnapshot>; principal?: string; page: NativeTogetherPage; retire: () => void}>;
  let alive = true, original: Issued | undefined;
  return {
    capture(route: Extract<NativeShellRoute, {kind: 'together'}>): NativeTogetherPage {
      const snapshot = context.navigation.getSnapshot(), identity = principal(context);
      if (original?.snapshot === snapshot && original.principal === identity) return original.page;
      original?.retire();
      const projection = context.navigation.presentationStack().at(-1), occurrence = projection?.occurrence;
      const abort = new AbortController();
      let retired = false, registration: Issued, offNavigation = () => {}, offAuthority = () => {};
      const registered = () => alive && !retired && !lifetime.signal.aborted && original === registration;
      const retire = () => {if (retired) return; retired = true; abort.abort(); offNavigation(); offAuthority();};
      const owned = () => registered() && lifetime.current() && registered() && context.current() && registered();
      const current = () => {
        if (!owned() || snapshot.route !== route || projection?.route !== route || !occurrence || identity === undefined
          || context.navigation.getSnapshot() !== snapshot || !owned()
          || context.navigation.presentationStack().at(-1) !== projection || !owned()
          || principal(context) !== identity || !owned()) {retire(); return false;}
        return true;
      };
      const page: NativeTogetherPage = Object.freeze({key: occurrence ?? '', signal: abort.signal, current,
        back: () => {if (current() && occurrence) context.navigation.commitNativePop(snapshot, occurrence);}});
      registration = Object.freeze({snapshot, principal: identity, page, retire}); original = registration;
      offNavigation = context.navigation.subscribe(() => {current();});
      offAuthority = context.subscribeAuthority(() => {current();});
      if (!current()) {offNavigation(); offAuthority();}
      return page;
    },
    dispose() {alive = false; original?.retire(); original = undefined;},
  };
}
