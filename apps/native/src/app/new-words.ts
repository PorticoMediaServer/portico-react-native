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
  // Media that can never be played, as opposed to a connection that may come back.
  'player.cannotPlay.title': 'This can’t be played',
  'player.cannotPlay.missing': 'The file for {title} is no longer on the server.',
  'player.cannotPlay.missingNoTitle': 'The file is no longer on the server.',
  'player.cannotPlay.denied': 'This profile isn’t allowed to play {title}.',
  'player.cannotPlay.deniedNoTitle': 'This profile isn’t allowed to play this.',
  'player.cannotPlay.unsupported': 'This device can’t play {title}, and the server couldn’t convert it.',
  'player.cannotPlay.unsupportedNoTitle': 'This device can’t play this, and the server couldn’t convert it.',
  'player.cannotPlay.damaged': 'The file for {title} is damaged or incomplete.',
  'player.cannotPlay.damagedNoTitle': 'The file is damaged or incomplete.',
  'player.cannotPlay.hint': 'Trying again won’t help. The server’s owner can check the file.',
  // What a screen reader hears.
  'a11y.screen.opened': '{title}',
  'a11y.card.watched': 'Watched',
  'a11y.card.inProgress': '{percent, number}% watched',
  'a11y.card.unwatchedCount': '{count, plural, one {# unwatched} other {# unwatched}}',
  'a11y.card.moreActions': 'More options',
  'a11y.artwork.unavailable': 'Artwork unavailable',
  'a11y.artwork.unavailableFor': '{title}, artwork unavailable',
  'a11y.loading': 'Loading',
  'a11y.loaded': 'Loaded',
  // A saved view larger than one play request can hold.
  'saved.view.gathering': 'Getting the rest of this view…',
  'saved.view.partial': 'This view has more than {count, number} titles. The first {count, number} are playing.',
  // Choosing where to play.
  'cast.enterTvCode': 'Enter a TV code',
  'cast.enterTvCodeHint': 'Link a TV that isn’t listed by typing the code it shows.',
  // Settings that apply to a kind of device, not one device.
  'settings.scope.handhelds': 'Phones and tablets',
  'settings.scope.televisions': 'TVs',
  // A subtitle track with no language.
  'tracks.unknownLanguage': 'Unknown language',
  'tracks.forced': 'Forced',
  'tracks.sdh': 'SDH',
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
