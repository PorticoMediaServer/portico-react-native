import {HttpLocalApi} from '../../../../packages/client-core/src';
import {installationIdentity} from '../../../../packages/client-core/src/installation';
import {parseDirectSnapshot, selectDirectProfile} from '../../../../packages/client-core/src/profile-management';
import {routePath} from '../../../../packages/contracts/src/routes';
import {restoreNativeSession} from '../../../../packages/client-core/src/server-connections';
import {nativeAppSessions} from './app-session-storage';
import {nativeAccounts} from './accounts';
import {nativeNetworkFetch, nativeServerEnvironment} from './server-connections';
import {createNativeShellAccountBinding} from '../shell/account-binding';

/** One captured server/account/family. The candidate owns independent routes, so retiring
 * the old private shell cannot dispose the route that verifies and publishes the new profile. */
export function nativeProfileSelection(serverId: string, familyId: string) {
  const abort = new AbortController(), installed = installationIdentity();
  const off = nativeAccounts.onCancel(() => abort.abort());
  let busy = false;
  let publishing = false, disposeRequested = false;
  const current = () => !abort.signal.aborted && !!installed && installationIdentity() === installed;
  const check = () => {if (!current()) throw Object.assign(new Error('native_profile_selection_cancelled'), {name: 'AbortError'});};
  return {
    async select(profileId: string, pin?: string) {
      check(); if (busy) throw Object.assign(new Error('native_profile_selection_busy'), {code: 'cancelled'}); busy = true;
      let api: HttpLocalApi | undefined, issued: import('../../../../packages/client-core/src').LocalSession | undefined, published = false;
      try {
        const captured = await nativeAppSessions.selected(); check();
        if (!captured || captured.connection.pin.serverId !== serverId || captured.connection.session.sessionFamilyId !== familyId)
          throw Object.assign(new Error('native_profile_selection_changed'), {code: 'cancelled'});
        const record = captured.connection;
        const restored = await restoreNativeSession(nativeServerEnvironment(serverId), undefined, record.session); api = restored?.api; check();
        if (!restored || !api) throw Object.assign(new Error('native_profile_selection_changed'), {code: 'cancelled'});
        const accountBinding = createNativeShellAccountBinding(captured, restored.session, {
          current, session: () => restored.session, pin: () => api?.getRouteConnection()?.pin,
          readSelected: () => nativeAppSessions.selected(),
        });
        const admission = await nativeAccounts.admission(captured.signIn, record.hosted && {origin: record.hosted.origin, accountId: record.hosted.accountId}); check();
        await accountBinding.assertCurrent(); check();
        const selected = await selectDirectProfile(api, {authority: 'local', serverId, accountId: record.session.viewer.accountId},
          profileId, {pin, installationId: installed?.installationId}, abort.signal);
        issued = selected.session; check();
        api.setAccessToken(issued.accessToken);
        // Selection returns a session, not an account snapshot. Read the actual
        // account under that fresh grant before allowing it into protected storage.
        const account = parseDirectSnapshot(await api.request(routePath('get_direct_account'), 'GET', undefined, abort.signal),
          {authority: 'local', serverId, accountId: record.session.viewer.accountId}, true);
        check(); accountBinding.assertAccount(account);
        if (account.account.role !== issued.viewer.role || !account.profiles.some(value => value.id === issued!.viewer.profileId))
          throw Object.assign(new Error('native_profile_selection_changed'), {code: 'identity_mismatch'});
        await accountBinding.assertCurrent(); check();
        publishing = true;
        await nativeAccounts.remember(api, issued, admission, record.hosted, current); published = true;
        // The previous family belongs to this server only. A switch to another server never
        // takes this path and never ends that server's family.
        if (restored.session.sessionFamilyId !== issued.sessionFamilyId) {
          const previous = new HttpLocalApi(api.baseUrl, restored.session.accessToken, nativeNetworkFetch);
          previous.useRoutes(api.getRouteConnection()!); await previous.logout();
        }
      } finally {
        if (issued && !published && api) {
          const candidate = new HttpLocalApi(api.baseUrl, issued.accessToken, nativeNetworkFetch);
          candidate.useRoutes(api.getRouteConnection()!); await candidate.logout().catch(() => {});
        }
        api?.getRouteConnection()?.dispose(); busy = false; publishing = false;
        if (disposeRequested) {abort.abort(); off();}
      }
    },
    dispose() {if (publishing) {disposeRequested = true; return;} abort.abort(); off();},
  };
}
