import {parseEngineSetting} from '../platform/playback/engine-choice';
import type {NativePlaybackSettings} from '../platform/playback/types';
import type {PreferenceValues} from '../../../../packages/client-core/src/preferences';

export function nativePlaybackSettings(values: PreferenceValues, installation: unknown): NativePlaybackSettings {
  const stored = installation && typeof installation === 'object' && !Array.isArray(installation) ? installation as Record<string, unknown> : {};
  const rate = (key: string) => {const value = values[key]; if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('invalid_playback_preference'); return value;};
  const skip = (key: string) => {const value = values[key]; if (value !== 'ask' && value !== 'auto' && value !== 'off') throw new Error('invalid_playback_preference'); return value;};
  const size = values['playback.subtitleSize'], background = values['playback.subtitleBackground'];
  if (size !== 'small' && size !== 'medium' && size !== 'large' && size !== 'extra-large') throw new Error('invalid_playback_preference');
  if (background !== 'none' && background !== 'translucent' && background !== 'opaque') throw new Error('invalid_playback_preference');
  const overrides = Object.fromEntries((['forceStereo', 'disablePassthrough', 'disableHdr'] as const).flatMap(key => typeof stored[key] === 'boolean' ? [[key, stored[key]]] : []));
  return {engine: parseEngineSetting(stored.playerEngine), ...(Object.keys(overrides).length ? {overrides} : {}),
    videoRate: rate('playback.defaultSpeed'), audiobookRate: rate('audiobooks.defaultSpeed'),
    skips: {intro: skip('playback.introSkip'), recap: skip('playback.recapSkip'), credits: skip('playback.creditsSkip')}, subtitleSize: size, subtitleBackground: background};
}
