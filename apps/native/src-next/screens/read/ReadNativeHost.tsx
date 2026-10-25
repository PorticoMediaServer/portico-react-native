import {readingHighlightsSavePort} from '../../platform/reading-highlights-save';
import React, {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {AppState, NativeModules, View, useWindowDimensions} from 'react-native';
import WebView from 'react-native-webview';
import {createReadingHost, preferenceValue, ReadingError, type ReadingSession, type PreferenceSnapshot} from '../../../../../packages/client-core/src';
import {routeBase64} from '../../../../../packages/client-core/src/route-identity';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {nativeRouteCrypto} from '../../platform/server-connections';
import {createNativeDownloadsDevice} from '../downloads/device';
import {offlineDownloads} from '../../../platform/offline-downloads';
import type {ReadingHostSession} from '../../../../../packages/client-core/src/reading-host';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {StateView, SkeletonBlock} from '../../kit/states';
import {useTheme} from '../../kit/theme';
import {usePlatformPosture} from '../../platform/platformPosture';
import {readerAssetEntry, readerNavigationAllowed, readerDelivery} from './asset-origin';
import {readerBridgeDiagnostic, readerStartupDiagnostic, readerStartupProbe} from './startup-diagnostics';
import {NativeAnnotationJournal, nativeAnnotationIdentity, nativeAnnotationLeaseOf, type NativeAnnotationFormat} from './annotation-journal';
import {nativeAnnotationBridge} from './annotation-session';
import {NativeAnnotationSync, type NativeAnnotationLivePort} from './annotation-sync';
import {NATIVE_OFFLINE_ANNOTATION_AUTHORING} from './annotation-authoring';

type Target = Readonly<{itemId: string; sourceId: string; downloadId?: string; contentsTarget?: Readonly<{sourceId: string; sourceRevision: string; index: number}>}>;
const annotationDiagnosticCodes = new Set(['cancelled', 'conflict', 'invalid_document', 'invalid_location', 'invalid_response',
  'invalid_revision', 'not_permitted', 'response_size', 'source_changed']);
/** Only trusted immutable app code is loaded. The real API/session never enters
 * the WebView; the single browser controller receives structural byte callbacks. */
export function ReadNativeHost({context, target, active, preferences, onBack, onOpenSettings}: {
  context: NativeShellBootstrapContext; target: Target; active: boolean; preferences: Readonly<{getSnapshot: () => PreferenceSnapshot; subscribe: (listener: () => void) => () => void}>; onBack: () => void; onOpenSettings: () => void;
}) {
  const observedBridge = useRef(new Set<string>());
  const observeBridge = (direction: 'guest-to-host' | 'host-to-guest', message: string) => {
    if (!__DEV__) return;
    const diagnostic = readerBridgeDiagnostic(message);
    if (!diagnostic) return;
    const key = `${direction}:${diagnostic.kind}:${diagnostic.method ?? ''}:${diagnostic.failed}`;
    if (observedBridge.current.has(key)) return;
    observedBridge.current.add(key);
    console.warn('portico_reader_bridge', JSON.stringify({direction, ...diagnostic,
      host: Boolean(host.current), view: Boolean(view.current), active: callbacks.current.active}));
  };
  const theme = useTheme(), view = useRef<WebView>(null), host = useRef<ReturnType<typeof createReadingHost>>(undefined);
  const dimensions = useWindowDimensions(), posture = usePlatformPosture();
  // foldable6/tablet-read5: only a real vertical crease for this exact window may
  // request the two-page spread; an absent report keeps the ordinary one page.
  const crease = posture.status === 'available' && posture.window?.width === dimensions.width && posture.window.height === dimensions.height
    ? posture.folds.find(value => value.orientation === 'vertical' && value.bounds.left > 0 && value.bounds.left <= value.bounds.right && value.bounds.right <= dimensions.width)?.bounds : undefined;
  const creaseRef = useRef(crease); creaseRef.current = crease;
  const callbacks = useRef({onBack, onOpenSettings, active}); callbacks.current = {onBack, onOpenSettings, active};
  const [state, setState] = useState<Readonly<{url?: string; failed?: boolean; reader?: ReturnType<typeof createReadingHost>; close?: () => Promise<void>}>>({}), [retry, setRetry] = useState(0);
  // Private offline annotation journal and its guarded reconnect merge (offline-annotation-sync).
  const journal = useMemo(() => new NativeAnnotationJournal(), [context]);
  const annotations = useMemo(() => new NativeAnnotationSync(context, journal), [context, journal]);
  const quietRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const livePort = useRef<NativeAnnotationLivePort | undefined>(undefined);
  useEffect(() => () => {clearTimeout(quietRetry.current); annotations.dispose();}, [annotations]);
  useEffect(() => {
    // Containment: no automatic merge is active before the functional corrections are reviewed.
    if (!NATIVE_OFFLINE_ANNOTATION_AUTHORING) return;
    // Only the active reader, or the app returning to it, attempts a merge; nothing runs in the background.
    if (active && !target.downloadId) void annotations.flush(livePort.current);
    const subscription = AppState.addEventListener('change', next => {if (!target.downloadId && next === 'active' && callbacks.current.active) void annotations.flush(livePort.current);});
    return () => subscription.remove();
  }, [active, annotations, target.downloadId]);
  useEffect(() => annotations.subscribe(() => {
    const snapshot = annotations.getSnapshot();
    if (__DEV__ && (snapshot.queued || snapshot.unresolved || snapshot.phase === 'error')) {
      // Only closed codes may leave this boundary; unknown messages can contain private records or paths.
      const error = snapshot.error instanceof ReadingError && annotationDiagnosticCodes.has(snapshot.error.code)
        ? snapshot.error.code : snapshot.error == null ? '' : 'native_error';
      console.warn('portico_annotation_journal', JSON.stringify({phase: snapshot.phase, queued: snapshot.queued,
        unresolved: snapshot.unresolved, error}));
    }
  }), [annotations]);
  type Owner = {retired: boolean; active?: {live: boolean; abort: AbortController}};
  const ownership = useMemo<Owner>(() => ({retired: false}), [context, target, preferences, retry]);
  const rendered = useRef(ownership);
  if (rendered.current !== ownership) {rendered.current.retired = true; if (rendered.current.active) {rendered.current.active.live = false; rendered.current.active.abort.abort();} rendered.current = ownership;}
  useLayoutEffect(() => {
    const ticket = {live: true, abort: new AbortController()}; ownership.active = ticket;
    const life = ticket.abort, captured = context.session();
    if (!captured || !context.current()) return;
    let alive = true, session: (ReadingHostSession & Pick<ReadingSession, 'close'>) | undefined;
    let ownedHost: ReturnType<typeof createReadingHost> | undefined;
    const downloads = target.downloadId ? createNativeDownloadsDevice(context) : undefined;
    const apiCurrent = () => ticket.live && !ownership.retired && ownership.active === ticket && rendered.current === ownership && !life.signal.aborted && context.current() && context.session()?.sessionFamilyId === captured.sessionFamilyId;
    const current = () => alive && apiCurrent();
    const client = target.downloadId ? undefined : context.api.reading({viewer: captured.viewer, isCurrent: apiCurrent, signal: life.signal});
    const authority = context.subscribeAuthority(() => {if (!apiCurrent()) life.abort();});
    const offPreferences = preferences.subscribe(() => {if (current()) host.current?.confirm();});
    let disposal: Promise<void> | undefined;
    const dispose = () => {
      if (disposal) return disposal;
      alive = false; if (!target.downloadId) {livePort.current = undefined; journal.unbind();} ticket.live = false; authority(); offPreferences(); ownedHost?.dispose(); if (host.current === ownedHost) host.current = undefined;
      // Explicit close uses the captured current viewer, before local retirement.
      disposal = (async () => {
        const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 2000);
        try {if (context.current()) await session?.close(deadline.signal);} finally {clearTimeout(timer); life.abort(); client?.dispose(); downloads?.dispose();}
      })();
      return disposal;
    };
    observedBridge.current.clear();
    setState({});
    void (async () => {
      if (target.downloadId) {
        if (!downloads) throw new Error('reading_unavailable');
        await downloads.device.open(); if (!current()) throw new Error('reading_retired');
        const entry = offlineDownloads.getSnapshot().entries.find(value => value.id === target.downloadId && value.itemId === target.itemId);
        if (!entry || offlineDownloads.publicationSource(entry).sourceId !== target.sourceId) throw new Error('reading_unavailable');
        // This is a write gate, not a claimed user setting: only the server's real
        // published value (or its own registry default) of boolean false permits an
        // offline progress write. A missing, non-boolean or unreadable preference
        // withholds it rather than assuming permission.
        const paused = () => {
          try {return preferenceValue(preferences.getSnapshot(), 'privacy.pauseWatchHistory') !== false;} catch {return true;}
        };
        session = await offlineDownloads.readingSession(entry, {signal: life.signal, current, paused});
      } else {
        if (!client) throw new Error('reading_unavailable');
        const versions = await client.versions(target.itemId, life.signal);
        if (!versions.versions.some(value => value.sourceId === target.sourceId && value.inventoryAvailable)) throw new Error('reading_unavailable');
        const onlineSession = await client.open(target, life.signal);
        session = onlineSession;
        if (NATIVE_OFFLINE_ANNOTATION_AUTHORING) {
          livePort.current = onlineSession.manifest.canAnnotate === true
            && typeof onlineSession.annotations === 'function' && typeof onlineSession.mutateAnnotation === 'function' ? onlineSession : undefined;
          journal.bind(nativeAnnotationIdentity(captured.viewer), nativeAnnotationLeaseOf(onlineSession));
          if (current()) void annotations.flush(livePort.current);
        }
      }
      const initialProgress = await session.progress(life.signal);
      const bundle: unknown = await NativeModules.PorticoReaderAssets?.bundle();
      const url = bundle && typeof bundle === 'object' && 'url' in bundle ? bundle.url : undefined;
      if (!readerAssetEntry(url) || !current()) throw new Error('reader_assets_unavailable');
      const highlightsSave = {saveHighlights: readingHighlightsSavePort()};
      const issued = session.manifest.format;
      const format: NativeAnnotationFormat | undefined = issued === 'epub' || issued === 'pdf' || issued === 'cbz' ? issued : undefined;
      const bridge = !target.downloadId && format ? nativeAnnotationBridge({session, journal, identity: nativeAnnotationIdentity(captured.viewer),
        source: {itemId: target.itemId, sourceId: target.sourceId, sourceRevision: session.manifest.revision, format}, fresh: current,
        onQueued: () => {
          // A transport failure kept the original edit; the guest sees the real error. Retry later, never in a loop.
          if (quietRetry.current) return;
          if (!NATIVE_OFFLINE_ANNOTATION_AUTHORING) return;
          quietRetry.current = setTimeout(() => {quietRetry.current = undefined; if (current()) void annotations.flush(livePort.current);}, 15_000);
        }}) : session;
      ownedHost = createReadingHost({...highlightsSave, session: bridge, channel: routeBase64(nativeRouteCrypto.random(24)), preferences: preferences.getSnapshot, ...(creaseRef.current ? {crease: {left: creaseRef.current.left, right: creaseRef.current.right}} : {}),
        // Core fences ordinary packets. Its credentialless retirement packet
        // must still reach the captured guest after this authority has ended.
        initialProgress, initialContentsTarget: target.contentsTarget,
        onUnavailable: () => {if (current()) setState({failed: true}); void dispose().catch(() => {});},
        current, send: message => {observeBridge('host-to-guest', message); view.current?.injectJavaScript(readerDelivery(message));},
        onBack: () => {if (current() && callbacks.current.active) callbacks.current.onBack();}, onSettings: () => {if (current() && callbacks.current.active) callbacks.current.onOpenSettings();}});
      // The guest may handshake before the post-render activity effect runs.
      host.current = ownedHost; ownedHost.setActive(callbacks.current.active);
      setState({url, reader: ownedHost, close: dispose});
    })().catch(() => {if (current()) {setState({failed: true});} void dispose().catch(() => {});});
    return () => {ticket.live = false; if (ownership.active === ticket) ownership.active = undefined; void dispose().catch(() => {});};
  }, [annotations, context, journal, target, preferences, retry, ownership]);
  useEffect(() => {host.current?.setActive(active);}, [active, state.url]);
  useEffect(() => {host.current?.setCrease(crease ? {left: crease.left, right: crease.right} : undefined);}, [crease, state.url]);
  // A retired WebView's delayed error/message must never act on a successor
  // reader that happens to use the same trusted asset URL.
  const failRenderedReader = () => {
    if (!state.reader || host.current !== state.reader) return;
    setState({failed: true});
    void state.close?.().catch(() => {});
  };
  return <View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: active ? 1 : 0}}>
    {state.failed ? <StateView variant="centered" title={defaultI18n.t('next.states.pageFailed')} body={defaultI18n.t('next.states.pageFailedBody')}
      primaryAction={{id: 'retry', label: defaultI18n.t('next.states.tryAgain'), disabled: !active, onPress: () => setRetry(value => value + 1)}}/>
      : state.url ? <WebView ref={view} source={{uri: state.url}} style={{flex: 1, backgroundColor: theme.colors.ink}}
        originWhitelist={['*']} onShouldStartLoadWithRequest={request => readerNavigationAllowed(state.url!, request.url, request.isTopFrame)}
        injectedJavaScriptBeforeContentLoaded={__DEV__ ? readerStartupProbe : undefined}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={event => {if (state.reader && host.current === state.reader && readerNavigationAllowed(state.url!, event.nativeEvent.url, true)) {
          if (__DEV__) {const diagnostic = readerStartupDiagnostic(event.nativeEvent.url, event.nativeEvent.data);
            if (diagnostic) {console.warn('portico_reader_startup', JSON.stringify(diagnostic)); return;}}
          observeBridge('guest-to-host', event.nativeEvent.data);
          state.reader.receive(event.nativeEvent.data);
        }}}
        renderError={() => <></>} incognito cacheEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} domStorageEnabled={false}
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows={false} onOpenWindow={() => {}}
        onError={failRenderedReader}
        onContentProcessDidTerminate={failRenderedReader}
        onRenderProcessGone={failRenderedReader}/>
      : <SkeletonBlock width="100%" style={{flex: 1}}/>}
  </View>;
}
