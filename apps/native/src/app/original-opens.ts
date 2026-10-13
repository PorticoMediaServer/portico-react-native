import {localRuleFacts, type EngineSetting} from '../player/engine-choice';

/**
 * Whether a title's original file, once downloaded, is one this device can open. A download plays
 * from the device with nothing to convert it, so an original in a container the device's own
 * player does not read only plays where mpv is there to play it (and the viewer has not chosen
 * the device's player alone). The download menu says so beside "Original", so nobody finds out
 * on a plane.
 *
 * The rule for what the device's player opens is the player's own (`localRuleFacts`); this only
 * puts a server's name for a container ("matroska", "mov,mp4,m4a,3gp") into the form that rule reads.
 * No React Native imports: tested under Node.
 */
const NAMES: Readonly<Record<string, string>> = {matroska: 'mkv', mpegts: 'ts', 'mpeg-ts': 'ts', quicktime: 'mov', mpeg4: 'mp4', '3gp': 'mp4', '3g2': 'mp4', mj2: 'mp4', isom: 'mp4'};

/** True or false when the container is known; undefined when the server did not say what it is. */
export function devicePlayerOpens(container: string, platform: 'apple' | 'android'): boolean | undefined {
  const names = container.toLowerCase().split(/[,\s/]+/).map(name => NAMES[name] ?? name).filter(Boolean);
  if (!names.length) return undefined;
  return names.some(name => localRuleFacts({address: 'file.' + name, local: true, platform}).nativeNeeds === 'nothing');
}

/** Whether to say, beside "Original", that this device may not be able to play it. */
export function originalMayNotPlay(container: string, device: Readonly<{platform: 'apple' | 'android'; mpv: boolean; player: EngineSetting}>): boolean {
  if (devicePlayerOpens(container, device.platform) !== false) return false;
  return !device.mpv || device.player === 'native';
}
