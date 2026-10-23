import {presentError, type ErrorContext, type ErrorOperation, type PresentOptions, type PresentedError} from '../../../../packages/client-core/src/presentation/index';
import {classifyPorticoFailure} from './portico-failure';
import {defaultI18n, type I18n, type MessageId} from '../../../../packages/i18n/src/index';

export type {ErrorContext, PresentedError} from '../../../../packages/client-core/src/presentation/index';

/**
 * APL-SYS-04 / X-04: the only way an error reaches the screen. Errors are mapped by code and
 * status through the shared presentation layer; raw `Error.message` text (JavaScript, fetch,
 * core or server) is diagnostic and never rendered.
 *
 * `useI18n()` keeps `active` on the viewer's catalogue so callbacks outside render (a `.catch`)
 * speak the same language as the screen.
 */
let active: I18n = defaultI18n;
export function setActiveI18n(i18n: I18n) {
  active = i18n;
}
/** The viewer's catalogue outside a hook: callbacks, and components that must not gain a hook. */
export const activeI18n = (): I18n => active;

export function present(error: unknown, context: ErrorContext = 'generic', options: PresentOptions = {}): PresentedError {
  return presentError(error, context, {i18n: active, ...options});
}

/** The body only, for an inline notice beside the control that failed. Empty for cancellations. */
export function say(error: unknown, context: ErrorContext = 'generic', operation: ErrorOperation = 'action'): string {
  if (error instanceof ShownError) return error.message;
  const p = present(error, context, {operation});
  return p.silent ? '' : p.body;
}

/** Copy Portico itself wrote for a specific, known situation (not a transport or server message). */
export class ShownError extends Error {
  readonly shown = true;
}

/** Sign-in keeps a few specific answers the generic mapping can't give (a wrong password is not "sign in again"). */
const signInCodes: Record<string, MessageId> = {
  invalid_credentials: 'signIn.error.notAccepted',
  invalid_grant: 'signIn.error.notAccepted',
  ambiguous_credentials: 'signIn.error.notAccepted',
  credentials_required: 'signIn.error.detailsRequired',
  challenge_invalid: 'signIn.error.codeInvalid',
  invalid_code: 'signIn.error.codeInvalid',
  mfa_invalid: 'signIn.error.codeInvalid',
  profile_pin_locked: 'signIn.error.tooManyTries',
  invalid_pin: 'signIn.error.pinInvalid',
  expired_token: 'signIn.error.expired',
  challenge_expired: 'signIn.error.expired',
  // The owner's own certificate and Apple's local-only plain HTTP (bridge/certificate-trust.ts).
  certificate_changed: 'connection.certificate.changed',
  certificate_unverified: 'connection.certificate.unverified',
  certificate_untrusted: 'connection.certificate.untrusted',
  plain_http_remote: 'connection.plainHttp.appleRemote',
};

/**
 * The specific message for a failed sign-in to a server (Portico Account or direct), or undefined
 * when the error is none of these. `session_migrated` is re-admitted silently, so it says nothing.
 */
export function signInCause(error: unknown, category?: string, server = active.t('invitation.thisServer')): string | undefined {
  // What the owner's own rules say about this account: not a failure of the sign-in, and nothing to retry differently.
  const code = (error as {code?: unknown} | null)?.code;
  if (code === 'transport_unavailable') return undefined;
  if (code === 'outside_allowed_hours') return active.t('web.signIn.error.outsideHours', {server});
  if (code === 'remote_sign_in_not_allowed') return active.t('web.signIn.error.remoteNotAllowed', {server});
  if (code === 'invitation_for_another_account') return active.t('web.signIn.error.invitationOtherAccount', {server});
  const f = classifyPorticoFailure(error, 'signIn', server, category);
  switch (f.kind) {
    case 'migrated': return '';
    case 'noAccess': return active.t('portico.failure.noAccess.title', {server});
    case 'clockSkew': return active.t('portico.failure.clockSkew.title', {server});
    case 'identity': return active.t('portico.failure.identity.title', {server});
    case 'incompatible': return active.t('portico.failure.incompatible.title', {server});
    case 'unreachable': return active.t('portico.failure.unreachable.title', {server});
    case 'devicePending': return active.t('device.approval.titleThisDevice');
    case 'deviceDenied': return active.t('portico.failure.deviceDenied.title', {server});
    default: return undefined;
  }
}

/** `service: 'portico-account'` for sign-in through the Portico Account (Hosted): reachability copy names the account, not the server. */
export function signInMessage(error: unknown, operation: ErrorOperation = 'action', service: 'server' | 'portico-account' = 'server'): string {
  const code = error && typeof error === 'object' && typeof (error as {code?: unknown}).code === 'string' ? (error as {code: string}).code : '';
  const status = error && typeof error === 'object' && typeof (error as {status?: unknown}).status === 'number' ? (error as {status: number}).status : undefined;
  if (error instanceof ShownError) return error.message;
  if (signInCodes[code]) return active.t(signInCodes[code]);
  // Every cause a server sign-in can end on has its own words (INT): never a generic "not accepted".
  const cause = signInCause(error, present(error, 'sign-in', {operation, service}).category);
  if (cause !== undefined) return cause;
  if (status === 401) return active.t('signIn.error.notAccepted');
  if (service === 'portico-account') { const p = present(error, 'sign-in', {operation, service}); return p.silent ? '' : p.body; }
  return say(error, 'sign-in', operation);
}
