import {nativeNetworkFetch} from './server-connections';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import {
  type CredentialSnapshot,
  type HostedSession,
  type HostedServer,
} from '../../../../packages/client-core/src/index';
import { createCredentials } from './credentials';
import { useAccountDirectory } from './useAccountDirectory';
const noCredentialSubscribe = () => () => {};
const emptyCredentialSnapshot: CredentialSnapshot = {
  phase: 'signedOut',
  pendingRevocations: 0,
};
const emptyCredentials = () => emptyCredentialSnapshot;
export function useHostedAccount(hostedUrl: string, mode: 'local' | 'hosted', directoryEnabled = true) {
  const credentials = useMemo(
    () => (hostedUrl ? createCredentials(hostedUrl) : undefined),
    [hostedUrl],
  );
  const credentialState = useSyncExternalStore(
    credentials?.subscribe ?? noCredentialSubscribe,
    credentials?.getSnapshot ?? emptyCredentials,
  );

  const [hosted, setHosted] = useState<HostedSession>();
  const [hostedProfile, setHostedProfile] = useState('');
  const directory = useAccountDirectory({
    credentials,
    snapshot: credentialState,
    origin: hostedUrl,
    enabled: mode === 'hosted' && directoryEnabled,
    fetcher: nativeNetworkFetch,
  });
  const [attachedServer, setAttachedServer] = useState<HostedServer>();
  useEffect(() => {
    if (!credentials || mode !== 'hosted') return;
    if (credentialState.session) {
      setHosted(credentialState.session);
      setHostedProfile(
        credentialState.context?.profileId ??
          credentialState.session.profiles[0]?.id ??
          '',
      );
      setAttachedServer(credentialState.context?.server);
    } else if (credentialState.phase === 'signedOut') setHosted(undefined);
  }, [credentials, credentialState.session, credentialState.context?.profileId, credentialState.context?.server, credentialState.phase, mode]);
  // A sign-in is a 90-day window renewed by use of the account service, which a client in daily
  // use against its own server may never need. Renew it about monthly, some minutes after
  // launch at a random moment, so it is never part of a burst.
  useEffect(() => {
    if (!credentials) return;
    const timer = setTimeout(
      () => void credentials.keepAlive().catch(() => {}),
      60000 + Math.random() * 540000,
    );
    return () => clearTimeout(timer);
  }, [credentials]);
  // A sign-out made offline is retried when there is one to retry: on returning to the
  // foreground and once a minute while it is outstanding. Nothing runs otherwise.
  const pendingRevocations = credentialState.pendingRevocations > 0;
  useEffect(() => {
    if (!credentials || !pendingRevocations) return;
    const retry = () => void credentials.retryRevocations().catch(() => {});
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') retry();
    });
    const timer = setInterval(retry, 60000);
    return () => {
      listener.remove();
      clearInterval(timer);
    };
  }, [credentials, pendingRevocations]);

  return {
    credentials,
    credentialState,
    hosted,
    setHosted,
    hostedProfile,
    setHostedProfile,
    ...directory,
    attachedServer,
    setAttachedServer,
  };
}
