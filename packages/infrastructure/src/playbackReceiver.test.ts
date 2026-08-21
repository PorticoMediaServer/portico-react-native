import {x25519} from '@noble/curves/ed25519.js';
import {fromByteArray} from 'base64-js';
import {
  openReceiverCommand,
  ReceiverCommandProcessor,
  parseAuthorizedNearbyReceiver,
  receiverAdvertisementTXT,
  receiverPublicKeyFingerprint,
  sealReceiverCommand,
  type ReceiverAuthorizationRecord,
  type ReceiverControllerGrant,
} from './playbackReceiver';

const now = new Date('2026-07-14T12:00:00.000Z');
const controllerPrivateKey = Uint8Array.from({length: 32}, (_, index) => index + 1);
const receiverPrivateKey = Uint8Array.from({length: 32}, (_, index) => index + 101);
const controllerPublicKey = base64URL(x25519.getPublicKey(controllerPrivateKey));
const receiverPublicKey = base64URL(x25519.getPublicKey(receiverPrivateKey));
const identity = {controllerId: 'controller-1', privateKey: controllerPrivateKey, publicKey: controllerPublicKey};
const grant: ReceiverControllerGrant = {
  authorizationId: 'authorization-1',
  receiverId: 'receiver-1',
  serverId: 'server-1',
  receiverPublicKey,
  receiverPublicKeyFingerprint: receiverPublicKeyFingerprint(receiverPublicKey),
  allowedCommands: ['load', 'play', 'pause', 'seek', 'stop'],
  expiresAt: '2026-07-14T13:00:00.000Z',
};
const authorization: ReceiverAuthorizationRecord = {
  authorizationId: grant.authorizationId,
  receiverId: grant.receiverId,
  serverId: grant.serverId,
  controllerId: 'controller-1',
  controllerPublicKey,
  allowedCommands: grant.allowedCommands,
  expiresAt: grant.expiresAt,
};

test('encrypts, authenticates, and opens a scoped receiver command', () => {
  const sealed = sealReceiverCommand(
    {controllerId: authorization.controllerId, privateKey: controllerPrivateKey, publicKey: controllerPublicKey},
    grant,
    {
      action: 'load',
      playbackSessionId: 'playback-1',
      sourceURL: 'https://server.example/stream.m3u8',
      mediaAuthorization: 'PorticoMedia scoped',
      mediaGrantExpiresAt: '2026-07-14T12:05:00.000Z',
      title: 'The Castle',
    },
    1,
    {commandId: 'command-1', now},
  );

  expect(openReceiverCommand(receiverPrivateKey, authorization, sealed, {now})).toMatchObject({
    commandId: 'command-1',
    sequence: 1,
    command: {action: 'load', playbackSessionId: 'playback-1'},
  });
  expect(() => openReceiverCommand(receiverPrivateKey, authorization, sealed, {lastSequence: 1, now})).toThrow('replayed');
});

test('receiver processor applies revocation and bounded replay state', () => {
  const processor = new ReceiverCommandProcessor(receiverPrivateKey, [authorization]);
  const first = sealReceiverCommand(identity, grant, {action: 'play', playbackSessionId: 'playback-1'}, 1, {commandId: 'command-1', now});
  expect(processor.open(first, now).commandId).toBe('command-1');
  expect(() => processor.open(first, now)).toThrow('replayed');
  processor.replaceAuthorizations([]);
  const second = sealReceiverCommand(identity, grant, {action: 'pause', playbackSessionId: 'playback-1'}, 2, {commandId: 'command-2', now});
  expect(() => processor.open(second, now)).toThrow('revoked');
});

test('rejects raw credentials and tampered receiver commands', () => {
  expect(() => sealReceiverCommand(
    {controllerId: authorization.controllerId, privateKey: controllerPrivateKey, publicKey: controllerPublicKey},
    grant,
    {
      action: 'load',
      playbackSessionId: 'playback-1',
      sourceURL: 'https://server.example/stream?media_grant=scoped&access_token=account',
      mediaAuthorization: 'PorticoMedia scoped',
      mediaGrantExpiresAt: '2026-07-14T12:05:00.000Z',
      title: 'The Castle',
    },
    1,
    {now},
  )).toThrow('scoped media authorization');

  const sealed = sealReceiverCommand(
    {controllerId: authorization.controllerId, privateKey: controllerPrivateKey, publicKey: controllerPublicKey},
    grant,
    {action: 'pause', playbackSessionId: 'playback-1'},
    2,
    {now},
  );
  expect(() => openReceiverCommand(receiverPrivateKey, authorization, {...sealed, receiverId: 'receiver-2'}, {now})).toThrow('does not match');
});

test('only returns locally discovered receivers with an exact unexpired authorization', () => {
  const event = {
    action: 'found',
    instanceName: 'Portico Den',
    serviceType: '_portico-receiver._tcp.local.',
    hostName: 'portico-den.local.',
    port: 44991,
    txt: {
      txtversion: '1',
      receiverid: grant.receiverId,
      serverid: grant.serverId,
      keyfingerprint: grant.receiverPublicKeyFingerprint,
      name: 'Portico Den',
      platform: 'tvOS',
      appversion: '1.0',
      capabilities: 'load,play,pause,seek,stop',
      expiresat: '2026-07-14T12:10:00.000Z',
    },
  };
  expect(parseAuthorizedNearbyReceiver(event, [grant], now)).toMatchObject({receiverId: grant.receiverId, deviceName: 'Portico Den'});
  expect(parseAuthorizedNearbyReceiver(event, [], now)).toBeUndefined();
  expect(parseAuthorizedNearbyReceiver({...event, txt: {...event.txt, keyfingerprint: 'other'}}, [grant], now)).toBeUndefined();
});

test('rejects malformed authorization expiry and receiver advertisements that outlive discovery trust', () => {
  expect(() => sealReceiverCommand(
    {controllerId: authorization.controllerId, privateKey: controllerPrivateKey, publicKey: controllerPublicKey},
    {...grant, expiresAt: 'not-a-date'},
    {action: 'pause', playbackSessionId: 'playback-1'},
    3,
    {now},
  )).toThrow('expired or is invalid');

  jest.useFakeTimers().setSystemTime(now);
  try {
    expect(() => receiverAdvertisementTXT({
      receiverId: grant.receiverId,
      serverId: grant.serverId,
      receiverPublicKeyFingerprint: grant.receiverPublicKeyFingerprint,
      deviceName: 'Portico Den',
      platform: 'tvOS',
      appVersion: '1.0',
      capabilities: grant.allowedCommands,
      expiresAt: '2026-07-16T12:00:00.000Z',
      protocolVersion: 1,
    })).toThrow('within 24 hours');
  } finally {
    jest.useRealTimers();
  }
});

function base64URL(value: Uint8Array): string {
  return fromByteArray(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
