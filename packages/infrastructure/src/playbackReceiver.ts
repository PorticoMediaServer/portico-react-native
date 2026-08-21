import 'react-native-get-random-values';
import {x25519} from '@noble/curves/ed25519.js';
import {randomBytes as secureRandomBytes} from '@noble/curves/utils.js';
import {gcm} from '@noble/ciphers/aes.js';
import {hkdf} from '@noble/hashes/hkdf.js';
import {sha256} from '@noble/hashes/sha2.js';
import {fromByteArray, toByteArray} from 'base64-js';

export const PORTICO_RECEIVER_SERVICE_TYPE = '_portico-receiver._tcp' as const;
export const PORTICO_RECEIVER_PROTOCOL_VERSION = 1 as const;
export const PORTICO_RECEIVER_ALGORITHM = 'X25519-HKDF-SHA256-AESGCM' as const;

export type PorticoReceiverCommandAction = 'load' | 'play' | 'pause' | 'seek' | 'stop';

export interface ReceiverControllerIdentity {
  controllerId: string;
  privateKey: Uint8Array;
  publicKey: string;
}

/** Installed on the sender only after an account-authorized receiver ceremony. */
export interface ReceiverControllerGrant {
  authorizationId: string;
  receiverId: string;
  serverId: string;
  receiverPublicKey: string;
  receiverPublicKeyFingerprint: string;
  allowedCommands: readonly PorticoReceiverCommandAction[];
  expiresAt: string;
}

/** Installed on the receiver by the same authority; never published over Bonjour. */
export interface ReceiverAuthorizationRecord {
  authorizationId: string;
  receiverId: string;
  serverId: string;
  controllerId: string;
  controllerPublicKey: string;
  allowedCommands: readonly PorticoReceiverCommandAction[];
  expiresAt: string;
}

export interface ReceiverLoadCommand {
  action: 'load';
  playbackSessionId: string;
  sourceURL: string;
  /** Encrypted inside the receiver command; never encoded into sourceURL. */
  mediaAuthorization: string;
  mediaGrantExpiresAt: string;
  title: string;
  subtitle?: string;
  posterURL?: string;
  contentType?: string;
  durationSeconds?: number;
  positionSeconds?: number;
  autoplay?: boolean;
  isLive?: boolean;
}

export type ReceiverCommand = ReceiverLoadCommand | {
  action: Exclude<PorticoReceiverCommandAction, 'load'>;
  playbackSessionId: string;
  positionSeconds?: number;
};

export interface ReceiverCommandPayload {
  commandId: string;
  issuedAt: string;
  expiresAt: string;
  sequence: number;
  command: ReceiverCommand;
}

/**
 * Stateful receiver-side verifier. Authorization replacement is the revocation
 * boundary; sequence and command IDs are retained per authorization to reject
 * replay even when connections are reordered.
 */
export class ReceiverCommandProcessor {
  private authorizations: readonly ReceiverAuthorizationRecord[];
  private readonly lastSequence = new Map<string, number>();
  private readonly commandIds = new Map<string, number>();

  constructor(
    private readonly receiverPrivateKey: Uint8Array,
    authorizations: readonly ReceiverAuthorizationRecord[],
  ) {
    this.authorizations = authorizations;
  }

  replaceAuthorizations(authorizations: readonly ReceiverAuthorizationRecord[]): void {
    this.authorizations = authorizations;
  }

  open(sealed: SealedReceiverCommand, now = new Date()): ReceiverCommandPayload {
    const authorization = this.authorizations.find(value =>
      value.authorizationId === sealed.authorizationId &&
      value.receiverId === sealed.receiverId &&
      value.controllerId === sealed.controllerId,
    );
    if (!authorization) throw new Error('Receiver command authorization is unavailable or revoked.');
    const payload = openReceiverCommand(this.receiverPrivateKey, authorization, sealed, {
      lastSequence: this.lastSequence.get(authorization.authorizationId),
      now,
    });
    this.pruneCommandIds(now.getTime());
    if (this.commandIds.has(payload.commandId)) throw new Error('Receiver command was replayed.');
    this.lastSequence.set(authorization.authorizationId, payload.sequence);
    while (this.lastSequence.size > 256) this.lastSequence.delete(this.lastSequence.keys().next().value!);
    this.commandIds.set(payload.commandId, Date.parse(payload.expiresAt));
    while (this.commandIds.size > 256) this.commandIds.delete(this.commandIds.keys().next().value!);
    return payload;
  }

  private pruneCommandIds(now: number): void {
    for (const [commandId, expiresAt] of this.commandIds) {
      if (expiresAt <= now) this.commandIds.delete(commandId);
    }
  }
}

