import {NativeListeningV1Adapter} from './NativeListeningAdapter';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { AppState, NativeModules, NativeEventEmitter } from 'react-native';
import {
  PlaybackService,
  type HttpLocalApi,
  type LocalSession,
} from '../../../../packages/client-core/src/index';
import {localV1Http} from '../../../../packages/client-core/src/playback-v1/local-http';
import {NativePlayback} from '../player/native-playback';
import {V1QueuePlayer, serverSupportsQueueTransitions} from '../../../../packages/client-core/src/playback-v1/v1-queue-player';
import {EventsClient} from '../../../../packages/client-core/src/playback-v1/events';
import {eventStreamOpener,runEventFeed} from '../../../../packages/client-core/src/event-feed';
import {openEventStream} from './event-stream';
import {useServerPreferences} from '../app/server-preferences';
import {musicQueueDefaults} from '../../../../packages/client-core/src/music-preferences';
import {V1ChannelControl} from '../../../../packages/client-core/src/playback-v1/channel-control';
import {getDeviceEvents, setDeviceEvents} from '../app/device-events';
import {PlaybackQueue, forwardSessionEnds, playbackFeedBusy} from './playback-paths';
import {NativeQueueStore} from './queue-storage';
import {V1QueueMemory, restoreV1Queue} from './v1-queue-memory';
import {LocalPlayback, type LocalMedia} from './local-playback';
import {offlineDownloads} from './offline-downloads';
import {keepCapabilitiesPublished} from './capability-publisher';
import {nativeListeningFor, serverPlaybackV1Kinds} from './native-listening-kinds';
import {engineSettingStore} from '../player/engine-setting-store';

/**
 * The player's playback stack (Playback Protocol v1): one `PlaybackService` per viewer, the
 * session path behind it (`NativePlayback`: the server session's timeline, re-plans and end), its
 * v1 queue player, channels as v1 sessions (spec §18.6), this device's event feed, and the native
 * listening owner for audio (plan §9.3 C3). Downloaded titles play in the same service with a
 * session that never leaves the device (OS-07).
 */
