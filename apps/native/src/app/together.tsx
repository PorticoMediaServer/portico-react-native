import React, {createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {GroupFollower, GroupSessionService, type GroupPlayer, type GroupSessionSnapshot} from '../../../../packages/client-core/src/index';
import {openEventStream} from '../bridge/event-stream';
import type {PlayerEngine} from '../player/usePlayer';
import {useSession} from './session';

const Ctx = createContext<GroupSessionService | null>(null);

/** Watch Together for the signed-in viewer. One service for the whole app, so a room survives
 * moving between screens; while in a room the player follows the group's clock, and play,
 * pause and seeking become the group's for anyone allowed to control it. */
export function TogetherProvider({engine, children}: {engine: PlayerEngine; children: React.ReactNode}) {
  const {api, session} = useSession();
  const token = useRef('');
  token.current = session?.accessToken ?? '';
  const live = useRef(engine);
  live.current = engine;
  const viewerKey = session ? `${session.viewer.serverId}/${session.viewer.accountId}/${session.viewer.profileId}` : '';
  const service = useMemo(() => (viewerKey && api ? new GroupSessionService({
    api,
    stream: (path, lastEventId, signal) => openEventStream(api.baseUrl + path, {Accept: 'text/event-stream', Authorization: 'Bearer ' + token.current, ...(lastEventId ? {'Last-Event-ID': lastEventId} : {})}, signal),
    key: () => 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2),
  }) : null), [api, viewerKey]);
  useEffect(() => () => service?.dispose(), [service]);
  const phase = useSyncExternalStore(service?.subscribe ?? noSubscribe, () => service?.getSnapshot().phase ?? 'idle');
  const inRoom = phase === 'live' || phase === 'reconnecting';
  useEffect(() => {
    if (!service || !inRoom || !api) return;
    const player: GroupPlayer = {
      state: () => {
        const s = live.current.state;
        return {itemId: s.itemId ?? '', positionSeconds: s.pendingSeek?.positionSeconds ?? s.positionSeconds, playing: s.phase === 'ready' && s.intent === 'playing', buffering: !!s.recovering || s.phase === 'starting', ready: s.phase === 'ready'};
      },
      load: (itemId, positionSeconds) => {
        live.current.play(itemId, positionSeconds);
        // The group only supplies an id; the title and artwork come from this viewer's library.
        void api.item(itemId).then(item => { if (live.current.state.itemId === itemId) live.current.describe({itemId, title: item.title, posterUrl: item.posterUrl, backdropUrl: item.backdropUrl, kind: item.kind, libraryId: item.libraryId}); }, () => {});
      },
      // Straight to the player: through the engine, a correction would go back out as a command.
      play: () => live.current.service.resume(),
      pause: () => live.current.service.pause(),
      seek: seconds => live.current.service.seek(seconds),
      // The native player has no private speed nudge; a small drift is closed by a seek instead.
      setRate: () => {},
    };
    const follower = new GroupFollower(service, player);
    follower.start();
    const mine = () => { const group = service.getSnapshot().group; return group?.timeline.itemId && group.timeline.itemId === live.current.state.itemId ? group : undefined; };
    live.current.setGroupControl({
      toggle: playing => {
        const group = mine(); if (!group) return false;
        if (group.permissions.canControl) void service.transport(playing ? 'pause' : 'play');
        else service.notice('Only the host can play and pause for the group.');
        return true;
      },
      seek: seconds => {
        const group = mine(); if (!group) return false;
        if (group.permissions.canControl) void service.transport('seek', {positionUs: String(Math.round(seconds * 1e6))});
        else service.notice('Only the host can move the group to another moment.');
        return true;
      },
    });
    return () => { follower.stop(); live.current.setGroupControl(null); };
  }, [service, inRoom, api]);
  return <Ctx.Provider value={service}>{children}</Ctx.Provider>;
}

const idle: GroupSessionSnapshot = Object.freeze<GroupSessionSnapshot>({directory: [], directoryPhase: 'idle', phase: 'idle', busy: false, clockOffsetMs: 0});
const noSubscribe = () => () => {};
export function useTogether(): {service: GroupSessionService | null; state: GroupSessionSnapshot} {
  const service = useContext(Ctx);
  const state = useSyncExternalStore(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? (() => idle));
  return {service, state};
}
export function useInRoom(): boolean {
  const service = useContext(Ctx);
  return useSyncExternalStore(service?.subscribe ?? noSubscribe, () => { const p = service?.getSnapshot().phase; return p === 'live' || p === 'reconnecting'; });
}
/** What a title's menu needs: whether there is a room, and whether this viewer may add to it. */
export function useGroupActions(): {service: GroupSessionService | null; inRoom: boolean; canQueue: boolean} {
  const service = useContext(Ctx);
  const inRoom = useInRoom();
  const canQueue = useSyncExternalStore(service?.subscribe ?? noSubscribe, () => !!service?.getSnapshot().group?.permissions.canManageQueue);
  return {service, inRoom, canQueue};
}