export interface SealedReceiverCommand {
  version: typeof PORTICO_RECEIVER_PROTOCOL_VERSION;
  algorithm: typeof PORTICO_RECEIVER_ALGORITHM;
  authorizationId: string;
  receiverId: string;
  controllerId: string;
  controllerPublicKey: string;
  sequence: number;
  nonce: string;
  ciphertext: string;
}

export interface NearbyReceiverAdvertisement {
  receiverId: string;
  serverId: string;
  receiverPublicKeyFingerprint: string;
  deviceName: string;
  platform: string;
  appVersion: string;
  capabilities: readonly PorticoReceiverCommandAction[];
  expiresAt: string;
  protocolVersion: typeof PORTICO_RECEIVER_PROTOCOL_VERSION;
}

export interface NearbyAuthorizedReceiver extends NearbyReceiverAdvertisement {
  id: string;
  instanceName: string;
  serviceType: typeof PORTICO_RECEIVER_SERVICE_TYPE;
  hostName: string;
  port: number;
  authorization: ReceiverControllerGrant;
}

export interface ReceiverDiscoveryEvent {
  action?: unknown;
  instanceName?: unknown;
  serviceType?: unknown;
  txt?: unknown;
  hostName?: unknown;
  port?: unknown;
}

export function createReceiverControllerIdentity(controllerId: string): ReceiverControllerIdentity {
  const normalizedId = requiredIdentifier(controllerId, 'controller ID');
  const privateKey = x25519.utils.randomSecretKey();
  return {controllerId: normalizedId, privateKey, publicKey: encodeBase64URL(x25519.getPublicKey(privateKey))};
}

export function receiverPublicKeyFingerprint(publicKey: string): string {
  return encodeBase64URL(sha256(decodeBase64URL(publicKey)));
}

export function sealReceiverCommand(
  identity: ReceiverControllerIdentity,
  grant: ReceiverControllerGrant,
  command: ReceiverCommand,
  sequence: number,
  options: {commandId?: string; now?: Date; ttlMs?: number} = {},
): SealedReceiverCommand {
  validateControllerGrant(identity, grant, options.now);
  validateReceiverCommand(command, grant.allowedCommands, options.now);
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Receiver command sequence must be a positive integer.');
  const now = options.now ?? new Date();
  const ttl = Math.min(30_000, Math.max(1_000, options.ttlMs ?? 10_000));
  const payload: ReceiverCommandPayload = {
    commandId: options.commandId?.trim() || randomId('rcmd'),
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
    sequence,
    command,
  };
  const nonce = randomBytes(12);
  const key = receiverSharedKey(identity.privateKey, grant.receiverPublicKey, grant.authorizationId, grant.receiverId);
  const aad = commandAAD(grant.authorizationId, grant.receiverId, identity.controllerId, sequence);
  const ciphertext = gcm(key, nonce, textBytes(aad)).encrypt(textBytes(JSON.stringify(payload)));
  return {
    version: PORTICO_RECEIVER_PROTOCOL_VERSION,
    algorithm: PORTICO_RECEIVER_ALGORITHM,
    authorizationId: grant.authorizationId,
    receiverId: grant.receiverId,
    controllerId: identity.controllerId,
    controllerPublicKey: identity.publicKey,
    sequence,
    nonce: encodeBase64URL(nonce),
    ciphertext: encodeBase64URL(ciphertext),
  };
}

export function openReceiverCommand(
  receiverPrivateKey: Uint8Array,
  authorization: ReceiverAuthorizationRecord,
  sealed: SealedReceiverCommand,
  options: {lastSequence?: number; now?: Date} = {},
): ReceiverCommandPayload {
  if (sealed.version !== PORTICO_RECEIVER_PROTOCOL_VERSION || sealed.algorithm !== PORTICO_RECEIVER_ALGORITHM) {
    throw new Error('Unsupported receiver command protocol.');
  }
  if (sealed.authorizationId !== authorization.authorizationId || sealed.receiverId !== authorization.receiverId || sealed.controllerId !== authorization.controllerId) {
    throw new Error('Receiver command authorization does not match this receiver.');
  }
  if (sealed.controllerPublicKey !== authorization.controllerPublicKey) throw new Error('Receiver command controller identity did not match its authorization.');
  const lastSequence = options.lastSequence ?? 0;
  if (!Number.isSafeInteger(sealed.sequence) || sealed.sequence <= lastSequence) throw new Error('Receiver command was replayed or arrived out of order.');
  validateAuthorizationRecord(authorization, options.now);
  const key = receiverSharedKey(receiverPrivateKey, authorization.controllerPublicKey, authorization.authorizationId, authorization.receiverId);
  const aad = commandAAD(authorization.authorizationId, authorization.receiverId, authorization.controllerId, sealed.sequence);
  const plaintext = gcm(key, decodeBase64URL(sealed.nonce), textBytes(aad)).decrypt(decodeBase64URL(sealed.ciphertext));
  const payload = JSON.parse(decodeText(plaintext)) as ReceiverCommandPayload;
  if (payload.sequence !== sealed.sequence || !payload.commandId?.trim()) throw new Error('Receiver command payload is inconsistent.');
  const now = options.now ?? new Date();
  const issuedAt = Date.parse(payload.issuedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > now.getTime() + 30_000 || expiresAt <= now.getTime() || expiresAt - issuedAt > 30_000) {
    throw new Error('Receiver command is expired or has an invalid timestamp.');
  }
  validateReceiverCommand(payload.command, authorization.allowedCommands, now);
  return payload;
}

