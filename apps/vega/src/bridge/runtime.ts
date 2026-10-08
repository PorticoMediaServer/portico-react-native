import {failure} from './events';
import {profileTrust} from './profile-trust';
import {randomBytes, uuid} from './random';
import {readRecord, serialized, writeRecord, type Service} from './storage';
import {cancel, submit, utf8Length, type WireResponse} from './transport';

const settings = require('../../app.json') as {portico?: {hostedUrl?: string}};

/**
 * `NativeModules.PorticoRuntime` (`Native/PorticoPlayer.m`): the app's records, its bounded HTTP
 * transport, request identifiers and the profile trust vault. Method names, promise shapes,
 * rejection codes and bounds are the Apple module's.
 */
const MEGABYTE = 1048576, RECORD_LIMIT = 262144;
const subtitlesPath = /^\/v1\/items\/[A-Za-z0-9_-]+\/playback\/[A-Za-z0-9_-]+\/subtitles$/;
const loopback = ['localhost', '127.0.0.1', '::1', '[::1]'];
const VIEWER = 'portico:selected-viewer:v1', QUARANTINE = 'portico:selected-viewer:quarantined';

function target(url: unknown): URL | null {
  if (typeof url !== 'string' || url.length > 8192) return null;
  try {
    const parsed = new URL(url);
    return parsed.username || parsed.password || parsed.hash || url.includes('#') ? null : parsed;
  } catch {
    return null;
  }
}

function bounded(identifier: string, url: string, method: string, headers: unknown, body: string | null, fullAPI: boolean): Promise<WireResponse> {
  const parsed = target(url);
  const path = parsed?.pathname ?? '';
  const allowedPath = fullAPI ? path.startsWith('/v1/') || path.startsWith('/v2/') : path.startsWith('/v2/') || subtitlesPath.test(path);
  const methods = fullAPI ? ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] : ['GET', 'POST', 'PUT'];
  const text = typeof body === 'string' ? body : null;
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol) || !allowedPath || !methods.includes(method) || (text !== null && utf8Length(text) > MEGABYTE) || typeof identifier !== 'string' || identifier.length > 128) {
    return Promise.reject(failure('queue_transport', 'Invalid queue request.'));
  }
  // API reads that grow with the library (Home rows, queue views) get 8 MB; writes and the narrow
  // queue-control surface keep the 1 MB bound.
  const limit = fullAPI && method === 'GET' ? 8 * MEGABYTE : MEGABYTE;
  return submit({identifier, url, method, headers, body: text, limit, domain: 'queue_transport', busy: 'Too many queue requests.'});
}

async function load(service: Service, account: string, missing: string | null, problem: string): Promise<string | null> {
  try { return (await readRecord(service, account)) ?? missing; } catch { throw failure('secure_storage', problem); }
}

async function save(service: Service, account: string, json: string, full: [string, string], problem: string): Promise<boolean> {
  if (typeof json !== 'string' || utf8Length(json) > RECORD_LIMIT) throw failure(full[0], full[1]);
  try { await writeRecord(service, account, json); } catch { throw failure('secure_storage', problem); }
  return true;
}

export const PorticoRuntime = {
  launchId: uuid(),
  hostedUrl: settings.portico?.hostedUrl || undefined,

  /** A development aid on Apple (a journey log for automated runs); nothing records it here. */
  recordTestEvent(_json: string): void {},

  loadQueueRecord: (key: string) => load('queues', key, null, 'Queue recovery could not be read.'),
  saveQueueRecord: (key: string, json: string) => save('queues', key, json, ['queue_journal_size', 'Queue recovery is full.'], 'Queue recovery could not be saved.'),

  queueRequest: (identifier: string, url: string, method: string, headers: unknown, body: string | null) => bounded(identifier, url, method, headers, body, false),
  networkRequest: (identifier: string, url: string, method: string, headers: unknown, body: string | null) => bounded(identifier, url, method, headers, body, true),

  /** Passwords, PINs and profile proofs: TLS only (plain HTTP to this device alone), 64 KB. */
  profileRequest(identifier: string, url: string, method: string, headers: unknown, body: string | null): Promise<WireResponse> {
    const parsed = target(url);
    const text = typeof body === 'string' ? body : null;
    const secure = parsed?.protocol === 'https:' || (parsed?.protocol === 'http:' && loopback.includes(parsed.hostname));
    if (!parsed || !secure || !parsed.pathname.startsWith('/v1/') || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method) || (text !== null && utf8Length(text) > 65536) || typeof identifier !== 'string' || identifier.length > 128) {
      return Promise.reject(failure('profile_transport', 'A secure, bounded profile request is required.'));
    }
    return submit({identifier, url, method, headers, body: text, limit: MEGABYTE, domain: 'profile_transport', busy: 'Too many requests are in progress.'});
  },

  cancelQueueRequest(identifier: string): void { cancel(identifier); },

  playbackRequestId: (): string => uuid(),
  newRequestId: (): Promise<string> => Promise.resolve(uuid()),

  profileInstallation: () => profileTrust.installation(),
  saveProfileTrust: (scope: string, metadata: string, payload: string, pin: string) => profileTrust.save(scope, metadata, payload, pin),
  listProfileTrust: () => profileTrust.list(),
  unlockProfileTrust: (scope: string, pin: string) => profileTrust.unlock(scope, pin),
  removeProfileTrust: (scope: string) => profileTrust.remove(scope),

  loadSelectedViewer(): Promise<string | null> {
    return serialized(VIEWER, async () => {
      try {
        if ((await readRecord('credentials', QUARANTINE)) !== null) return null;
        return await readRecord('credentials', VIEWER);
      } catch {
        throw failure('secure_storage', 'The saved server selection could not be read.');
      }
    });
  },

  /**
   * A selection that could not be confirmed in storage is quarantined: the next launch reads no
   * selection rather than one that may be stale, and asks for the server sign-in again.
   */
  saveSelectedViewer(json: string): Promise<boolean> {
    return serialized(VIEWER, async () => {
      const removing = json === 'null';
      const quarantine = () => writeRecord('credentials', QUARANTINE, '1').catch(() => {});
      if (removing) await quarantine();
      if (typeof json !== 'string' || utf8Length(json) > 65536) throw failure('secure_storage', 'The server credential record is invalid.');
      try {
        await writeRecord('credentials', VIEWER, removing ? null : json);
      } catch {
        await quarantine();
        throw failure('secure_storage', 'Server credential storage could not be verified. Sign in to the server again.');
      }
      if (!removing) {
        try { await writeRecord('credentials', QUARANTINE, null); } catch { throw failure('secure_storage', 'The server credential could not be saved. The account credential is unchanged.'); }
      }
      return true;
    });
  },

  loadCredentials: (origin: string) => load('credentials', origin, null, 'Account credentials could not be read.'),
  saveCredentials: (origin: string, json: string) => save('credentials', origin, json, ['credential_size', 'Account credential storage is full.'], 'Account credentials could not be saved.'),
  loadJournal: (scope: string) => load('playback', scope, '[]', 'Playback recovery could not be read.'),
  saveJournal: (scope: string, json: string) => save('playback', scope, json, ['journal_size', 'Playback recovery is full.'], 'Playback recovery could not be saved.'),

  /** 1 to 64 bytes from the system generator, or null (which the caller treats as unavailable). */
  playbackRandomBytes(count: number): number[] | null {
    const n = Math.trunc(Number(count));
    if (!(n >= 1 && n <= 64)) return null;
    try { return Array.from(randomBytes(n)); } catch { return null; }
  },
};
