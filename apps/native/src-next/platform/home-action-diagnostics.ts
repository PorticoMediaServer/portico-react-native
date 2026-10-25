import {
  routePattern,
  type RouteId,
} from '../../../../packages/contracts/src/routes';

// Only fixed protocol names cross this boundary. Dynamic route parameters, query
// strings, native request IDs and request/response payloads never enter a record.
const routeRules = [
  ['GET', 'get_home'],
  ['GET', 'get_home_row'],
  ['GET', 'get_me'],
  ['GET', 'get_capabilities'],
  ['GET', 'get_playback_options'],
  ['PUT', 'put_device_capabilities'],
  ['GET', 'get_listening_preferences'],
  ['POST', 'create_queue'],
  ['GET', 'get_queue'],
  ['GET', 'get_queue_window'],
  ['GET', 'list_queue_entries'],
  ['POST', 'prepare_queue_next'],
  ['POST', 'commit_queue_next'],
  ['POST', 'advance_queue'],
  ['POST', 'start_playback_session'],
  ['GET', 'get_playback_session'],
  ['PATCH', 'change_playback_session'],
  ['DELETE', 'stop_playback_session'],
] as const satisfies readonly (readonly [string, RouteId])[];
type SafeRoute = (typeof routeRules)[number][1];
const compiled = routeRules.map(([method, route]) => ({
  method,
  route,
  pattern: new RegExp(
    '^' +
      routePattern(route)
        .split(/(\{[^}]+\})/)
        .map(part =>
          part.startsWith('{')
            ? '[^/?#]+'
            : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        )
        .join('') +
      '$',
  ),
}));
const codes = new Set([
  'unoffered_home_playback',
  'native_home_authority_required',
  'stale_home_context',
  'home-visible-registration-limit',
  'invalid_response',
  'invalid_home',
  'invalid_scope',
  'invalid_request',
  'request_failed',
  'network_error',
  'network_unavailable',
  'offline',
  'timeout',
  'cancelled',
  'unauthorized',
  'forbidden',
  'access_refused',
  'identity_mismatch',
  'not_found',
  'unavailable',
  'unsupported',
  'unsupported_media',
  'no_playable_version',
  'capabilities_required',
  'revision_required',
  'stale_revision',
  'conflict',
  'session_expired',
  'lease_expired',
  'stale_selection_context',
  'invalid_playback_target',
  'artwork_pending',
  'rate_limited',
  'server_busy',
]);
const classes = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'AbortError',
  'ApiError',
  'PlaybackApiError',
  'RouteError',
  'ContractError',
  'RequestTimeoutError',
]);
const origins = new Set([
  'home-card',
  'home-assembly',
  'assembly-error',
  'restore-error',
  'home-registration',
  'artwork-error',
  'native-http',
  'app-render',
]);
type ErrorOrigin = 'assembly-error' | 'restore-error' | 'home-registration' | 'artwork-error' | 'app-render';
type ActionOrigin = 'home-card' | 'home-assembly';
type Operation = 'primary-play' | 'menu';
type Stage = 'enter' | 'guard-refused' | 'unoffered' | 'dispatch';
const operations = new Set(['primary-play', 'menu']),
  stages = new Set(['enter', 'guard-refused', 'unoffered', 'dispatch']);
export const HOME_DIAGNOSTIC_LIMIT = 256,
  HOME_DIAGNOSTIC_ORIGIN_LIMIT = 64;
export const HOME_DIAGNOSTIC_PREFIX = '[home-play-r25] ';
type Ticket = Readonly<{request: number; route: SafeRoute}>;
type SafeRecord = {
  operation: string;
  stage?: Stage;
  request?: number;
  route?: SafeRoute;
  status?: number;
  code?: string;
  class?: string;
  frames?: readonly (readonly [number, number])[];
  componentFrames?: readonly (readonly [number, number])[];
};
const statusOf = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 100 &&
  value <= 599
    ? value
    : undefined;
