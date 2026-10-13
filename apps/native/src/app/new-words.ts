import {formatMessage, type I18n, type MessageValues} from '../../../../packages/i18n/src/index';
import {activeI18n} from './errors';

/**
 * Sentences these screens say that the shared catalogue does not hold yet.
 *
 * Each one is read from the catalogue the moment it is there, under the same name; the wording
 * here is only what is shown until then. When the catalogue has gained an entry, delete it here
 * and call `i18n.t` at its call sites.
 */
const awaiting = {
  // A device whose saved sign-in can no longer be read (the system lost the key that protects it).
  'signIn.savedUnreadable': 'This device couldn’t read its saved sign-in. Sign in again.',
  'signIn.reset.title': 'This device can’t read its saved sign-in',
  'signIn.reset.body': 'Reset this device to sign in again.',
  'signIn.reset.action': 'Reset this device',
  'signIn.reset.confirmTitle': 'Reset this device?',
  'signIn.reset.consequence': 'Everyone is signed out of Portico on this device, and the servers and settings it remembers are forgotten. Downloads stay. Nothing on your server changes.',
  'signIn.reset.confirm': 'Reset',
  'signIn.reset.failed': 'This device couldn’t be reset. Try again, or clear Portico’s storage in this device’s settings.',
  'signIn.reset.working': 'Starting Portico again…',
  'signIn.reset.reopen': 'Close Portico and open it again to finish.',
  // Media that can never be played, as opposed to playback that stopped and may work on another try.
  'player.cannotPlay.title': 'This can’t be played',
  'player.cannotPlay.thisTitle': 'This title',
  'player.cannotPlay.gone': '{title} is no longer on this server.',
  'player.cannotPlay.denied': '{title} can’t be played on this profile.',
  'player.cannotPlay.unsupported': '{title} can’t be played on this device, and the server couldn’t convert it.',
  'player.cannotPlay.conversionOff': '{title} needs converting to play on this device, and converting is turned off for this account.',
  'player.cannotPlay.unreadable': '{title} couldn’t be read by the server. The file may be damaged or incomplete.',
  'player.cannotPlay.fileMissing': '{title} couldn’t be sent by the server. Its file may have been moved or deleted.',
  // What a screen reader hears in place of artwork that could not be shown.
  'a11y.artwork.unavailable': 'Artwork unavailable',
  'a11y.artwork.unavailableFor': '{title}, artwork unavailable',
  // A saved view larger than one play request can hold.
  'saved.view.gathering': 'Getting the rest of this view…',
  'saved.view.partial': 'This view has more than {count, number} titles. The first {count, number} are playing.',
  // Settings that apply to a kind of device, not one device.
  'settings.scope.handhelds': 'All your phones and tablets',
  'settings.scope.televisions': 'All your TVs',
} as const;

export type NewWordId = keyof typeof awaiting;

/** One of the sentences above, in the viewer's language once the catalogue has it. */
export function word(id: NewWordId, values?: MessageValues, i18n: I18n = activeI18n()): string {
  const has = i18n.has as (id: string) => boolean;
  if (has(id)) return (i18n.t as (id: string, values?: MessageValues) => string)(id, values);
  return formatMessage(awaiting[id], values, {locale: i18n.region.formatLocale});
}

/** Every sentence still waiting for the catalogue (the report of what to add lists these). */
export const awaitingWords: Readonly<Record<NewWordId, string>> = awaiting;
