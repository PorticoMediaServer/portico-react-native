import {ApiError} from '@porticomediaserver/client-core';
import {
  ProductMessageError,
  productErrorMessageId,
  productErrorPresentation,
  productMessageText,
} from './productErrors';

test('never exposes arbitrary exception text as product copy', () => {
  expect(
    productErrorMessageId(
      new Error('Bonjour advertisement did not match credentials.'),
      'problem.connection-failed',
    ),
  ).toBe(
    "Portico couldn't establish a secure connection. Check your network and try again.",
  );
  expect(
    productErrorMessageId(
      new ApiError(500, 'internal_error', 'Database transaction failed.'),
      'problem.connection-failed',
    ),
  ).toBe(
    "Portico couldn't establish a secure connection. Check your network and try again.",
  );
});

test('preserves catalog-backed product errors and canonical API states', () => {
  expect(
    productErrorMessageId(
      new ProductMessageError('problem.invalid-request'),
      'problem.connection-failed',
    ),
  ).toBe('Some information is missing or invalid. Review it and try again.');
  expect(
    productErrorMessageId(
      new ProductMessageError('auth.profile-pin-required', {
        profileName: 'Grandma',
      }),
      'problem.connection-failed',
    ),
  ).toBe('Grandma is protected by a four-digit PIN.');
  expect(
    productErrorMessageId(
      new ApiError(401, 'invalid_refresh_token', 'Internal session detail.'),
      'problem.connection-failed',
    ),
  ).toBe(
    'Your session has expired. Sign in again to continue.',
  );
  expect(
    productErrorMessageId(
      new ApiError(429, 'rate_limited', 'Internal limiter detail.'),
      'problem.connection-failed',
    ),
  ).toBe(
    'Portico is temporarily limiting this request. Wait a moment, then try again.',
  );
});

test('resolves fallback wording exclusively through Product Language IDs', () => {
  expect(productMessageText('auth.profile-selection-failed')).toBe(
    "Portico couldn't open this profile. Choose it again or try another profile.",
  );
  expect(
    productErrorMessageId(
      {code: 'unsupported_hosted_api_version'},
      'problem.connection-failed',
    ),
  ).toBe(
    'This version of Portico can’t complete sign in. Update the app, then try again.',
  );
});

test('interpolates caller context into fallback and catalog-backed failures', () => {
  expect(
    productErrorMessageId(
      new Error('private transport detail'),
      'problem.server-unavailable',
      {serverName: 'Home'},
    ),
  ).toBe("Portico couldn't reach Home. Your Portico Account remains signed in.");
  expect(
    productErrorMessageId(
      new ProductMessageError('problem.server-unavailable'),
      'problem.connection-failed',
      {serverName: 'Home'},
    ),
  ).toBe("Portico couldn't reach Home. Your Portico Account remains signed in.");
});

test('resolves RN failures through catalog IDs, variables, and semantic icons', () => {
  const presentation = productErrorPresentation(
    new ApiError(503, 'server_unavailable', 'raw upstream detail'),
    'problem.connection-failed',
    {serverName: 'Home Server'},
  );
  expect(presentation).toMatchObject({
    id: 'problem.server-unavailable',
    icon: 'status.server',
    tone: 'warning',
    body: "Portico couldn't reach Home Server. Your Portico Account remains signed in.",
  });
  expect(presentation.body).not.toContain('raw upstream detail');
});

test('keeps local validation and unknown failures inside reviewed catalog copy', () => {
  expect(
    productErrorMessageId(
      new ProductMessageError('auth.profile-pin-required', {
        profileName: 'Grandma',
      }),
      'problem.request-failed',
    ),
  ).toBe('Grandma is protected by a four-digit PIN.');
  expect(
    productErrorMessageId(
      new Error('database path and token'),
      'preferences.request-failed',
    ),
  ).toBe('Review your choices and try again.');
  expect(productMessageText('action.retry')).toBe('Try again');
});

test('falls back when a direct product presentation is missing interpolation', () => {
  expect(
    productErrorMessageId(
      new ProductMessageError('feedback.heading.report-media'),
      'problem.connection-failed',
    ),
  ).toBe("Portico couldn't complete this request.");
});

test('maps compatibility failures to canonical recovery messages', () => {
  expect(productErrorMessageId(
    {code: 'unsupported_hosted_api_version'},
    'problem.connection-failed',
  )).toBe('This version of Portico can’t complete sign in. Update the app, then try again.');
  expect(productErrorMessageId(
    {code: 'unsupported_server_api_version'},
    'problem.connection-failed',
  )).toBe('This version of Portico Server can’t connect to the app. Ask the server owner to update it.');
});
