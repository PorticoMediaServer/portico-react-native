import React, {useEffect, useState} from 'react';
import {HomeSkeleton, StateView} from '../kit/states';
import {presentError} from '../../../../packages/client-core/src/presentation/errors';
import {createNativeShellBindings} from './assembly';
import {restoreNativeShellRuntime, type RestoredNativeShellRuntime} from './bootstrap';
import {NativeShell} from './NativeShell';

type RestoreState = Readonly<{phase: 'loading' | 'ready' | 'ended'; runtime?: RestoredNativeShellRuntime; error?: unknown}>;

/** Default product entry restores the existing genuine native credential; it invents no sign-in. */
export function RestoredShell() {
  const [attempt, setAttempt] = useState(0), [state, setState] = useState<RestoreState>({phase: 'loading'}), [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); let owned: RestoredNativeShellRuntime | undefined;
    const started = Date.now(); setElapsed(0); setState({phase: 'loading'});
    const clock = setInterval(() => setElapsed(Date.now() - started), 120);
    void restoreNativeShellRuntime(createNativeShellBindings, {signal: abort.signal, onAuthorityEnded: () => {
      if (!abort.signal.aborted) setState({phase: 'ended'});
    }}).then(runtime => {
      clearInterval(clock);
      if (abort.signal.aborted) {runtime?.dispose(); return;}
      owned = runtime; setState({phase: runtime ? 'ready' : 'ended', runtime});
    }, error => {clearInterval(clock); if (!abort.signal.aborted) setState({phase: 'ended', error});});
    return () => {abort.abort(); clearInterval(clock); owned?.dispose();};
  }, [attempt]);
  if (state.runtime && state.phase === 'ready') return <NativeShell runtime={state.runtime}/>;
  if (state.phase === 'loading') return <HomeSkeleton elapsedMs={elapsed} visible/>;
  if (state.error) {
    const error = presentError(state.error, 'home');
    return <StateView variant="centered" title={error.title} body={error.body} tone="error"
      primaryAction={error.action === 'try-again' || error.action === 'refresh' ? {id: 'restore', label: error.actionLabel, onPress: () => setAttempt(value => value + 1)} : undefined}/>;
  }
  // The sign-in phase registers its genuine entry separately. The foundation creates no auth UI.
  return null;
}
