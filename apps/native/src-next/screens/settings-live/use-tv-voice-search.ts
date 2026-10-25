import {useCallback, useLayoutEffect, useRef, useState} from 'react';
import {NativeModules, Platform} from 'react-native';
import type {NativeScreenLifetime} from './lifetime';

type Ticket = {lifetime: NativeScreenLifetime; id: string; abort: AbortController; busy: boolean};
type Voice = {canTVVoiceSearch?: () => Promise<boolean>; startTVVoiceSearch?: (id: string) => Promise<string | null>; cancelTVVoiceSearch?: (id: string) => void; playbackRequestId?: () => string};
/** Only a rendered explicit action opens the system recognizer. Results never cross a layout lifetime. */
export function useTVVoiceSearch(enabled: boolean, lifetime: NativeScreenLifetime, accept: (text: string) => void, reportError: (error: unknown) => void) {
  const active = useRef<Ticket | undefined>(undefined), [ticket, setTicket] = useState<Ticket>(), [available, setAvailable] = useState(false), [busy, setBusy] = useState(false);
  const voice = NativeModules.PorticoRuntime as Voice | undefined;
  if (active.current && (!enabled || active.current.lifetime !== lifetime)) {const old = active.current; active.current = undefined; old.abort.abort(); voice?.cancelTVVoiceSearch?.(old.id);}
  useLayoutEffect(() => {
    setAvailable(false); setBusy(false);
    if (!enabled || Platform.OS !== 'android' || !Platform.isTV || !voice?.canTVVoiceSearch || !voice.startTVVoiceSearch || !voice.cancelTVVoiceSearch || !voice.playbackRequestId || !lifetime.current()) return;
    const held: Ticket = {lifetime, id: voice.playbackRequestId(), abort: new AbortController(), busy: false};
    active.current = held; setTicket(held);
    const cancel = () => {if (active.current === held) active.current = undefined; held.abort.abort(); voice.cancelTVVoiceSearch?.(held.id);};
    lifetime.signal.addEventListener('abort', cancel, {once: true});
    void voice.canTVVoiceSearch().then(value => {if (active.current === held && !held.abort.signal.aborted && lifetime.current()) setAvailable(value);}).catch(() => {});
    return () => {cancel(); lifetime.signal.removeEventListener('abort', cancel);};
  }, [enabled, lifetime, voice]);
  const start = useCallback(() => {
    const held = ticket;
    const current = () => !!held && active.current === held && !held.abort.signal.aborted && enabled && lifetime.current();
    if (!held || !current() || held.busy || !available || !voice?.startTVVoiceSearch) return;
    held.busy = true; setBusy(true);
    void voice.startTVVoiceSearch(held.id).then(text => {if (current() && typeof text === 'string' && text.length > 0 && text.length <= 256) accept(text);})
      .catch(error => {if (current()) reportError(error);}).finally(() => {held.busy = false; if (current()) setBusy(false);});
  }, [ticket, enabled, lifetime, available, voice, accept, reportError]);
  return {start: available ? start : undefined, busy};
}
