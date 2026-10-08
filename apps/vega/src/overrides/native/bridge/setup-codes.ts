// The Vega counterpart of `apps/native/src/bridge/setup-codes.ts`: the same services, storage and
// checks, with this platform's name in the requests and in the device's fallback name. (The shared
// file hard-codes `tvos` and "Apple TV"; see the port log, "Shared changes needed".)
import {NativeModules} from 'react-native';
import {HttpLocalApi, type DeviceAuthorization, type HostedSession, type LocalSession} from '../../../../../../packages/client-core/src/index';
import {parseLocalSession} from '../../../../../../packages/client-core/src/local-session';
import {SetupCodeService, type SetupCodeEntry, type SetupCodeJournal, type SetupCodeStorage} from '../../../../../../packages/client-core/src/setup-code';
import type {SetupDraft, SetupDraftStore} from '../../../../../../packages/client-core/src/setup-onboarding';
import {NativeQueueStore} from '../../../../../native/src/bridge/queue-storage';
import {nativeNetworkFetch} from '../../../../../native/src/bridge/server-connections';
import {deviceKindName, platformId} from '../../../platform';

const store = new NativeQueueStore();
const protocol = 'tv-x25519-v1';

export function nativeSetupStorage<T>(authority: string): SetupCodeStorage<T> {
  const key = 'setup:' + authority;
  return {change: update => store.change(key, raw => { const record = update(raw === null ? undefined : (raw as SetupCodeJournal<T>)); return {record, value: record}; })};
}

function hostedGrant(raw: unknown): HostedSession {
  const s = raw as HostedSession;
  if (!s || typeof s.accessToken !== 'string' || !s.accessToken || typeof s.refreshToken !== 'string' || !s.refreshToken || typeof s.familyId !== 'string' || !s.familyId || !s.account?.id || !Array.isArray(s.profiles) ||
      !Number.isFinite(Date.parse(s.expiresAt)) || !Number.isFinite(Date.parse(s.refreshExpiresAt))) throw new Error('The protected TV session was invalid.');
  return s;
}

const requestId = () => NativeModules.PorticoRuntime.newRequestId().then((value: string) => value.toLowerCase());

/** The only clear TV grant exists after private-key decryption. Both the private key and the
 * redemption receipt survive process termination. */
export function nativeTVActivation(origin: string) {
  const http = new HttpLocalApi(origin, '', nativeNetworkFetch);
  let advertised: string | undefined;
  const display = (entry: SetupCodeEntry<HostedSession> | undefined) => {
    const id = entry?.requestId;
    if (id === advertised) return;
    advertised = id;
    NativeModules.PorticoNetwork.stopTVAdvertisement();
    if (entry) {
      void NativeModules.PorticoNetwork.tvPublicKey(id).then((publicKey: string) => {
        if (advertised === id) return NativeModules.PorticoNetwork.advertiseTV({issuer: origin, code: entry.authorization.userCode, requestId: id, publicKey, expiresAt: entry.authorization.expiresAt});
      }).catch(() => { /* Nearby is optional; the durable QR and manual code remain. */ });
    }
  };
  return new SetupCodeService<HostedSession>(origin + '#' + protocol, {
    create: async (id, signal) => {
      const publicKey = await NativeModules.PorticoNetwork.tvPublicKey(id);
      if (signal.aborted) throw new Error('Activation paused.');
      return http.request<DeviceAuthorization>('/v1/device-authorizations', 'POST', {requestId: id, ...(await deviceIdentity()), platform: platformId, protocol, publicKey}, signal);
    },
    poll: async (entry, signal) => {
      const envelope = await http.request<Record<string, unknown>>('/v1/tv-authorizations/token', 'POST', {deviceCode: entry.authorization.deviceCode}, signal);
      const key = await NativeModules.PorticoNetwork.tvPublicKey(entry.requestId);
      if (envelope.issuer !== origin || envelope.requestId !== entry.requestId || envelope.recipientKey !== key) throw new Error('The TV approval does not belong to this device and account service.');
      return hostedGrant(JSON.parse(await NativeModules.PorticoNetwork.openTVGrant(entry.requestId, envelope)));
    },
    cancel: (entry, signal) => http.request<void>('/v1/device-authorizations/cancel', 'POST', {deviceCode: entry.authorization.deviceCode}, signal),
    forgotten: entry => { NativeModules.PorticoNetwork.forgetTVKey(entry.requestId); },
    displayed: display,
  }, nativeSetupStorage(origin + '#' + protocol), requestId);
}

/** What an approval screen calls this device: its own name ("Living Room"), or what kind of
 * device it is when the system offers no name or only a generic one, plus the app version. */
let identity: Promise<{deviceName: string; appVersion: string}> | undefined;
export function deviceIdentity() {
  identity ??= (async () => {
    let facts: {deviceName?: string; appVersion?: string} | null = null;
    try { facts = await NativeModules.PorticoCapabilities?.facts(); } catch { /* the name falls back */ }
    const name = (facts?.deviceName ?? '').trim();
    const generic = !name || /^(fire ?tv|amazon fire ?tv|fire tv stick|vega)$/i.test(name);
    return {deviceName: (generic ? deviceKindName : name).slice(0, 64), appVersion: facts?.appVersion || '0.1.0'};
  })();
  return identity;
}

/** Server Quick Connect is the TV's: it shows the code, and a phone or computer signed in to the server approves it. */
export function nativeQuickConnect(api: HttpLocalApi) {
  const serverId = api.getRouteConnection()?.pin.serverId;
  if (!serverId) throw new Error('Verify the server identity before using Quick Connect.');
  return new SetupCodeService<LocalSession>('local:' + serverId, {
    create: async (id, signal) => api.request<DeviceAuthorization>('/v1/quick-connect', 'POST', {requestId: id, ...(await deviceIdentity()), platform: platformId}, signal),
    poll: async (entry, signal) => parseLocalSession(await api.request('/v1/quick-connect/token', 'POST', {deviceCode: entry.authorization.deviceCode}, signal), {authority: 'local', serverId}),
    cancel: (entry, signal) => api.request<void>('/v1/quick-connect/cancel', 'POST', {deviceCode: entry.authorization.deviceCode}, signal),
  }, nativeSetupStorage('local:' + serverId), requestId);
}

export function nativeSetupDraft(serverId: string): SetupDraftStore {
  const key = 'initialize:' + serverId;
  return {
    read: () => store.change(key, raw => ({record: raw, value: raw === null ? undefined : (raw as SetupDraft)})),
    change: async update => { await store.change(key, raw => ({record: update(raw === null ? undefined : (raw as SetupDraft)) ?? null, value: undefined})); },
  };
}