export function parseAuthorizedNearbyReceiver(
  event: ReceiverDiscoveryEvent,
  grants: readonly ReceiverControllerGrant[],
  now = new Date(),
): NearbyAuthorizedReceiver | undefined {
  const serviceType = normalizeServiceType(event.serviceType);
  const instanceName = text(event.instanceName);
  const hostName = text(event.hostName);
  const port = typeof event.port === 'number' ? event.port : Number.NaN;
  if (serviceType !== PORTICO_RECEIVER_SERVICE_TYPE || !instanceName || !hostName || !Number.isInteger(port) || port < 1 || port > 65_535 || !isRecord(event.txt)) return undefined;
  const txt = event.txt;
  if (text(txt.txtversion) !== String(PORTICO_RECEIVER_PROTOCOL_VERSION)) return undefined;
  const receiverId = text(txt.receiverid);
  const serverId = text(txt.serverid);
  const receiverPublicKeyFingerprint = text(txt.keyfingerprint);
  const deviceName = text(txt.name);
  const platform = text(txt.platform);
  const appVersion = text(txt.appversion);
  const expiresAt = text(txt.expiresat);
  const capabilities = parseCapabilities(txt.capabilities);
  if (!receiverId || !serverId || !receiverPublicKeyFingerprint || !deviceName || !platform || !appVersion || !capabilities.length) return undefined;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime() || expiry > now.getTime() + 24 * 60 * 60_000) return undefined;
  const authorization = grants.find(grant => grant.receiverId === receiverId
    && grant.serverId === serverId
    && grant.receiverPublicKeyFingerprint === receiverPublicKeyFingerprint
    && Date.parse(grant.expiresAt) > now.getTime());
  if (!authorization) return undefined;
  const effectiveCapabilities = capabilities.filter(capability => authorization.allowedCommands.includes(capability));
  if (!effectiveCapabilities.includes('load')) return undefined;
  return {
    id: `${PORTICO_RECEIVER_SERVICE_TYPE}:${instanceName}`,
    instanceName,
    serviceType: PORTICO_RECEIVER_SERVICE_TYPE,
    hostName,
    port,
    receiverId,
    serverId,
    receiverPublicKeyFingerprint,
    deviceName,
    platform,
    appVersion,
    capabilities: effectiveCapabilities,
    expiresAt: new Date(expiry).toISOString(),
    protocolVersion: PORTICO_RECEIVER_PROTOCOL_VERSION,
    authorization,
  };
}

export function receiverAdvertisementTXT(advertisement: NearbyReceiverAdvertisement): Record<string, string> {
  if (advertisement.protocolVersion !== PORTICO_RECEIVER_PROTOCOL_VERSION) throw new Error('Unsupported receiver advertisement protocol.');
  const expiry = Date.parse(advertisement.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 24 * 60 * 60_000) {
    throw new Error('Receiver advertisement must expire within 24 hours.');
  }
  return {
    txtversion: String(advertisement.protocolVersion),
    receiverid: requiredIdentifier(advertisement.receiverId, 'receiver ID'),
    serverid: requiredIdentifier(advertisement.serverId, 'server ID'),
    keyfingerprint: requiredIdentifier(advertisement.receiverPublicKeyFingerprint, 'receiver key fingerprint'),
    name: requiredIdentifier(advertisement.deviceName, 'device name'),
    platform: requiredIdentifier(advertisement.platform, 'platform'),
    appversion: requiredIdentifier(advertisement.appVersion, 'app version'),
    capabilities: [...new Set(advertisement.capabilities)].sort().join(','),
    expiresat: new Date(expiry).toISOString(),
  };
}

