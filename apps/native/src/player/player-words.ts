import {formatMessage, type I18n, type MessageValues} from '../../../../packages/i18n/src/index';
import {activeI18n} from '../app/errors';

/**
 * Sentences the player says that the shared catalogue does not hold yet.
 *
 * Each one is read from the catalogue the moment it is there, under the same name; the wording
 * here is only what is shown until then. When the catalogue has gained an entry, delete it here
 * and call `i18n.t` at its call sites.
 */
const awaiting = {
  'player.opt.chapters': 'Chapters',
  'player.chapter.numbered': 'Chapter {number}',
  'player.opt.versionChangeFailed': 'The version couldn’t be changed. Playback continues as it was.',
  'player.subtitles.changeFailed': 'The subtitles couldn’t be changed.',
  'player.subtitles.drawnHere': 'Drawn by this device',
  'player.quality.tooSlow': 'Your connection is too slow for that quality. Try {quality}, or Automatic.',
  'player.quality.tooSlowAny': 'Your connection is too slow for that quality. Try Automatic.',
  'player.quality.automaticNow': 'Automatic · {quality}',
  'player.quality.fixedHelp': 'Up to {height}p; converted only when the file is larger',
} as const;

export type PlayerWordId = keyof typeof awaiting;

export function playerWord(id: PlayerWordId, values?: MessageValues, i18n: I18n = activeI18n()): string {
  const has = i18n.has as (id: string) => boolean;
  if (has(id)) return (i18n.t as (id: string, values?: MessageValues) => string)(id, values);
  return formatMessage(awaiting[id], values, {locale: i18n.region.formatLocale});
}

/** Every sentence still waiting for the catalogue (the report of what to add lists these). */
export const awaitingPlayerWords: Readonly<Record<PlayerWordId, string>> = awaiting;
