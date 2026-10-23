import type {NativePlaybackStart} from '../../platform/playback/types';

/** A row/card owner supplies actual navigation and membership checks. Playback
 * output changes are deliberately not an input to this creation lifetime. */
export function nativeHomeEntryLifetime(current: () => boolean,
  subscriptions: readonly ((listener: () => void) => () => void)[], parent: AbortSignal) {
  const abort = new AbortController(), off: (() => void)[] = [];
  const stop = () => abort.abort();
  const isCurrent = () => !abort.signal.aborted && !parent.aborted && current();
  const check = () => {if (!isCurrent()) stop();};
  parent.addEventListener('abort', stop, {once: true});
  for (const subscribe of subscriptions) off.push(subscribe(check));
  check();
  const lifetime: NonNullable<NativePlaybackStart['lifetime']> = {signal: abort.signal, isCurrent};
  return {lifetime, dispose: () => {
    parent.removeEventListener('abort', stop); for (const unsubscribe of off.splice(0)) unsubscribe();
  }};
}
