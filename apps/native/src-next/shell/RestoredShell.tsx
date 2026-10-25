import React, {useLayoutEffect, useRef, useState} from 'react';
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
import {NativeSignInEnded} from '../platform/sign-in-ended';
import {NativeIdentityFailure} from '../platform/identity-failure';
import {PhoneFirstLibrary} from '../screens/accounts/PhoneFirstLibrary';
import {ServerIdentityFailure} from '../screens/accounts/ServerIdentityFailure';
import {beginNativeInstallation} from '../platform/installation';
import {createRememberedDownloadsOpening, type RememberedDownloadsOpening} from './remembered-downloads-opening';
import {RememberedDownloadsScreen, RememberedDownloadsShortcut} from '../screens/downloads/RememberedDownloadsScreen';
import {View} from 'react-native';
import {NativeSettingsAppearance} from '../screens/settings/NativeSettingsAppearance';

type RestoreState = Readonly<{phase: 'loading' | 'ready' | 'ended'; runtime?: RestoredNativeShellRuntime; error?: unknown}>;

/** Restore only the captured canonical server selection; current account entry owns sign-in. */
export function RestoredShell() {
  const [attempt, setAttempt] = useState(0), [state, setState] = useState<RestoreState>({phase: 'loading'}), [elapsed, setElapsed] = useState(0);
  const [firstLibrary, setFirstLibrary] = useState<string>();
  const [showAccounts, setShowAccounts] = useState(false), [retained, setRetained] = useState(false);
  const [downloads, setDownloads] = useState<RememberedDownloadsOpening>();
  type DownloadView = {source: RememberedDownloadsOpening; serial: number};
  const [downloadView, setDownloadView] = useState<DownloadView>();
  const viewOwner = useRef<DownloadView | undefined>(undefined), viewSerial = useRef(0);
  type RootOpening = {attempt: number; active: boolean; source?: RememberedDownloadsOpening; current?: () => boolean; retire?: () => void; restart?: () => void};
  const root = useRef<RootOpening | undefined>(undefined);
  if (root.current && root.current.attempt !== attempt) root.current.retire?.();
  useLayoutEffect(() => {
    const ticket: RootOpening = {attempt, active: true}; root.current = ticket;
    const abort = new AbortController(); let owned: RestoredNativeShellRuntime | undefined;
    const installation = beginNativeInstallation(abort.signal);
    let alive = true;
    const rootCurrent = () => alive && ticket.active && root.current === ticket && !abort.signal.aborted && installation.current();
    ticket.current = rootCurrent;
    let clock: ReturnType<typeof setInterval> | undefined;
    ticket.retire = () => {
      if (!ticket.active) return;
      ticket.active = false; alive = false;
      const previous = owned, previousSource = ticket.source; owned = undefined; ticket.source = undefined;
      if (root.current === ticket) viewOwner.current = undefined;
      if (clock) clearInterval(clock);
      // Revoke original IO synchronously, before render can expose a successor.
      for (const release of [() => abort.abort(), () => previousSource?.dispose(), () => previous?.dispose()]) {
        try {release();} catch { /* All original capabilities are retired; finish remaining cleanup. */ }
      }
    };
    const restart = () => {
      if (!rootCurrent()) return;
      // The callback is captured now; a deferred updater cannot bump a newer root.
      setAttempt(value => root.current === ticket && value === ticket.attempt ? value + 1 : value);
      ticket.retire?.();
    };
    ticket.restart = restart;
    const publishState = (next: RestoreState) => {if (rootCurrent()) setState(previous => rootCurrent() ? next : previous);};
    viewOwner.current = undefined;
    setDownloadView(previous => rootCurrent() ? undefined : previous);
    setDownloads(previous => rootCurrent() ? undefined : previous);
    let fallbackFlight: Promise<void> | undefined;
    const fallback = () => {
      if (fallbackFlight || !rootCurrent() || owned) return;
      let captured: RememberedDownloadsOpening | undefined;
      fallbackFlight = createRememberedDownloadsOpening(installation, {signal: abort.signal, isCurrent: () => rootCurrent() && !owned,
        onOpen: source => {
          if (!rootCurrent() || owned || ticket.source !== source || !source.current() || viewOwner.current) return;
          const view = {source, serial: ++viewSerial.current}; viewOwner.current = view; setDownloadView(previous => rootCurrent() && viewOwner.current === view ? view : previous);
        }, onRetired: () => {
          if (!captured || ticket.source !== captured || !rootCurrent()) return;
          ticket.source = undefined; setDownloads(previous => rootCurrent() && previous === captured ? undefined : previous);
          if (viewOwner.current?.source === captured) {viewOwner.current = undefined; setDownloadView(previous => rootCurrent() && previous?.source === captured ? undefined : previous);}
        },
      }).then(source => {captured = source;
        if (!rootCurrent() || owned || source && !source.current()) {source?.dispose(); return;}
        ticket.source = source; setDownloads(previous => rootCurrent() && ticket.source === source ? source : previous);
      }, () => { /* Offline is optional; the original restore refusal remains visible. */ });
    };
    let selection: string | undefined, reads = 0, fenced = false, restored = false;
    const checkSelection = async () => {
      if (!rootCurrent()) return;
      const read = ++reads;
      try {
        const viewer = await readNativeSelectedViewer();
        if (!rootCurrent() || read !== reads) return;
        const key = viewer ? JSON.stringify([viewer.session.viewer.serverId, viewer.session.viewer.accountId, viewer.session.viewer.profileId, viewer.session.sessionFamilyId]) : '';
        if (selection !== undefined && key !== selection) {
          // A pending restore or a ready runtime must be fenced. Once the entry is settled
          // and owns sign-in, the new selection is its own publication: its onComplete
          // starts the restore, so aborting here would unmount it mid-publish.
          if (!restored || owned) {restart(); return;}
        }
        selection = key;
      } catch (error) {if (rootCurrent()) {const previous = owned; owned = undefined; previous?.dispose(); if (rootCurrent()) publishState({phase: 'ended', error});}}
    };
    const unsubscribe = subscribeNativeAppSessions(() => {if (rootCurrent()) void checkSelection();});
    // A ready shell refreshes when a publication settles. While an entry is publishing
    // (no owned runtime yet) the entry's own onComplete starts the restore, so a settled
    // bump here would abort the entry mid-publication and can leave the shell empty.
    const unsettled = nativeAccounts.onSettled(() => {if (rootCurrent() && (owned || fenced)) restart();});
    // A fence retires the running shell runtime. With no runtime there is nothing to
    // abandon: the entry that is publishing stays mounted and reports completion itself.
    const unfence = nativeAccounts.onFence(() => {
      if (!rootCurrent() || !owned) return;
      fenced = true; const previous = owned; owned = undefined; previous.dispose();
      // Keep the original root waiting for the existing settled publication;
      // never start a replacement restore in the middle of account publication.
      if (rootCurrent()) publishState({phase: 'loading'});
    });
    void checkSelection();
    const started = Date.now();
    if (rootCurrent()) {setElapsed(previous => rootCurrent() ? 0 : previous); publishState({phase: 'loading'}); setShowAccounts(previous => rootCurrent() ? false : previous);}
    if (rootCurrent()) void nativeAccounts.snapshot().then(value => {if (rootCurrent()) setRetained(previous => rootCurrent() ? value.servers.length > 0 : previous);}, () => {});
    if (rootCurrent()) clock = setInterval(() => {if (rootCurrent()) setElapsed(previous => rootCurrent() ? Date.now() - started : previous);}, 120);
    if (rootCurrent()) void restoreNativeShellRuntime(createNativeShellBindings, {signal: abort.signal, installationOwner: installation, onSessionRenewed: () => {
      if (rootCurrent()) restart();
    }, onAuthorityEnded: error => {
      if (rootCurrent()) {owned = undefined; publishState({phase: 'ended', error}); if (rootCurrent()) fallback();}
    }}).then(runtime => {
      if (clock) clearInterval(clock);
      if (!rootCurrent()) {runtime?.dispose(); return;}
      restored = true; owned = runtime; publishState({phase: runtime ? 'ready' : 'ended', runtime}); if (rootCurrent() && !runtime) fallback();
    }, error => {if (clock) clearInterval(clock); if (rootCurrent()) {restored = true; publishState({phase: 'ended', error}); if (rootCurrent()) fallback();}});
    return () => {ticket.retire?.(); installation.dispose(); unsubscribe(); unfence(); unsettled(); if (clock) clearInterval(clock);};
  }, [attempt]);
  const renderedRoot = root.current;
  const renderedCurrent = () => !!renderedRoot?.current?.();
  const complete = () => {if (renderedCurrent()) renderedRoot?.restart?.();};
  const setupComplete = (serverId: string) => {if (renderedCurrent()) setFirstLibrary(previous => renderedCurrent() ? serverId : previous);};
  const chooseAccounts = () => {if (renderedCurrent()) setShowAccounts(previous => renderedCurrent() ? true : previous);};
  if (renderedRoot && !renderedCurrent()) return <HomeSkeleton elapsedMs={elapsed} visible/>;
  const remembered = downloads && root.current?.active && root.current.attempt === attempt && downloads.current() ? downloads : undefined;
  const opened = downloadView;
  if (opened && remembered === opened.source && viewOwner.current === opened) return <RememberedDownloadsScreen key={opened.serial} source={opened.source} onBack={() => {
    if (!renderedCurrent() || viewOwner.current !== opened || !opened.source.current()) return; viewOwner.current = undefined;
    setDownloadView(previous => renderedCurrent() && previous === opened ? undefined : previous);
  }}/>;
  const withDownloads = (content: React.ReactNode, shortcut = true) => shortcut && remembered
    ? <View style={{flex: 1}}>{content}<RememberedDownloadsShortcut source={remembered}/></View> : content;
  if (state.runtime && state.phase === 'ready') return <NativeSettingsAppearance source={state.runtime}><>{firstLibrary && state.runtime.firstLibraryContext?.current() && state.runtime.firstLibraryContext.authority().serverId === firstLibrary && state.runtime.firstLibraryContext.account.account.role === 'owner' && state.runtime.firstLibraryContext.account.account.primaryProfileId === state.runtime.firstLibraryContext.authority().profileId ? <PhoneFirstLibrary context={state.runtime.firstLibraryContext} onDone={() => {if (!renderedCurrent()) return; const runtime = state.runtime;
    setFirstLibrary(previous => renderedCurrent() ? undefined : previous); if (renderedCurrent()) void runtime?.refresh();}}/> : <NativeShell runtime={state.runtime}/>}</></NativeSettingsAppearance>;
  if (state.phase === 'loading') return <HomeSkeleton elapsedMs={elapsed} visible/>;
  if (showAccounts || !state.error && retained) return withDownloads(<ServersRoute fallbackDownloads={remembered?.entry} onSetupComplete={setupComplete} onComplete={complete} onBack={state.error ? () => {if (renderedCurrent()) setShowAccounts(previous => renderedCurrent() ? false : previous);} : undefined}/>, false);
  if (state.error instanceof NativeIdentityFailure) {
    const failure = state.error;
    return withDownloads(<ServerIdentityFailure failure={failure} onRetry={complete} onChoose={chooseAccounts}
      onForget={async () => {if (renderedCurrent()) await nativeAccounts.forgetServer(failure.server);}} onError={error => {if (renderedCurrent()) setState(previous => renderedCurrent() ? {phase: 'ended', error} : previous);}}/>);
  }
  if (state.error instanceof NativeSignInEnded) return withDownloads(<AccountEntry downloads={remembered?.entry} key={state.error.hint.serverId + ':' + state.error.hint.familyId} endedSignIn={state.error.hint} onSetupComplete={setupComplete} onComplete={complete} onBack={chooseAccounts}/>);
  if (state.error) {
    const error = presentError(state.error, 'home');
    return withDownloads(<StateView variant="centered" title={error.title} body={error.body} tone="error"
      primaryAction={error.action === 'try-again' || error.action === 'refresh' ? {id: 'restore', label: error.actionLabel, onPress: complete} : undefined}
      secondaryAction={{id: 'accounts', label: defaultI18n.t('portico.landing.chooseAnother'), onPress: chooseAccounts}}/>);
  }
  return withDownloads(<AccountEntry downloads={remembered?.entry} onSetupComplete={setupComplete} onComplete={complete}/>);
}
