import {formatMessage} from '../../../../packages/i18n/src/index';

// Kept here until the canonical package owner adds these messages; package copies are read-only.
const messages = {
  'vega.connection.redirectLimit': 'This device can check redirects only after a request has been sent.',
  'vega.connection.credentialExposed': 'This connection sent your sign-in details to another address, so you have been signed out.',
} as const;
export function transportMessage(id: keyof typeof messages, locale = 'en-US'): string {
  return formatMessage(messages[id], {}, {locale});
}
