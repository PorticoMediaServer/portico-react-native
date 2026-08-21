import {NativeEventEmitter, NativeModules, Platform} from 'react-native';
import {
  ReceiverCommandProcessor,
  sealReceiverCommand,
  type NearbyAuthorizedReceiver,
  type NearbyReceiverAdvertisement,
  type ReceiverAuthorizationRecord,
  type ReceiverCommand,
  type ReceiverCommandPayload,
  type ReceiverControllerIdentity,
  type SealedReceiverCommand,
} from './playbackReceiver';
import {advertiseNearbyPlaybackReceiver} from './nearbyDevices';

export type PlaybackReceiverReply = {
  commandId: string;
  ok: boolean;
  playbackSessionId?: string;
  positionSeconds?: number;
  state?: 'idle' | 'loading' | 'playing' | 'paused' | 'stopped' | 'error';
  error?: 'authorization-rejected' | 'command-rejected' | 'receiver-unavailable';
};

type NativeReceiverEvent = {connectionId?: unknown; sealed?: unknown};
type NativeReceiverModule = {
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  replyToPlaybackReceiver(connectionId: string, reply: PlaybackReceiverReply): Promise<void>;
  sendPlaybackReceiverCommand(hostName: string, port: number, sealed: SealedReceiverCommand): Promise<PlaybackReceiverReply>;
  startPlaybackReceiver(): Promise<{port: number}>;
  stopPlaybackReceiver(): Promise<void>;
};

const receiverModule = NativeModules.PorticoNearbyDevices as NativeReceiverModule | undefined;
const receiverEvent = 'PorticoPlaybackReceiverCommand';

export async function sendNearbyPlaybackCommand(
  receiver: NearbyAuthorizedReceiver,
  identity: ReceiverControllerIdentity,
  command: ReceiverCommand,
  sequence: number,
): Promise<PlaybackReceiverReply> {
  if (!receiverModule) throw new Error('Nearby playback receiver transport is unavailable.');
  const sealed = sealReceiverCommand(identity, receiver.authorization, command, sequence);
  return receiverModule.sendPlaybackReceiverCommand(receiver.hostName, receiver.port, sealed);
}

export async function startNearbyPlaybackReceiver(options: {
  advertisement: NearbyReceiverAdvertisement;
  authorizations: readonly ReceiverAuthorizationRecord[];
  receiverPrivateKey: Uint8Array;
  dispatch(payload: ReceiverCommandPayload): Promise<Omit<PlaybackReceiverReply, 'commandId'>>;
}): Promise<{replaceAuthorizations(values: readonly ReceiverAuthorizationRecord[]): void; stop(): Promise<void>}> {
  if (!receiverModule || Platform.OS !== 'ios' || !Platform.isTV) throw new Error('Nearby playback receiver requires the native tvOS transport.');
  const processor = new ReceiverCommandProcessor(options.receiverPrivateKey, options.authorizations);
  const {port} = await receiverModule.startPlaybackReceiver();
  const stopAdvertising = advertiseNearbyPlaybackReceiver(options.advertisement, port);
  const subscription = new NativeEventEmitter(receiverModule).addListener(receiverEvent, (event: NativeReceiverEvent) => {
    const connectionId = typeof event.connectionId === 'string' ? event.connectionId : '';
    if (!connectionId || !isRecord(event.sealed)) return;
    let payload: ReceiverCommandPayload;
    try {
      payload = processor.open(event.sealed as unknown as SealedReceiverCommand);
    } catch {
      void receiverModule.replyToPlaybackReceiver(connectionId, {commandId: '', ok: false, error: 'authorization-rejected'});
      return;
    }
    void options.dispatch(payload)
      .then(reply => receiverModule.replyToPlaybackReceiver(connectionId, {commandId: payload.commandId, ...reply}))
      .catch(() => receiverModule.replyToPlaybackReceiver(connectionId, {commandId: payload.commandId, ok: false, error: 'command-rejected'}));
  });
  return {
    replaceAuthorizations: values => processor.replaceAuthorizations(values),
    stop: async () => {
      subscription.remove();
      stopAdvertising();
      await receiverModule.stopPlaybackReceiver();
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
