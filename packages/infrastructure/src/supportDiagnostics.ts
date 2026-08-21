import {porticoClientDescriptor, type PorticoClientDescriptor, type PorticoPlatform} from './types';

export const PORTICO_SUPPORT_BUNDLE_VERSION = 1 as const;
export const PORTICO_DIAGNOSTIC_EVENT_VERSION = 1 as const;
export const PORTICO_DIAGNOSTIC_EVENT_CAPACITY = 64 as const;
const MAX_DIAGNOSTIC_STAGE_LENGTH = 64;
const MAX_DIAGNOSTIC_STRING_LENGTH = 128;

export type PorticoDiagnosticPrimitive = string | number | boolean;
export type PorticoDiagnosticInput = Record<string, unknown>;
export type PorticoDiagnosticDetails = Readonly<Record<string, PorticoDiagnosticPrimitive>>;

export interface PorticoDiagnosticEvent {
  readonly version: typeof PORTICO_DIAGNOSTIC_EVENT_VERSION;
  readonly at: string;
  readonly stage: string;
  readonly details: PorticoDiagnosticDetails;
}

export interface PorticoSupportState {
  readonly authStatus?:
    | 'booting'
    | 'signed-out'
    | 'connecting'
    | 'selecting-profile'
    | 'selecting-server'
    | 'server-unavailable'
    | 'authenticated';
  readonly connectionState?: 'unknown' | 'connecting' | 'reachable' | 'unreachable';
  readonly networkLocality?: 'local-network' | 'wide-area' | 'offline' | 'unknown';
  readonly accountSignedIn?: boolean;
  readonly activeSession?: boolean;
  readonly profileSelected?: boolean;
  readonly serverCount?: number;
  readonly profileCount?: number;
}

export interface PorticoSupportBundle {
  readonly version: typeof PORTICO_SUPPORT_BUNDLE_VERSION;
  readonly generatedAt: string;
  readonly client: PorticoClientDescriptor;
  readonly state?: Readonly<PorticoSupportState>;
  readonly events: readonly PorticoDiagnosticEvent[];
}

export interface PorticoDiagnosticsControllerBoundary {
  record(stage: string, details?: PorticoDiagnosticInput): PorticoDiagnosticEvent;
  recordError(stage: string, cause: unknown, details?: PorticoDiagnosticInput): PorticoDiagnosticEvent;
  subscribe(listener: (event: PorticoDiagnosticEvent) => void): () => void;
  createSupportBundle(
    descriptor: PorticoClientDescriptor,
    state?: PorticoSupportState,
  ): PorticoSupportBundle;
  clear(): void;
}

/**
 * Stable, UI-independent diagnostics boundary. It stores only an allow-listed
 * ring of facts and isolates observers so support tooling cannot affect auth,
 * discovery, or playback state.
 */
export class PorticoDiagnosticsController implements PorticoDiagnosticsControllerBoundary {
  private readonly events: PorticoDiagnosticEvent[] = [];
  private readonly listeners = new Set<(event: PorticoDiagnosticEvent) => void>();
  private readonly capacity: number;

  constructor(capacity: number = PORTICO_DIAGNOSTIC_EVENT_CAPACITY) {
    this.capacity = Math.max(1, Math.min(PORTICO_DIAGNOSTIC_EVENT_CAPACITY, Math.trunc(capacity)));
  }

