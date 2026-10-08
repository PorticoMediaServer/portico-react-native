import {
  ApiError,
  HttpLocalApi,
} from '../../../../packages/client-core/src/index.ts';
import type { CredentialSessionService } from '../../../../packages/client-core/src/credentials.ts';
import {
  AccountSessionReviewService,
  type AccountSessionScope,
} from '../../../../packages/client-core/src/account-sessions.ts';

export type SessionReviewCredentials = Pick<
  CredentialSessionService,
  'accessSession' | 'getSnapshot' | 'subscribe'
>;

function sameSession(
  credentials: SessionReviewCredentials,
  scope: AccountSessionScope,
) {
  const live = credentials.getSnapshot().session;
  return (
    live?.account.id === scope.accountId && live.familyId === scope.familyId
  );
}

function guard(
  credentials: SessionReviewCredentials,
  scope: AccountSessionScope,
  signal?: AbortSignal,
) {
  if (signal?.aborted)
    throw new ApiError(0, 'cancelled', 'The session request was cancelled.');
  if (!sameSession(credentials, scope)) {
    throw new ApiError(
      409,
      'account_changed',
      'Your Portico Account session changed. Reopen Account sessions.',
    );
  }
}

/** Deliberately do not display arbitrary HTTP, provider or secure-storage error text. */
function publicError(error: unknown): ApiError {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 401)
    return new ApiError(
      401,
      'unauthorized',
      'This account session has ended. Sign in again.',
    );
  if (status === 403)
    return new ApiError(
      403,
      'forbidden',
      'This account cannot review that session. Refresh account sessions.',
    );
  if (status === 404)
    return new ApiError(
      404,
      'session_unavailable',
      'That account session is unavailable. Refresh account sessions.',
    );
  if (status === 409 || status === 400)
    return new ApiError(
      status,
      'session_review_changed',
      'The session information changed. Refresh account sessions and try again.',
    );
  return new ApiError(
    status,
    'request_failed',
    'The account request could not be confirmed. Check your connection and try again.',
    true,
  );
}

export function nativeAccountSessionReview({
  credentials,
  origin,
  scope,
  fetcher,
  timeoutMs,
}: {
  credentials: SessionReviewCredentials;
  origin: string;
  scope: AccountSessionScope;
  fetcher?: typeof fetch;
  timeoutMs?: number;
}) {
  const bound = Object.freeze({ ...scope });
  const url = new URL(origin);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('Use the configured Portico Account origin.');
  }
  // Validate the configured origin before any credential access or request.
  const baseUrl = new HttpLocalApi(origin).baseUrl;
  return new AccountSessionReviewService({
    scope: bound,
    timeoutMs,
    api: {
      async request<T>(
        path: string,
        method = 'GET',
        _body?: unknown,
        signal?: AbortSignal,
      ): Promise<T> {
        guard(credentials, bound, signal);
        try {
          const session = await credentials.accessSession();
          guard(credentials, bound, signal);
          if (
            session.account.id !== bound.accountId ||
            session.familyId !== bound.familyId
          ) {
            throw new ApiError(
              409,
              'account_changed',
              'Account session changed.',
            );
          }
          const result = await new HttpLocalApi(
            baseUrl,
            session.accessToken,
            fetcher,
          ).request<T>(path, method, undefined, signal);
          guard(credentials, bound, signal);
          return result;
        } catch (error) {
          // Includes failures thrown after asynchronous error-body parsing.
          guard(credentials, bound, signal);
          throw publicError(error);
        }
      },
    },
  });
}

/** The shell owns cleanup; the matching-family check and callback are synchronous. */
export function currentSessionEndHandler(
  credentials: SessionReviewCredentials,
  scope: AccountSessionScope,
  onEnded: () => void,
) {
  const bound = Object.freeze({ ...scope });
  let handled = false;
  return () => {
    if (handled || !sameSession(credentials, bound)) return;
    handled = true;
    onEnded();
  };
}
