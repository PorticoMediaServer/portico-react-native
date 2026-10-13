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
  // Settings › About: a report of this app's own trouble, sent to the owner of the server.
  'about.report.title': 'Send a report',
  'about.report.help': 'Sends this app’s recent warnings and errors to the owner of {server}, to help find a problem.',
  'about.report.afterCrash': 'Portico closed unexpectedly last time. A report would include what went wrong.',
  'about.report.confirmTitle': 'Send a report to the owner of {server}?',
  'about.report.confirmBody': 'It holds what this app logged while something went wrong. That can include the names of titles and of this device. It never includes your password or sign-in.',
  'about.report.send': 'Send',
  'about.report.sent': 'The report was sent to the owner of {server}.',
  'about.report.failed': 'The report couldn’t be sent. Try again later.',
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
