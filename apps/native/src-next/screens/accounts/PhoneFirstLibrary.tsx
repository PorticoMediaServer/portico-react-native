import React, {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {LibraryContentApi} from '../../../../../packages/client-core/src/library-content';
import {routeBase64} from '../../../../../packages/client-core/src/route-identity';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {NativeScreenLifetime} from '../settings-live/lifetime';
import {NativeOwnerLibrariesController} from '../settings-live/owner-libraries/controller';
import {AddLibraryPage} from '../settings-live/owner-libraries/AddLibraryPage';
import {nativeRouteCrypto} from '../../platform/server-connections';
import {useTheme} from '../../kit/theme';

/** Setup reuses the real owner library editor and server folder explorer, after
 * normal session admission. No setup token or pending claim can reach this page. */
export function PhoneFirstLibrary({context, onDone}: {context: NativeShellBootstrapContext; onDone: () => void}) {
  const theme = useTheme(), active = useRef(true), flight = useRef(false);
  const value = useMemo(() => {
    const lifetime = new NativeScreenLifetime(context);
    const assertOwner = () => {
      lifetime.assert();
      const account = context.account;
      if (!active.current || account.account.role !== 'owner' || account.account.disabled || !account.canManage
        || !account.capabilities.manageServer || account.account.primaryProfileId !== lifetime.authority.profileId)
        throw Object.assign(new Error('owner_required'), {code: 'owner_required'});
    };
    const api: LibraryContentApi = {request: async <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => {
      assertOwner(); const result = await lifetime.request(current => context.api.request<T>(path, method, body, current), signal);
      assertOwner(); return result;
    }};
    const scope = {serverId: lifetime.authority.serverId, viewerId: JSON.stringify([lifetime.authority.epoch, lifetime.authority.accountId, lifetime.authority.profileId])};
    return {lifetime, assertOwner, api, controller: new NativeOwnerLibrariesController(api, scope, () => routeBase64(nativeRouteCrypto.random(24)))};
  }, [context]);
  const state = useSyncExternalStore(value.controller.subscribe, value.controller.getSnapshot);
  useEffect(() => {active.current = true; return () => {active.current = false; value.controller.dispose(); value.lifetime.dispose();};}, [value]);
  const finish = () => {if (!active.current || !value.lifetime.current() || flight.current) return; value.assertOwner(); active.current = false; value.controller.dispose(); value.lifetime.dispose(); onDone();};
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{paddingHorizontal: 20, paddingTop: 30, paddingBottom: 18}}><Text style={[theme.type.title, {color: theme.colors.text}]}>{defaultI18n.t('web.setup.firstLibrary')}</Text></View>
    <AddLibraryPage firstRun api={value.api} serverName={context.serverName} busy={state.busy || flight.current} error={state.error}
      onCancel={finish} onCreate={input => {
        if (flight.current || !active.current) return; value.assertOwner(); flight.current = true;
        void value.controller.create(input).then(id => {
          if (!active.current || !value.lifetime.current()) return;
          flight.current = false; if (id) finish();
        }, () => {flight.current = false;});
      }}/>
  </View>;
}
