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
  type RootOpening = {attempt: number; active: boolean; source?: RememberedDownloadsOpening};
  const root = useRef<RootOpening | undefined>(undefined);
  if (root.current && root.current.attempt !== attempt) root.current.active = false;
  useLayoutEffect(() => {
    const ticket: RootOpening = {attempt, active: true}; root.current = ticket;
    viewOwner.current = undefined; setDownloadView(undefined); setDownloads(undefined);
    const abort = new AbortController(); let owned: RestoredNativeShellRuntime | undefined;
    const installation = beginNativeInstallation(abort.signal);
    let alive = true;
    const rootCurrent = () => alive && ticket.active && root.current === ticket && !abort.signal.aborted && installation.current();
    let fallbackFlight: Promise<void> | undefined;
    const fallback = () => {
      if (fallbackFlight || !rootCurrent() || owned) return;
      let captured: RememberedDownloadsOpening | undefined;
      fallbackFlight = createRememberedDownloadsOpening(installation, {signal: abort.signal, isCurrent: () => rootCurrent() && !owned,
        onOpen: source => {
          if (!rootCurrent() || owned || ticket.source !== source || !source.current() || viewOwner.current) return;
          const view = {source, serial: ++viewSerial.current}; viewOwner.current = view; setDownloadView(view);
        }, onRetired: () => {
          if (!captured || ticket.source !== captured || !rootCurrent()) return;
          ticket.source = undefined; setDownloads(undefined);
          if (viewOwner.current?.source === captured) {viewOwner.current = undefined; setDownloadView(undefined);}
        },
      }).then(source => {captured = source;
        if (!rootCurrent() || owned) {source?.dispose(); return;}
        ticket.source = source; setDownloads(source);
      }, () => { /* Offline is optional; the original restore refusal remains visible. */ });
    };
    let selection: string | undefined, reads = 0, fenced = false, restored = false;
    const checkSelection = async () => {
      const read = ++reads;
      try {
        const viewer = await readNativeSelectedViewer();
        if (!alive || abort.signal.aborted || read !== reads) return;
        const key = viewer ? JSON.stringify([viewer.session.viewer.serverId, viewer.session.viewer.accountId, viewer.session.viewer.profileId, viewer.session.sessionFamilyId]) : '';
        if (selection !== undefined && key !== selection) {
          // A pending restore or a ready runtime must be fenced. Once the entry is settled
          // and owns sign-in, the new selection is its own publication: its onComplete
          // starts the restore, so aborting here would unmount it mid-publish.
          if (!restored || owned) {abort.abort(); owned?.dispose(); setAttempt(value => value + 1);}
        }
        selection = key;
      } catch (error) {if (alive && !abort.signal.aborted) {owned?.dispose(); setState({phase: 'ended', error});}}
    };
    const unsubscribe = subscribeNativeAppSessions(() => {void checkSelection();});
    // A ready shell refreshes when a publication settles. While an entry is publishing
    // (no owned runtime yet) the entry's own onComplete starts the restore, so a settled
    // bump here would abort the entry mid-publication and can leave the shell empty.
    const unsettled = nativeAccounts.onSettled(() => {if (alive && (owned || fenced)) setAttempt(value => value + 1);});
    // A fence retires the running shell runtime. With no runtime there is nothing to
    // abandon: the entry that is publishing stays mounted and reports completion itself.
    const unfence = nativeAccounts.onFence(() => {if (!alive || !owned) return; fenced = true; abort.abort(); owned.dispose(); owned = undefined; setState({phase: 'loading'});});
    void checkSelection();
    const started = Date.now(); setElapsed(0); setState({phase: 'loading'}); setShowAccounts(false);
    void nativeAccounts.snapshot().then(value => {if (alive) setRetained(value.servers.length > 0);}, () => {});
    const clock = setInterval(() => setElapsed(Date.now() - started), 120);
    void restoreNativeShellRuntime(createNativeShellBindings, {signal: abort.signal, installationOwner: installation, onSessionRenewed: () => {
      if (alive && !abort.signal.aborted) {setState({phase: 'loading'}); setAttempt(value => value + 1);}
    }, onAuthorityEnded: error => {
      if (alive && !abort.signal.aborted) {owned = undefined; setState({phase: 'ended', error}); fallback();}
    }}).then(runtime => {
      clearInterval(clock); restored = true;
      if (!alive || abort.signal.aborted) {runtime?.dispose(); return;}
      owned = runtime; setState({phase: runtime ? 'ready' : 'ended', runtime}); if (!runtime) fallback();
    }, error => {clearInterval(clock); restored = true; if (rootCurrent()) {setState({phase: 'ended', error}); fallback();}});
    return () => {ticket.active = false; alive = false; viewOwner.current = undefined; ticket.source?.dispose(); abort.abort(); installation.dispose(); unsubscribe(); unfence(); unsettled(); clearInterval(clock); owned?.dispose();};
  }, [attempt]);
  const complete = () => setAttempt(value => value + 1);
  const remembered = downloads && root.current?.active && root.current.attempt === attempt && downloads.current() ? downloads : undefined;
  const opened = downloadView;
  if (opened && remembered === opened.source && viewOwner.current === opened) return <RememberedDownloadsScreen key={opened.serial} source={opened.source} onBack={() => {
    if (viewOwner.current !== opened || !opened.source.current()) return; viewOwner.current = undefined; setDownloadView(undefined);
  }}/>;
  const withDownloads = (content: React.ReactNode, shortcut = true) => <View style={{flex: 1}}>{content}{shortcut && remembered && <RememberedDownloadsShortcut source={remembered}/>}</View>;
  if (state.runtime && state.phase === 'ready') return <NativeSettingsAppearance source={state.runtime}><>{firstLibrary && state.runtime.firstLibraryContext?.current() && state.runtime.firstLibraryContext.authority().serverId === firstLibrary && state.runtime.firstLibraryContext.account.account.role === 'owner' && state.runtime.firstLibraryContext.account.account.primaryProfileId === state.runtime.firstLibraryContext.authority().profileId ? <PhoneFirstLibrary context={state.runtime.firstLibraryContext} onDone={() => {const runtime = state.runtime; setFirstLibrary(undefined); void runtime?.refresh();}}/> : <NativeShell runtime={state.runtime}/>}</></NativeSettingsAppearance>;
  if (state.phase === 'loading') return <HomeSkeleton elapsedMs={elapsed} visible/>;
  if (showAccounts || !state.error && retained) return withDownloads(<ServersRoute fallbackDownloads={remembered?.entry} onSetupComplete={setFirstLibrary} onComplete={complete} onBack={state.error ? () => setShowAccounts(false) : undefined}/>, false);
  if (state.error instanceof NativeIdentityFailure) {
    const failure = state.error;
    return withDownloads(<ServerIdentityFailure failure={failure} onRetry={complete} onChoose={() => setShowAccounts(true)}
      onForget={() => nativeAccounts.forgetServer(failure.server)} onError={error => setState({phase: 'ended', error})}/>);
  }
  if (state.error instanceof NativeSignInEnded) return withDownloads(<AccountEntry downloads={remembered?.entry} key={state.error.hint.serverId + ':' + state.error.hint.familyId} endedSignIn={state.error.hint} onSetupComplete={setFirstLibrary} onComplete={complete} onBack={() => setShowAccounts(true)}/>);
  if (state.error) {
    const error = presentError(state.error, 'home');
    return withDownloads(<StateView variant="centered" title={error.title} body={error.body} tone="error"
      primaryAction={error.action === 'try-again' || error.action === 'refresh' ? {id: 'restore', label: error.actionLabel, onPress: complete} : undefined}
      secondaryAction={{id: 'accounts', label: defaultI18n.t('portico.landing.chooseAnother'), onPress: () => setShowAccounts(true)}}/>);
  }
  return withDownloads(<AccountEntry downloads={remembered?.entry} onSetupComplete={setFirstLibrary} onComplete={complete}/>);
}
