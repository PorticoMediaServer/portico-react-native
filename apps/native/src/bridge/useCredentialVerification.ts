import { useEffect } from 'react';
import { nativeAccount, accountBridge } from './native-account';
import { NativeModules } from 'react-native';
import {activeI18n} from '../app/errors';
import {
  HttpHostedApi,
  type CredentialSessionService,
} from '../../../../packages/client-core/src/index';
/** Explicit DEBUG simulator-only integration probe. Uses real auth, renewal and Keychain. */
export function useCredentialVerification(
  credentials: CredentialSessionService | undefined,
  origin: string,
) {
  useEffect(() => {
    if (!__DEV__) return;
    const fixture = NativeModules.PorticoRuntime.testLogin;
    if (!credentials || !fixture?.credentialVerification) return;
    const marker = globalThis as typeof globalThis & {
      __porticoCredentialProbe?: string;
    };
    const launch = NativeModules.PorticoRuntime.launchId;
    if (marker.__porticoCredentialProbe === launch) return;
    marker.__porticoCredentialProbe = launch;
    const record = (type: string, detail: Record<string, unknown> = {}) =>
      NativeModules.PorticoRuntime.recordTestEvent(
        JSON.stringify({ type, ...detail }),
      );
    void (async () => {
      if (fixture.credentialVerification === 'rotate') {
        const account = await nativeAccount(origin);
        const requestId = await accountBridge().newRequestId();
        await credentials.authenticate(signal => account.api.login(fixture.username,fixture.password,requestId,signal));
        const initial = await credentials.accessSession();
        const rotated = await credentials.accessSession(true);
        if (
          !rotated.familyId ||
          rotated.familyId !== initial.familyId ||
          rotated.account.id !== initial.account.id ||
          rotated.accessToken === initial.accessToken
        )
          throw new Error(
            'Rotation did not preserve account and family or replace access authority.',
          );
        await new HttpHostedApi(origin, rotated.accessToken).servers();
        record('credential-rotation-passed', {
          securePersistence: true,
          tokenReplaced: true,
          familyPreserved: true,
        });
      } else {
        await credentials.synchronize();
        const before = credentials.getSnapshot();
        if (!before.session?.account.id)
          throw new Error('Restart did not restore the account session.');
        const renewed = await credentials.accessSession(true);
        if (renewed.account.id !== before.session.account.id || renewed.familyId !== before.session.familyId)
          throw new Error('Renewal changed the restored account or family.');
        await new HttpHostedApi(origin, renewed.accessToken).servers();
        await credentials.logout();
        if (credentials.getSnapshot().phase !== 'signedOut')
          throw new Error('Logout did not clear active context.');
        let revoked = false;
        try {
          await new HttpHostedApi(origin, renewed.accessToken).servers();
        } catch (error) {
          revoked = (error as { status?: number }).status === 401;
        }
        if (!revoked) throw new Error('Logout did not revoke remote family.');
        record('credential-restart-renewal-logout-passed', {
          accountRestored: true,
          renewed: true,
          remoteRevoked: true,
        });
      }
    })().catch(() =>
      record('credential-verification-failed', {
        message:
          activeI18n().t('twoFactor.verifyFailed'),
      }),
    );
  }, [credentials, origin]);
}