function validateControllerGrant(identity: ReceiverControllerIdentity, grant: ReceiverControllerGrant, now = new Date()) {
  requiredIdentifier(identity.controllerId, 'controller ID');
  requiredIdentifier(grant.authorizationId, 'authorization ID');
  requiredIdentifier(grant.receiverId, 'receiver ID');
  if (receiverPublicKeyFingerprint(grant.receiverPublicKey) !== grant.receiverPublicKeyFingerprint) throw new Error('Receiver public key fingerprint did not match its authorization.');
  const expiry = Date.parse(grant.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) throw new Error('Receiver authorization has expired or is invalid.');
}

function validateAuthorizationRecord(authorization: ReceiverAuthorizationRecord, now = new Date()) {
  requiredIdentifier(authorization.authorizationId, 'authorization ID');
  requiredIdentifier(authorization.receiverId, 'receiver ID');
  requiredIdentifier(authorization.controllerId, 'controller ID');
  const expiry = Date.parse(authorization.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= now.getTime()) throw new Error('Receiver authorization has expired or is invalid.');
}

function validateReceiverCommand(command: ReceiverCommand, allowed: readonly PorticoReceiverCommandAction[], now = new Date()) {
  if (!allowed.includes(command.action)) throw new Error('Receiver command is outside this authorization.');
  requiredIdentifier(command.playbackSessionId, 'playback session ID');
  if (command.action === 'seek' && (!Number.isFinite(command.positionSeconds) || command.positionSeconds! < 0)) throw new Error('Receiver seek position is invalid.');
  if (command.action !== 'load') return;
  if (!isCleanHttpsMediaSource(command.sourceURL) || !command.mediaAuthorization.startsWith('PorticoMedia ') || command.mediaAuthorization.length <= 'PorticoMedia '.length) throw new Error('Receiver load requires a clean HTTPS URL and scoped media authorization.');
  const grantExpiry = Date.parse(command.mediaGrantExpiresAt);
  if (!Number.isFinite(grantExpiry) || grantExpiry <= now.getTime()) throw new Error('Receiver load media grant has expired.');
  if (!command.title.trim()) throw new Error('Receiver load title is required.');
}

function isCleanHttpsMediaSource(value: string): boolean {
  if (!/^https:\/\//i.test(value)) return false;
  const query = value.split('#', 1)[0]?.split('?', 2)[1] ?? '';
  const parameters = query.split('&').filter(Boolean).map(entry => {
    const [rawKey, rawValue = ''] = entry.split('=', 2);
    try { return [decodeURIComponent(rawKey ?? ''), decodeURIComponent(rawValue)] as const; }
    catch { return ['', ''] as const; }
  });
  return !parameters.some(([key]) => key === 'media_grant' || key === 'download_grant' || key === 'access_token');
}

function receiverSharedKey(privateKey: Uint8Array, peerPublicKey: string, authorizationId: string, receiverId: string): Uint8Array {
  const shared = x25519.getSharedSecret(privateKey, decodeBase64URL(peerPublicKey));
  const salt = sha256(textBytes(`portico-receiver-v1\0${authorizationId}\0${receiverId}`));
  return hkdf(sha256, shared, salt, textBytes('Portico Receiver Commands v1'), 32);
}

function commandAAD(authorizationId: string, receiverId: string, controllerId: string, sequence: number): string {
  return `${PORTICO_RECEIVER_PROTOCOL_VERSION}\0${authorizationId}\0${receiverId}\0${controllerId}\0${sequence}`;
}

function parseCapabilities(value: unknown): PorticoReceiverCommandAction[] {
  const allowed: PorticoReceiverCommandAction[] = ['load', 'play', 'pause', 'seek', 'stop'];
  return [...new Set(text(value).split(',').map(entry => entry.trim()).filter((entry): entry is PorticoReceiverCommandAction => allowed.includes(entry as PorticoReceiverCommandAction)))];
}

function normalizeServiceType(value: unknown): string {
  return text(value).toLowerCase().replace(/\.local\.?$/, '').replace(/\.$/, '');
}

function requiredIdentifier(value: string, label: string): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > 256 || /[\0\r\n]/.test(normalized)) throw new Error(`Receiver ${label} is invalid.`);
  return normalized;
}

function randomId(prefix: string): string { return `${prefix}_${encodeBase64URL(randomBytes(18))}`; }
function randomBytes(length: number): Uint8Array { return secureRandomBytes(length); }
function encodeBase64URL(value: Uint8Array): string { return fromByteArray(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function decodeBase64URL(value: string): Uint8Array { const normalized = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='); return toByteArray(normalized); }
function textBytes(value: string): Uint8Array { return Uint8Array.from(unescape(encodeURIComponent(value)), character => character.charCodeAt(0)); }
function decodeText(value: Uint8Array): string { return decodeURIComponent([...value].map(byte => `%${byte.toString(16).padStart(2, '0')}`).join('')); }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
