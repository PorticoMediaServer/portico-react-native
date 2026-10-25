import {Linking, Platform} from 'react-native';
import {RouteError, routeOrigin} from '../../../../packages/client-core/src/route-identity';
import {contactKnownServerForOwnerRecovery, type OwnerRecoveryServer} from '../../../../packages/client-core/src/owner-recovery-contact';
import {nativeAccounts, type NativeAccounts} from './accounts';
import {nativeAppSessions, subscribeNativeAppSessions} from './app-session-storage';
import {nativeOwnerRecoveryFetch, nativeRouteCrypto} from './server-connections';

/** Only an authenticated directory's originally selected record may supply this capture. */
type CapturedServer = OwnerRecoveryServer;
type AccountScope = Readonly<{accountId: string; familyId: string}>;
type RecoveryPurpose = typeof contactKnownServerForOwnerRecovery;
const cancelled = () => new RouteError('cancelled', 'Owner recovery contact cancelled.');

/** A phone-only contact lifetime, with no admission, route memory or server credential API.
 * The injected purpose is the canonical client-core Root47 producer, not an ordinary connect.
 */
export class NativeOwnerRecoveryContact {
  private readonly controller = new AbortController();
  private readonly captured: CapturedServer;
  private readonly origin: string;
  private readonly scope: AccountScope;
  private readonly credentials: ReturnType<NativeAccounts['accountCredentials']>;
  private readonly off: (() => void)[] = [];
  private started = false;

  constructor(captured: CapturedServer, scope: AccountScope, private readonly isCurrent: () => boolean,
              private readonly contact: RecoveryPurpose = contactKnownServerForOwnerRecovery, owner: NativeAccounts = nativeAccounts) {
    if (Platform.isTV) throw new RouteError('access_refused', 'Owner recovery requires a phone or computer.');
    this.captured = Object.freeze({baseUrl: captured.baseUrl, serverId: captured.serverId, publicKey: captured.publicKey});
    this.origin = routeOrigin(this.captured.baseUrl);
    this.scope = Object.freeze({accountId: scope.accountId, familyId: scope.familyId});
    this.credentials = owner.accountCredentials();
    this.assertCurrent();
    // Subscribe before the first protected read. A write already in flight cannot become a
    // replacement selection adopted by this contact when that read eventually completes.
    this.off.push(owner.onCancel(this.dispose), subscribeNativeAppSessions(this.dispose),
      this.credentials.subscribe(() => {if (!this.current()) this.dispose();}));
  }
  private current = () => {
    const live = this.credentials.getSnapshot().session;
    return !this.controller.signal.aborted && this.isCurrent() &&
      live?.account.id === this.scope.accountId && live.familyId === this.scope.familyId;
  };
  private assertCurrent = () => {if (!this.current()) throw cancelled();};

  async open() {
    this.assertCurrent();
    if (this.started) throw cancelled();
    this.started = true;
    let timedOut = false;
    const timer = setTimeout(() => {timedOut = true; this.controller.abort();}, 12000);
    try {
      const original = await nativeAppSessions.read(); this.assertCurrent();
      const result = await this.contact(this.captured, {fetcher: nativeOwnerRecoveryFetch(this.origin, this.current),
        crypto: nativeRouteCrypto, signal: this.controller.signal, isCurrent: this.current});
      this.assertCurrent();
      const retained = await nativeAppSessions.read(); this.assertCurrent();
      if (retained.revision !== original.revision || retained.selectedServerId !== original.selectedServerId) throw cancelled();
      // Defence at the browser seam too: no query, fragment, code, claim or alternative route.
      if (result.purpose !== 'owner-recovery' || result.origin !== this.origin ||
          result.serverId !== this.captured.serverId || result.signInURL !== new URL('/sign-in', this.origin).href)
        throw new RouteError('identity_mismatch', 'The server did not prove this recovery destination.');
      this.assertCurrent();
      await Linking.openURL(result.signInURL);
      this.assertCurrent();
    } catch (error) {
      if (timedOut) throw new RouteError('timeout', 'Owner recovery contact timed out.');
      throw error;
    } finally {clearTimeout(timer); this.dispose();}
  }
  dispose = () => {
    this.controller.abort();
    for (const off of this.off.splice(0)) off();
  };
}

export function createNativeOwnerRecoveryContact(captured: CapturedServer, scope: AccountScope, isCurrent: () => boolean) {
  return new NativeOwnerRecoveryContact(captured, scope, isCurrent);
}
