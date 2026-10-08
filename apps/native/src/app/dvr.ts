import {useEffect, useMemo} from 'react';
import {NativeModules} from 'react-native';
import {DVRClient} from '../../../../packages/client-core/src/dvr';
import {hasRealOrigin, useSession} from './session';

const requestId = () => Promise.resolve(NativeModules.PorticoRuntime.newRequestId()).then((v: string) => v.toLowerCase());

/** APL-LIVE-02: one DVR client per signed-in server, for Record actions and the Recordings view. */
export function useDVRClient(): DVRClient | null {
  const {api, system, session} = useSession();
  const serverId = system?.id ?? session?.viewer.serverId ?? '';
  const client = useMemo(() => (serverId && hasRealOrigin(api) ? new DVRClient(api, serverId, requestId) : null), [api, serverId]);
  useEffect(() => {
    if (!client) return;
    client.activate();
    return () => client.dispose();
  }, [client]);
  return client;
}
