// Vega installation host. Keep the shared installation/restore guards unchanged.
import {NativeModules} from 'react-native';
import {platformId, deviceKindName} from '../../../platform';
import {installationIdentity, setInstallationIdentity, validInstallationId, type InstallationIdentity} from '../../../../../../packages/client-core/src/installation';
import {readNativeSession, nativeSelectedConnectionEnvironment} from '../../../../../native/src-next/platform/session';
import {profileInstallation} from '../../../../../native/src-next/platform/profile-trust';

let generation = 0;
const invalid = () => Object.assign(new Error('invalid_installation_metadata'), {code: 'invalid_installation_metadata'});
const cancelled = () => Object.assign(new Error('native_installation_cancelled'), {name: 'AbortError'});
const mismatch = () => Object.assign(new Error('installation_identity_mismatch'), {code: 'identity_mismatch'});
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Actual Vega classification; never impersonate an Apple or Android installation. */
function installationPlatform(): string {return platformId;}

// The actual device name/model, with the sanctioned product noun only when unnamed.
function description(raw: unknown): Pick<InstallationIdentity, 'name' | 'appVersion'> {
  if (!object(raw) || typeof raw.deviceName !== 'string' || typeof raw.appVersion !== 'string') throw invalid();
  const version = raw.appVersion.trim(), name = raw.deviceName.trim();
  // The shipped bundle's version must fit the canonical header unchanged. Never substitute a JS version.
  if (!version || version.length > 64 || !/^[\x21-\x7e]+$/.test(raw.appVersion) || /[\x00-\x1f\x7f]/.test(raw.deviceName)) throw invalid();
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const deviceName = name || model || deviceKindName;
  if (!deviceName || /[\r\n\x00-\x1f\x7f]/.test(deviceName)) throw invalid();
  return {name: deviceName, appVersion: version};
}

/** Start synchronously, before awaiting secure storage, so a newer restore retires every old read.
 * No identity is generated here, and disposal never clears the installation shared by credential users. */
export function beginNativeInstallation(signal?: AbortSignal) {
  const owned = ++generation;
  let disposed = false, claim = installationIdentity();
  let invalidWarned = false;
  const current = () => {
    const now = installationIdentity(), valid = !disposed && !signal?.aborted && owned === generation && now === claim;
    // DEV-only first-cause evidence: a newer restore generation and a rewritten
    // identity are different bugs. This reports which one retired the claim and
    // never changes the guard or the identity setter.
    if (!valid && typeof __DEV__ !== 'undefined' && __DEV__ && !invalidWarned) {
      invalidWarned = true;
      console.warn('portico_installation_invalid', JSON.stringify({disposed, aborted: !!signal?.aborted, owned, latest: generation,
        sameReference: now === claim, sameId: now?.installationId === claim?.installationId, hasClaim: !!claim, hasNow: !!now}), new Error().stack);
    }
    return valid;
  };
  const assertCurrent = () => {if (!current()) throw cancelled();};
  const dispose = () => {disposed = true;};
  let preparing: ReturnType<typeof prepare> | undefined;
  async function prepare() {
    assertCurrent();
    const saved = await readNativeSession(); assertCurrent();
    const id = saved.installation;
    if (!validInstallationId(id)) throw invalid();
    if (claim && claim.installationId !== id) throw mismatch();
    const env = nativeSelectedConnectionEnvironment();
    const connection = await env.storage.read(); assertCurrent();
    // A saved family may never be rebound to the current install after a reset or damaged read.
    for (const session of [saved.viewer?.session, connection?.session]) {
      if (session?.installationId !== undefined && session.installationId !== id) throw mismatch();
    }
    const metadata = description(await NativeModules.PorticoCapabilities.facts()); assertCurrent();
    const platform = installationPlatform();
    // Secure-record reset can happen while the native facts call is outstanding, even if the
    // canonical claim was initially absent. Its persisted identity must still be the one we read.
    const reread = await profileInstallation(true); assertCurrent();
    if (reread !== id) throw mismatch();
    setInstallationIdentity({installationId: id, ...metadata, platform, app: 'Portico'});
    claim = installationIdentity();
    if (!claim) throw invalid();
    return {saved, connection, env, identity: claim};
  }
  return {prepare: () => preparing ??= prepare(), current, dispose, generation: owned};
}
