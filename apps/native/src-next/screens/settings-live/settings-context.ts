import type {LocalSession} from '../../../../../packages/client-core/src/index';
import type {PreferenceSnapshot} from '../../../../../packages/client-core/src/preferences';
import type {DirectSnapshot} from '../../../../../packages/client-core/src/profile-management';
import type {SettingsContext, SettingsCustomId, SettingsPlatform} from '../../../../../packages/client-core/src/presentation/settings-structure';
import {playerSettingsSupport} from '../../platform/playback/native-listening-kinds';
import {installationIdentity} from '../../../../../packages/client-core/src/installation';

export type NativeSettingsContextSource = Readonly<{
  account: DirectSnapshot;
  preferences: () => PreferenceSnapshot;
  session: () => LocalSession | undefined;
}>;

/**
 * The Settings structure's capabilities, from this viewer's real account and the server's
 * published preference keys. A capability is present only where this build draws the genuine
 * surface for it: password, two-step, devices, member tokens and downloads
 * storage are not wired here yet, so their rows stay out rather than opening an empty panel.
 */
export function nativeSettingsContext(source: NativeSettingsContextSource, platform: SettingsPlatform = 'phone'): SettingsContext {
  const account = source.account.account;
  const hosted = !!account.hostedAccountId;
  const preferenceKeys = new Set(source.preferences().registry.fields.map(field => field.key));
  return Object.freeze({
    owner: account.role === 'owner',
    administrator: account.role === 'admin',
    platform,
    capabilities: Object.freeze({
      preferenceKeys,
      localAccount: !hosted,
      porticoMember: hosted,
      hostedAccount: hosted,
      manageSignIn: false,
      manageDevices: false,
      accessTokens: false,
      deviceName: !!installationIdentity()?.name,
      downloads: false,
      playbackSpeed: playerSettingsSupport.playbackSpeed,
      audioEffects: playerSettingsSupport.audioEffects,
    }),
  });
}

/** The account pages' custom rows this build draws, each from its own real reader or route. */
export const nativeAccountPanelIds: readonly SettingsCustomId[] = Object.freeze(['identity', 'profiles', 'servers', 'porticoAccount', 'about', 'privacyNote', 'remoteControls', 'deviceName']);

/** Drawn rows whose genuine native surface is not built yet; their capability stays off. */
export const nativeSettingsUnavailablePanelIds: readonly SettingsCustomId[] = Object.freeze(['password', 'twoStep', 'devices', 'deviceName', 'downloadsStorage', 'accessTokens', 'subtitlePreview']);