  record(stage: string, details: PorticoDiagnosticInput = {}): PorticoDiagnosticEvent {
    const event: PorticoDiagnosticEvent = Object.freeze({
      version: PORTICO_DIAGNOSTIC_EVENT_VERSION,
      at: new Date().toISOString(),
      stage: safeIdentifier(stage, 'unknown-stage', MAX_DIAGNOSTIC_STAGE_LENGTH),
      details: sanitizeDetails(details),
    });
    this.events.push(event);
    while (this.events.length > this.capacity) this.events.shift();
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // Diagnostics observers are non-authoritative extension points.
      }
    }
    return event;
  }

  recordError(
    stage: string,
    cause: unknown,
    details: PorticoDiagnosticInput = {},
  ): PorticoDiagnosticEvent {
    const errorName = safeErrorName(cause);
    const errorCode = safeErrorCode(cause);
    return this.record(stage, {
      ...details,
      errorName,
      ...(errorCode ? {errorCode} : {}),
    });
  }

  subscribe(listener: (event: PorticoDiagnosticEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  createSupportBundle(
    descriptor: PorticoClientDescriptor,
    state?: PorticoSupportState,
  ): PorticoSupportBundle {
    return Object.freeze({
      version: PORTICO_SUPPORT_BUNDLE_VERSION,
      generatedAt: new Date().toISOString(),
      client: descriptor,
      ...(state ? {state: sanitizeSupportState(state)} : {}),
      events: Object.freeze([...this.events]),
    });
  }

  clear(): void {
    this.events.length = 0;
  }
}

export const porticoDiagnostics = new PorticoDiagnosticsController();

export function recordPorticoDiagnostic(
  stage: string,
  details: PorticoDiagnosticInput = {},
): PorticoDiagnosticDetails {
  return porticoDiagnostics.record(stage, details).details;
}

export function recordPorticoErrorDiagnostic(
  stage: string,
  cause: unknown,
  details: PorticoDiagnosticInput = {},
): PorticoDiagnosticDetails {
  return porticoDiagnostics.recordError(stage, cause, details).details;
}

export function createPorticoSupportBundle(
  platform: PorticoPlatform,
  state?: PorticoSupportState,
): PorticoSupportBundle {
  return porticoDiagnostics.createSupportBundle(porticoClientDescriptor(platform), state);
}

const ALLOWED_DETAIL_KEYS = new Set([
  'source',
  'name',
  'errorName',
  'errorCode',
  'code',
  'authority',
  'status',
  'phase',
  'operation',
  'started',
  'completed',
  'discoveredRecords',
  'identityMatches',
  'routeCandidates',
  'serverIdMatched',
  'sessionPresent',
  'authorityMatches',
  'accountMatches',
  'serverMatches',
  'profileMatches',
  'authorizationRevisionPresent',
  'authorizationRevisionMatches',
  'revisionRequired',
  'serverDirectoryLoaded',
  'networkLocality',
  'authStatus',
  'connectionState',
  'accountSignedIn',
  'activeSession',
  'profileSelected',
  'serverCount',
  'profileCount',
]);

function sanitizeDetails(details: PorticoDiagnosticInput): PorticoDiagnosticDetails {
  const safe: Record<string, PorticoDiagnosticPrimitive> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!ALLOWED_DETAIL_KEYS.has(key)) continue;
    const normalized = sanitizePrimitive(key, value);
    if (normalized !== undefined) safe[key] = normalized;
  }
  return Object.freeze(safe);
}

function sanitizeSupportState(state: PorticoSupportState): Readonly<PorticoSupportState> {
  return Object.freeze({
    ...(state.authStatus ? {authStatus: state.authStatus} : {}),
    ...(state.connectionState ? {connectionState: state.connectionState} : {}),
    ...(state.networkLocality ? {networkLocality: state.networkLocality} : {}),
    ...(typeof state.accountSignedIn === 'boolean' ? {accountSignedIn: state.accountSignedIn} : {}),
    ...(typeof state.activeSession === 'boolean' ? {activeSession: state.activeSession} : {}),
    ...(typeof state.profileSelected === 'boolean' ? {profileSelected: state.profileSelected} : {}),
    ...(boundedCount(state.serverCount) !== undefined ? {serverCount: boundedCount(state.serverCount)} : {}),
    ...(boundedCount(state.profileCount) !== undefined ? {profileCount: boundedCount(state.profileCount)} : {}),
  });
}

function sanitizePrimitive(
  key: string,
  value: unknown,
): PorticoDiagnosticPrimitive | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return boundedCount(value) ?? 0;
  if (typeof value !== 'string') return undefined;
  if (key === 'name' || key === 'errorName' || key === 'errorCode' || key === 'code' || key === 'source' || key === 'stage') {
    return safeIdentifier(value, 'unknown', MAX_DIAGNOSTIC_STRING_LENGTH);
  }
  if (
    /https?:\/\/|(?:^|\b)[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:^|[\\/])(?:Users|home|var|tmp)[\\/]|(?:ptc_|bearer\s+)/i.test(value)
  ) {
    return '[redacted]';
  }
  return value.trim().slice(0, MAX_DIAGNOSTIC_STRING_LENGTH);
}

function safeIdentifier(value: string, fallback: string, maxLength: number): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, maxLength);
  return normalized || fallback;
}

function safeErrorName(value: unknown): string {
  return value instanceof Error
    ? safeIdentifier(value.name, 'Error', MAX_DIAGNOSTIC_STRING_LENGTH)
    : 'UnknownError';
}

function safeErrorCode(value: unknown): string | undefined {
  const code = value && typeof value === 'object'
    ? (value as {code?: unknown}).code
    : undefined;
  return typeof code === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(code)
    ? code
    : undefined;
}

function boundedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.min(1_000_000, Math.trunc(value)))
    : undefined;
}
