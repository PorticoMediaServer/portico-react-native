import {useCallback, useEffect, useRef, useState} from 'react';
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

/** Read the exact queue song's detail while the original opening and fence are still current.
 * A command is one ticket: it is sent with the issued token, then the sheet is read again only
 * when that same opening and fence are still current. */
export function useListeningSong(detail: NativeListeningSongDetail | undefined, fence: PlaybackFence | undefined,
  lifetime: NativePlaybackReadLifetime | undefined, current: () => boolean): NativeListeningSongState {
  const [state, setState] = useState<Readonly<{song?: NativeListeningSong; pending: boolean}>>(() => ({pending: false}));
  const sequence = useRef(0), pending = useRef(false), currentRef = useRef(current);
  const detailRef = useRef(detail), fenceRef = useRef(fence), lifetimeRef = useRef(lifetime);
  currentRef.current = current; detailRef.current = detail; fenceRef.current = fence; lifetimeRef.current = lifetime;
  const fenceKey = fence ? JSON.stringify(fence) : '';
  const live = useCallback(() => {
    const at = fenceRef.current, life = lifetimeRef.current;
    return !!detailRef.current && !!at && !!life && life.isCurrent() && currentRef.current();
  }, []);
  useEffect(() => {
    const ticket = ++sequence.current, port = detailRef.current, at = fenceRef.current, life = lifetimeRef.current;
    if (!port || !at || !life || !port.canRead(at, life)) {setState({pending: false}); return;}
    void port.read(at, life).then(song => {
      if (ticket !== sequence.current || !live()) return;
      setState(previous => ({...(song ? {song} : {}), pending: previous.pending}));
    }).catch(() => {});
    return () => {if (ticket === sequence.current) sequence.current++;};
  }, [detail, fenceKey, lifetime, live]);
  const favorite = useCallback((token: NativeListeningSong, value: boolean) => {
    const port = detailRef.current, at = fenceRef.current, life = lifetimeRef.current;
    if (!port || !at || !life || pending.current || !live()) return;
    pending.current = true;
    const ticket = ++sequence.current;
    setState(previous => ({...previous, pending: true}));
    void port.favorite(token, value, life).then(() => {
      // The answer is read again only for the same opening and fence that sent the command.
      if (ticket !== sequence.current || !live()) return;
      return port.read(at, life).then(song => {
        if (ticket !== sequence.current || !live()) return;
        setState({...(song ? {song} : {}), pending: false});
      });
    }).catch(() => {}).finally(() => {
      pending.current = false;
      setState(previous => previous.pending ? {...previous, pending: false} : previous);
    });
  }, [live]);
  return {...state, favorite};
}
