import {NativeModules, Platform} from 'react-native';
import {installationIdentity, setInstallationIdentity, validInstallationId, type InstallationIdentity} from '../../../../packages/client-core/src/installation';
import {readNativeSession, nativeSelectedConnectionEnvironment} from './session';
import {profileInstallation} from './profile-trust';

let generation = 0;
const invalid = () => Object.assign(new Error('invalid_installation_metadata'), {code: 'invalid_installation_metadata'});
const cancelled = () => Object.assign(new Error('native_installation_cancelled'), {name: 'AbortError'});
const mismatch = () => Object.assign(new Error('installation_identity_mismatch'), {code: 'identity_mismatch'});
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Same installation classification as the pure native device-platform bridge. Vega has its own host. */
function installationPlatform(): string {
  if (Platform.OS === 'android') {
    const amazon = String((Platform.constants as {Manufacturer?: string} | undefined)?.Manufacturer ?? '').toLowerCase() === 'amazon';
    return Platform.isTV ? amazon ? 'firetv' : 'androidtv' : 'android';
  }
  if (Platform.OS === 'ios') return Platform.isTV ? 'tvos' : (Platform as {isPad?: boolean}).isPad === true ? 'ipados' : 'ios';
  throw invalid();
}

// Pure device metadata from setup-codes, without its auth/UI dependencies or invented fallbacks.
const models: readonly [RegExp, string][] = [[/^AppleTV14,/, 'Apple TV 4K'], [/^AppleTV11,/, 'Apple TV 4K'], [/^AppleTV6,/, 'Apple TV 4K'], [/^AppleTV5,/, 'Apple TV HD'], [/^iPad/, 'iPad'], [/^iPhone/, 'iPhone']];
function description(raw: unknown): Pick<InstallationIdentity, 'name' | 'appVersion'> {
  if (!object(raw) || typeof raw.deviceName !== 'string' || typeof raw.appVersion !== 'string') throw invalid();
  const version = raw.appVersion.trim(), name = raw.deviceName.trim();
  // The shipped bundle's version must fit the canonical header unchanged. Never substitute a JS version.
  if (!version || version.length > 64 || !/^[\x21-\x7e]+$/.test(raw.appVersion) || /[\x00-\x1f\x7f]/.test(raw.deviceName)) throw invalid();
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const deviceName = !name || /^(apple tv|iphone|ipad)$/i.test(name)
    ? models.find(([pattern]) => pattern.test(model))?.[1] || model || name
    : name;
  if (!deviceName || /[\r\n\x00-\x1f\x7f]/.test(deviceName)) throw invalid();
  return {name: deviceName, appVersion: version};
}

/** Start synchronously, before awaiting secure storage, so a newer restore retires every old read.
 * No identity is generated here, and disposal never clears the installation shared by credential users. */
export function beginNativeInstallation(signal?: AbortSignal) {
  const owned = ++generation;
  let disposed = false, claim = installationIdentity();
  const current = () => !disposed && !signal?.aborted && owned === generation && installationIdentity() === claim;
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
  return {prepare: () => preparing ??= prepare(), current, dispose};
}