export function useNativePlayback(
  api: HttpLocalApi,
  session: LocalSession | undefined,
) {
  const sessionRef=useRef(session);sessionRef.current=session;
  // The viewer's music defaults (shuffle, repeat) for a music queue started with Play.
  const preferences=useServerPreferences().snapshot;const preferencesRef=useRef(preferences);preferencesRef.current=preferences;
  // Hermes has no crypto.randomUUID, so request keys come from the native UUID source.
  const path = useMemo(() => new NativePlayback({http: localV1Http(api), key: () => NativeModules.PorticoRuntime.playbackRequestId()}), [api]);
  useEffect(() => () => path.dispose(), [path]);
  const v1Api = path.transport;
  // OS-07: downloaded titles' progress goes to the offline journal (resume point, later sync).
  const local = useMemo(() => new LocalPlayback(progress => offlineDownloads.recordProgress(progress)), []);
  const playback = useMemo(
    () => {
      const key=session?`${api.baseUrl}|${session.viewer.serverId}|${session.viewer.authority}|${session.viewer.accountId}|${session.viewer.profileId}`:'';
      return new PlaybackService(
        local.wrap(v1Api),
        () => NativeModules.PorticoRuntime.playbackRequestId(),
        session
          ? {
              deferRecovery: true,
              queueRequired: true,
              diagnostics: __DEV__,
              // A player chosen inside the player was for the playback before: the server plans
              // the new one from the Settings' player again.
              beforeFreshPlayback: () => {
                if (!engineSettingStore.hasSession()) return Promise.resolve();
                engineSettingStore.setSession(null);
                return engineSettingStore.whenCurrentSettled(4000);
              },
              channels: new V1ChannelControl({http: localV1Http(api), key: () => NativeModules.PorticoRuntime.playbackRequestId()}),
              journal: {
                load: async () => JSON.parse(await NativeModules.PorticoRuntime.loadJournal(key)),
                save: async entries => { await NativeModules.PorticoRuntime.saveJournal(key, JSON.stringify(entries)); },
              },
            }
          : { deferRecovery: true },
      );
    },
    // The service follows the viewer, not each renewal of `session` (its token is read through sessionRef).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      api,
      v1Api,
      local,
      session?.viewer.serverId,
      session?.viewer.authority,
      session?.viewer.accountId,
      session?.viewer.profileId,
    ],
  );
  useEffect(()=>{if(session?.accessToken)void playback.refreshPlaybackAuthority().catch(()=>{});},[playback,session?.accessToken]);
  useEffect(()=>{const listener=AppState.addEventListener('change',state=>{if(state==='active')void playback.refreshPlaybackAuthority().catch(()=>{});});return()=>listener.remove();},[playback]);
  // Leaving the screen: the server is told where the picture is now, while this app can still say so.
  useEffect(()=>{const listener=AppState.addEventListener('change',state=>{if(state!=='active')void path.controller.flush().catch(()=>{});});return()=>listener.remove();},[path]);
  useEffect(() => {
    void playback.startRecovery();
    return()=>playback.leave();
  }, [playback]);
  const queue=useRef<PlaybackQueue|undefined>(undefined);
  const v1Player=useRef<V1QueuePlayer|undefined>(undefined);
  // The session path follows the service; a lapsed lease is given back to the installed queue player.
  useEffect(()=>path.bind(playback,()=>{const player=v1Player.current;return player&&queue.current?.controller===player?player:undefined;}),[path,playback]);
  /** The installed v1 queue player (container plays call its `playSelector`). */
  const v1Queue=useCallback(():V1QueuePlayer|undefined=>{const player=v1Player.current;return player&&queue.current?.controller===player?player:undefined;},[]);
  /** Before a play from the server: the v1 queue player is installed (after a download played, it isn't). */
  const ensureQueue=useCallback(()=>{queue.current?.ensure();},[]);
  /** OS-07: play a downloaded file (from `offlineDownloads.localMedia`): no queue, no server session. */
  const playLocal=useCallback((media:LocalMedia):Promise<void>=>{
    const made=local.session(media);
    queue.current?.goLocal();
    return playback.playLocal(media.itemId,made,media.startSeconds);
  },[local,playback]);
  useEffect(()=>{
    if(!session||!['local','hosted'].includes(session.viewer.authority))return;
    let live=true;
    const viewer=session.viewer;
    let supportsTransitions=false,serverKinds:readonly string[]=[];
    const capabilities=keepCapabilitiesPublished(localV1Http(api),api.getRouteConnection());
    // The native transport ends every request at 15 seconds, and a failed request makes the route
    // re-verify (which reloads a playing stream): a quiet long-poll has to return before that.
    // The device's one feed: the native stream reader where it can be opened, the long poll otherwise.
    // It runs while the app is in front or something is playing, is stopped a little after neither
    // is true, and resumes from the last event it saw.
    const events=new EventsClient({http:localV1Http(api),waitMs:10000,openStream:eventStreamOpener((headers,signal)=>openEventStream(api,'/v1/events',{...headers,Authorization:'Bearer '+(sessionRef.current?.accessToken??'')},signal))});
    const stopFeed=runEventFeed(events,undefined,{
      visible:()=>AppState.currentState==='active',
      onVisibility:listener=>{const subscription=AppState.addEventListener('change',listener);return()=>subscription.remove();},
      busy:()=>playbackFeedBusy(playback.getSnapshot()),
      onBusy:listener=>playback.subscribe(listener),
    });
    setDeviceEvents(events);
    // A session the server ended (the owner stopped it from Now Playing) stops at once, with its reason.
    const stopForwarding=forwardSessionEnds(events,v1Api);
    const queueMemory=new V1QueueMemory(new NativeQueueStore(),viewer);
    // C3: v1 music and audiobooks play under the native listening owner, which keeps the timeline,
    // the lease and the queue edges going while JS sleeps (plan §9.3).
    const nativeV1=new NativeListeningV1Adapter({
     bridge:NativeModules.PorticoPlaybackModule,route:api.getRouteConnection(),
     principal:{origin:api.baseUrl,serverId:viewer.serverId,authority:viewer.authority as 'local'|'hosted',accountId:viewer.accountId,profileId:viewer.profileId},
     bearer:()=>sessionRef.current?.accessToken??'',id:()=>NativeModules.PorticoRuntime.playbackRequestId(),
     subscribe:sink=>{const subscription=new NativeEventEmitter(NativeModules.PorticoPlaybackModule).addListener('PorticoListeningSnapshot',sink);return()=>subscription.remove();},
    });
    const makePlayer=():V1QueuePlayer=>{
      const player=new V1QueuePlayer({musicDefaults:()=>preferencesRef.current?musicQueueDefaults(preferencesRef.current):undefined,http:localV1Http(api),api:v1Api,playback,viewer:{serverId:viewer.serverId,authority:viewer.authority as 'local'|'hosted',accountId:viewer.accountId,profileId:viewer.profileId},key:()=>NativeModules.PorticoRuntime.playbackRequestId(),events,
        // Read when used: a queue made before /v1/capabilities answered follows the answer once it arrives.
        transitions:()=>supportsTransitions,native:nativeV1,nativeFor:kind=>nativeListeningFor(serverKinds)(kind)});
      player.setCompletionPolicy(()=>'hold');v1Player.current=player;
      // Remember the device's current v1 queue for the next launch (written only when it changes).
      player.subscribe(()=>{const id=player.getSnapshot().view?.queue.id;if(id)void queueMemory.save(id).catch(()=>{});});
      return player;
    };
    const holder=new PlaybackQueue(makePlayer);
    queue.current=holder;
    void api.request<unknown>('/v1/capabilities','GET').then(async doc=>{
      if(!live)return;supportsTransitions=serverSupportsQueueTransitions(doc);serverKinds=serverPlaybackV1Kinds(doc);
      // The server plans music by this device's profile (spec §3: audioDecode): send it before the
      // first play, or its music would come back unavailable (no gapless) until the next change.
      await Promise.race([capabilities.ready,new Promise(r=>setTimeout(r,3000))]);
      if(!live||holder.controller||playback.getSnapshot().itemId)return;
      // Relaunch: show the saved v1 queue (Up Next, where the person left off) without playing it.
      // It is opened first and installed only once it's there; a 404 forgets it quietly.
      void restoreV1Queue(queueMemory,async queueId=>{
        const player=makePlayer();
        try{await player.open(queueId);}catch(e){player.dispose();throw e;}
        if(!live||holder.controller||playback.getSnapshot().itemId){player.dispose();return;}
        holder.install(player);
      });
    },()=>{});
    return()=>{capabilities.stop();
      // Signing out, or another profile or server: this viewer's cached audio goes (INT T9).
      void NativeModules.PorticoPlaybackModule?.purgeAudioCache?.().catch(()=>{});
      holder.dispose();if(queue.current===holder)queue.current=undefined;stopForwarding();stopFeed();if(getDeviceEvents()===events)setDeviceEvents(null);playback.leave(false);live=false;};
  // The queue follows the viewer, not each renewal of `session` (its token is read through sessionRef).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[api,v1Api,playback,session?.viewer.serverId,session?.viewer.authority,session?.viewer.accountId,session?.viewer.profileId]);
  const playbackState = useSyncExternalStore(
    playback.subscribe,
    playback.getSnapshot,
  );
  return { playback, playbackState, ensureQueue, v1Queue, playLocal, path };
}
