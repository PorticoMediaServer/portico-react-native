import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import type {PlaybackFence} from '../../../../packages/player-core/src';
import type {NativePlaybackReadLifetime} from '../platform/playback/types';
import type {NativeListeningSong, NativeListeningSongDetail} from './listening-song-detail';

/** The current song's issued detail token, read under one listening opening and fence.
 * Nothing here defaults a favorite, and nothing acts on a token from another page. */
export type NativeListeningSongState = Readonly<{
  song?: NativeListeningSong;
  pending: boolean;
  favorite: (token: NativeListeningSong, value: boolean) => void;
}>;

type Opening = Readonly<{
  port: NativeListeningSongDetail;
  fence: PlaybackFence;
  lifetime: NativePlaybackReadLifetime;
  /** The original opening's own route/fence proof, captured when this opening committed. */
  live: () => boolean;
}>;

/** Read the exact queue song's detail while the original opening and fence are still current.
 * The opening is immutable and committed in the layout phase. Every read, dispatch and
 * settlement is checked against that exact opening and its ticket, never against a later one. */
export function useListeningSong(detail: NativeListeningSongDetail | undefined, fence: PlaybackFence | undefined,
  lifetime: NativePlaybackReadLifetime | undefined, current: () => boolean): NativeListeningSongState {
  const [state, setState] = useState<Readonly<{opening?: Opening; song?: NativeListeningSong; pending: boolean}>>(() => ({pending: false}));
  const openingRef = useRef<Opening | undefined>(undefined), pendingRef = useRef<Opening | undefined>(undefined), ticket = useRef(0);
  const tokens = useRef(new WeakMap<object, Opening>()), mounted = useRef(true), currentRef = useRef(current);
  currentRef.current = current;
  const fenceKey = fence ? JSON.stringify(fence) : '';
  // Bounded eligibility for exactly this fence and lifetime. It changes when the accepted window
  // arrives or retires, not on progress ticks, and opens or closes the reading with it.
  const canRead = !!detail && !!fence && !!lifetime && detail.canRead(fence, lifetime);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {mounted.current = false; ticket.current++; openingRef.current = undefined; pendingRef.current = undefined;};
  }, []);
  useLayoutEffect(() => {
    // Retire the previous opening before publishing anything for this one; its state and its
    // pending ticket leave in the same layout pass, so an older token is never drawn under it.
    const at = ++ticket.current;
    openingRef.current = undefined; pendingRef.current = undefined;
    if (mounted.current) setState(() => ({pending: false}));
    if (!canRead || !detail || !fence || !lifetime) return;
    const owner = currentRef.current;
    const opening: Opening = Object.freeze({port: detail, fence, lifetime, live: () => lifetime.isCurrent() && owner()});
    openingRef.current = opening;
    void detail.read(fence, lifetime).then(song => {
      if (!mounted.current || openingRef.current !== opening || ticket.current !== at || !opening.live()) return;
      if (song) tokens.current.set(song, opening);
      setState({opening, ...(song ? {song} : {}), pending: false});
    }).catch(() => {});
    // Retiring is layout work: no state setter runs on unmount, only the refs leave.
    return () => {
      if (openingRef.current === opening) openingRef.current = undefined;
      if (pendingRef.current === opening) pendingRef.current = undefined;
    };
  }, [detail, fenceKey, lifetime, canRead]);
  const favorite = useCallback((song: NativeListeningSong, value: boolean) => {
    const opening = tokens.current.get(song);
    // The token itself names the opening that issued it: a retained press can never borrow
    // whatever opening is current now, and one command ticket runs at a time.
    if (!opening || openingRef.current !== opening || pendingRef.current || !opening.live()) return;
    pendingRef.current = opening;
    const at = ++ticket.current;
    if (mounted.current) setState(previous => previous.opening === opening ? {...previous, pending: true} : previous);
    void opening.port.favorite(song, value, opening.lifetime).then(accepted => {
      // Only this opening's own accepted answer may read again; a stale or refused command
      // never refreshes whatever opening happens to be current.
      if (!mounted.current || openingRef.current !== opening || ticket.current !== at || !opening.live()) return;
      if (accepted !== true) return;
      return opening.port.read(opening.fence, opening.lifetime).then(next => {
        if (!mounted.current || openingRef.current !== opening || ticket.current !== at || !opening.live()) return;
        if (next) tokens.current.set(next, opening);
        setState({opening, ...(next ? {song: next} : {}), pending: false});
      });
    }).catch(() => {}).finally(() => {
      if (!mounted.current || openingRef.current !== opening || ticket.current !== at) return;
      if (pendingRef.current === opening) pendingRef.current = undefined;
      // A vanished lifetime releases its own ticket and opening without publishing a UI state
      // for a page that is no longer the original opening.
      if (!opening.live()) {
        if (openingRef.current === opening) openingRef.current = undefined;
        return;
      }
      setState(previous => previous.opening === opening && previous.pending ? {...previous, pending: false} : previous);
    });
  }, []);
  return {...(canRead && state.opening && state.song ? {song: state.song} : {}), pending: canRead && state.opening ? state.pending : false, favorite};
}
