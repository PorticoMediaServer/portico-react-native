import React, {useEffect, useState} from 'react';
import {HomeSkeleton, StateView} from '../kit/states';
import {presentError} from '../../../../packages/client-core/src/presentation/errors';
import {createNativeShellBindings} from './assembly';
import {restoreNativeShellRuntime, type RestoredNativeShellRuntime} from './bootstrap';
import {NativeShell} from './NativeShell';
import {nativeAccounts} from '../platform/accounts';
import {readNativeSelectedViewer, subscribeNativeAppSessions} from '../platform/app-session-storage';
import {AccountEntry} from '../screens/accounts/AccountEntry';
import {ServersRoute} from '../screens/accounts/AccountRoutes';
import {defaultI18n} from '../../../../packages/i18n/src';

type RestoreState = Readonly<{phase: 'loading' | 'ready' | 'ended'; runtime?: RestoredNativeShellRuntime; error?: unknown}>;

/** Restore only the captured canonical server selection; current account entry owns sign-in. */
export function RestoredShell() {
  const [attempt, setAttempt] = useState(0), [state, setState] = useState<RestoreState>({phase: 'loading'}), [elapsed, setElapsed] = useState(0);
  const [showAccounts, setShowAccounts] = useState(false), [retained, setRetained] = useState(false);
  useEffect(() => {
    const abort = new AbortController(); let owned: RestoredNativeShellRuntime | undefined;
    let alive = true;
    let selection: string | undefined, reads = 0;
    const checkSelection = async () => {
      const read = ++reads;
      try {
        const viewer = await readNativeSelectedViewer();
        if (!alive || abort.signal.aborted || read !== reads) return;
        const key = viewer ? JSON.stringify([viewer.session.viewer.serverId, viewer.session.viewer.accountId, viewer.session.viewer.profileId, viewer.session.sessionFamilyId]) : '';
        if (selection !== undefined && key !== selection) {abort.abort(); owned?.dispose(); setAttempt(value => value + 1);}
        selection = key;
      } catch (error) {if (alive && !abort.signal.aborted) {owned?.dispose(); setState({phase: 'ended', error});}}
    };
    const unsubscribe = subscribeNativeAppSessions(() => {void checkSelection();});
    const unsettled = nativeAccounts.onSettled(() => {if (alive) setAttempt(value => value + 1);});
    const unfence = nativeAccounts.onFence(() => {abort.abort(); if (owned) {owned.dispose(); owned = undefined; setState({phase: 'loading'});}});
    void checkSelection();
    const started = Date.now(); setElapsed(0); setState({phase: 'loading'}); setShowAccounts(false);
    void nativeAccounts.snapshot().then(value => {if (alive) setRetained(value.servers.length > 0);}, () => {});
    const clock = setInterval(() => setElapsed(Date.now() - started), 120);
    void restoreNativeShellRuntime(createNativeShellBindings, {signal: abort.signal, onAuthorityEnded: () => {
      if (alive && !abort.signal.aborted) setState({phase: 'ended'});
    }}).then(runtime => {
      clearInterval(clock);
      if (!alive || abort.signal.aborted) {runtime?.dispose(); return;}
      owned = runtime; setState({phase: runtime ? 'ready' : 'ended', runtime});
    }, error => {clearInterval(clock); if (!abort.signal.aborted) setState({phase: 'ended', error});});
    return () => {alive = false; abort.abort(); unsubscribe(); unfence(); unsettled(); clearInterval(clock); owned?.dispose();};
  }, [attempt]);
  const complete = () => setAttempt(value => value + 1);
  if (state.runtime && state.phase === 'ready') return <NativeShell runtime={state.runtime}/>;
  if (state.phase === 'loading') return <HomeSkeleton elapsedMs={elapsed} visible/>;
  if (showAccounts || !state.error && retained) return <ServersRoute onComplete={complete} onBack={state.error ? () => setShowAccounts(false) : undefined}/>;
  if (state.error) {
    const error = presentError(state.error, 'home');
    return <StateView variant="centered" title={error.title} body={error.body} tone="error"
      primaryAction={error.action === 'try-again' || error.action === 'refresh' ? {id: 'restore', label: error.actionLabel, onPress: complete} : undefined}
      secondaryAction={{id: 'accounts', label: defaultI18n.t('portico.landing.chooseAnother'), onPress: () => setShowAccounts(true)}}/>;
  }
  return <AccountEntry onComplete={complete}/>;
}