function safeFrames(stack: unknown, skipMessage: boolean): [number, number][] {
  const frames: [number, number][] = [];
  if (typeof stack !== 'string') return frames;
  for (const line of stack.slice(0, 8000).split('\n').slice(skipMessage ? 1 : 0, 17)) {
    // Keep coordinates only, never a function/component name or source address.
    const match = /[:@](\d{1,7}):(\d{1,9})\)?$/.exec(line.trim());
    if (match) frames.push([Number(match[1]), Number(match[2])]);
    if (frames.length === 6) break;
  }
  return frames;
}
function safeError(
  error: unknown,
): Pick<SafeRecord, 'code' | 'class' | 'status' | 'frames'> {
  try {
    if (!error || typeof error !== 'object')
      return {code: 'other', class: 'unknown', frames: []};
    const value = error as {
      code?: unknown;
      name?: unknown;
      status?: unknown;
      stack?: unknown;
    };
    const code = value.code,
      name = value.name,
      stack = value.stack;
    const frames = safeFrames(stack, true);
    return {
      code: typeof code === 'string' && codes.has(code) ? code : 'other',
      class: typeof name === 'string' && classes.has(name) ? name : 'unknown',
      status: statusOf(value.status),
      frames,
    };
  } catch {
    return {code: 'other', class: 'unknown', frames: []};
  }
}

/** Passive, bounded receipts through the console path already installed by
 * index/error-capture (ErrorJournal + the original production native console).
 * A test-only factory argument controls the sink; there is no global/native hook. */
export function createHomeActionDiagnostics(
  sink: (line: string) => void = line => console.warn(line),
) {
  let sequence = 0,
    requestSequence = 0;
  const counts = new Map<string, number>(),
    tickets = new WeakSet<Ticket>();
  const write = (origin: string, record: SafeRecord) => {
    try {
      const count = counts.get(origin) ?? 0;
      if (
        !origins.has(origin) ||
        sequence >= HOME_DIAGNOSTIC_LIMIT ||
        count >= HOME_DIAGNOSTIC_ORIGIN_LIMIT
      )
        return;
      counts.set(origin, count + 1);
      sink(
        HOME_DIAGNOSTIC_PREFIX +
          JSON.stringify({v: 1, sequence: ++sequence, origin, ...record}),
      );
    } catch {
      /* Logging never changes the original operation, including when the sink throws. */
    }
  };
  return {
    action(
      origin: ActionOrigin,
      operation: Operation,
      stage: Stage = 'enter',
    ): void {
      try {
        if (operations.has(operation) && stages.has(stage))
          write(origin, {operation, stage});
      } catch {
        /* passive */
      }
    },
    error(origin: ErrorOrigin, error: unknown, componentStack?: unknown): void {
      try {
        const componentFrames = origin === 'app-render' ? safeFrames(componentStack, false) : [];
        write(origin, {operation: 'report-error', ...safeError(error),
          ...(componentFrames.length ? {componentFrames} : {})});
      } catch {
        /* passive */
      }
    },
    request(method: string, input: string): Ticket | undefined {
      try {
        if (
          sequence >= HOME_DIAGNOSTIC_LIMIT ||
          (counts.get('native-http') ?? 0) >= HOME_DIAGNOSTIC_ORIGIN_LIMIT ||
          input.length > 8192
        )
          return;
        const path = new URL(input).pathname,
          rule = compiled.find(
            value =>
              value.method === method.toUpperCase() && value.pattern.test(path),
          );
        if (!rule) return;
        const ticket = Object.freeze({
          request: ++requestSequence,
          route: rule.route,
        });
        tickets.add(ticket);
        write('native-http', {operation: 'dispatch', ...ticket});
        return ticket;
      } catch {
        return;
      }
    },
    response(ticket: Ticket | undefined, status: number): void {
      try {
        if (ticket && tickets.has(ticket))
          write('native-http', {
            operation: 'response',
            ...ticket,
            status: statusOf(status),
          });
      } catch {
        /* passive */
      }
    },
    rejected(ticket: Ticket | undefined, error: unknown): void {
      try {
        if (ticket && tickets.has(ticket))
          write('native-http', {
            operation: 'rejected',
            ...ticket,
            ...safeError(error),
          });
      } catch {
        /* passive */
      }
    },
  };
}
export const homeActionDiagnostics = createHomeActionDiagnostics();
