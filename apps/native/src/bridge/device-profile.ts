import {Platform} from 'react-native';
import {androidProfile, appleProfile, type AndroidNativeFacts, type AppleNativeFacts, type ClientProfile} from '../../../../packages/client-core/src/client-profile';
import type {CapabilityProfile} from '../../../../packages/client-core/src/playback-v1/options';
import {androidCapabilityProfile, appleCapabilityProfile} from './audio-decode';
import {androidFamily, isTablet} from './device-platform';

/** What `PorticoCapabilities.facts()` answers: the platform's own shape, plus the device's name and the app's version. */
export type NativeFacts = (AppleNativeFacts | AndroidNativeFacts) & {deviceName?: string; appVersion?: string};

/** This device's client profile: the platform's declared table, narrowed by what the system reports. */
export function deviceClientProfile(facts: NativeFacts | null, appVersion: string): ClientProfile {
  const osVersion = facts?.osVersion ?? String(Platform.Version);
  if (androidFamily) return androidProfile({family: androidFamily, television: Platform.isTV, osVersion, model: facts?.model}, facts as AndroidNativeFacts | null);
  return appleProfile({television: Platform.isTV, osVersion, model: facts?.model, appVersion}, facts as AppleNativeFacts | null);
}

/** This device's Playback v1 capability profile (spec §3). */
export function deviceCapabilityProfile(facts: NativeFacts | null, origin: string | null, appVersion: string): CapabilityProfile {
  const device = {television: Platform.isTV, pad: isTablet, osVersion: String(Platform.Version), appVersion};
  if (androidFamily) return androidCapabilityProfile({...device, family: androidFamily}, facts as AndroidNativeFacts | null, origin);
  return appleCapabilityProfile(device, facts as AppleNativeFacts | null, origin);
}
