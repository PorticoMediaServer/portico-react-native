import {readingHighlightsSavePort} from '../../platform/reading-highlights-save';
import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AppState, NativeModules, View, useWindowDimensions} from 'react-native';
import WebView from 'react-native-webview';
import {createReadingHost, type ReadingSession, type PreferenceSnapshot} from '../../../../../packages/client-core/src';
import {routeBase64} from '../../../../../packages/client-core/src/route-identity';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {nativeRouteCrypto} from '../../platform/server-connections';
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

type Target = Readonly<{itemId: string; sourceId: string; contentsTarget?: Readonly<{sourceId: string; sourceRevision: string; index: number}>}>;
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
  const closeRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const theme = useTheme(), view = useRef<WebView>(null), host = useRef<ReturnType<typeof createReadingHost>>(undefined);
  const dimensions = useWindowDimensions(), posture = usePlatformPosture();
  // foldable6/tablet-read5: only a real vertical crease for this exact window may
  // request the two-page spread; an absent report keeps the ordinary one page.
  const crease = posture.status === 'available' && posture.window?.width === dimensions.width && posture.window.height === dimensions.height
    ? posture.folds.find(value => value.orientation === 'vertical' && value.bounds.left > 0 && value.bounds.left <= value.bounds.right && value.bounds.right <= dimensions.width)?.bounds : undefined;
  const creaseRef = useRef(crease); creaseRef.current = crease;
  const callbacks = useRef({onBack, onOpenSettings, active}); callbacks.current = {onBack, onOpenSettings, active};
  const [state, setState] = useState<Readonly<{url?: string; failed?: boolean}>>({}), [retry, setRetry] = useState(0);
  // Private offline annotation journal and its guarded reconnect merge (offline-annotation-sync).
  const journal = useMemo(() => new NativeAnnotationJournal(), [context]);
  const annotations = useMemo(() => new NativeAnnotationSync(context, journal, () => callbacks.current.active), [context, journal]);
  const quietRetry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const livePort = useRef<NativeAnnotationLivePort | undefined>(undefined);
  useEffect(() => () => {clearTimeout(quietRetry.current); annotations.stop();}, [annotations]);
  useEffect(() => {
    // Containment: no automatic merge is active before the reviewed corrections land.
    if (!NATIVE_OFFLINE_ANNOTATION_AUTHORING) return;
    // Only the active reader, or the app returning to it, attempts a merge; leaving the
    // reader retires the transport synchronously and nothing runs in the background.
    if (active) void annotations.flush(livePort.current); else annotations.stop();
    const subscription = AppState.addEventListener('change', next => {
      if (next === 'active' && callbacks.current.active) void annotations.flush(livePort.current);
      else if (next !== 'active') annotations.stop();
    });
    return () => subscription.remove();
  }, [active, annotations]);
  useEffect(() => annotations.subscribe(() => {
    const snapshot = annotations.getSnapshot();
    if (__DEV__ && (snapshot.queued || snapshot.unresolved || snapshot.phase === 'error')) {
      // Closed codes only: never the parser/transport message, which can carry private text.
      const known = new Set(['cancelled', 'invalid_document', 'invalid_revision', 'invalid_location', 'not_permitted',
        'conflict', 'source_changed', 'response_size', 'invalid_response', 'native_annotation_journal_invalid',
        'native_annotation_journal_full', 'native_annotation_journal_retired', 'native_annotation_journal_unbound',
        'native_annotation_journal_foreign_profile', 'native_annotation_journal_attempt_missing',
        'native_annotation_journal_migration_conflict', 'native_annotation_journal_migration_overflow',
        'native_annotation_local_conflict', 'offline_annotations_incomplete']);
      const supplied = (snapshot.error as {code?: unknown} | undefined)?.code;
      const code = typeof supplied === 'string' && known.has(supplied) ? supplied : snapshot.error ? 'native_error' : '';
      console.warn('portico_annotation_journal', JSON.stringify({phase: snapshot.phase, queued: snapshot.queued,
        unresolved: snapshot.unresolved, ...(code ? {error: code} : {})}));
    }
  }), [annotations]);
  useEffect(() => {
    const life = new AbortController(), captured = context.session();
    if (!captured || !context.current()) return;
    let alive = true, session: ReadingSession | undefined;
    const apiCurrent = () => !life.signal.aborted && context.current() && context.session()?.sessionFamilyId === captured.sessionFamilyId;
    const current = () => alive && apiCurrent();
    const client = context.api.reading({viewer: captured.viewer, isCurrent: apiCurrent, signal: life.signal});
    const authority = context.subscribeAuthority(() => {if (!context.current()) {annotations.stop(); journal.unbind(); life.abort();}});
    const offPreferences = preferences.subscribe(() => {if (current()) host.current?.confirm();});
    let disposal: Promise<void> | undefined;
    const dispose = () => {
      if (disposal) return disposal;
      alive = false; livePort.current = undefined; annotations.stop(); journal.unbind(); authority(); offPreferences(); host.current?.dispose(); host.current = undefined;
      // Explicit close uses the captured current viewer, before local retirement.
      disposal = (async () => {
        const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 2000);
        try {if (context.current()) await session?.close(deadline.signal);} finally {clearTimeout(timer); life.abort(); client.dispose();}
      })();
      return disposal;
    };
    closeRef.current = dispose;
    observedBridge.current.clear();
    setState({});
    void (async () => {
      const versions = await client.versions(target.itemId, life.signal);
      if (!versions.versions.some(value => value.sourceId === target.sourceId && value.inventoryAvailable)) throw new Error('reading_unavailable');
      session = await client.open(target, life.signal);
      // Only a real server annotation port may be reused for a merge; a downloaded
      // source's local view is never mistaken for one.
      livePort.current = NATIVE_OFFLINE_ANNOTATION_AUTHORING && session.manifest.canAnnotate === true
        && typeof session.annotations === 'function' && typeof session.mutateAnnotation === 'function' ? session : undefined;
      // Containment: no offline journal is bound, no canAnnotate is synthesized and no merge
      // runs until the reviewed corrections land. Server annotations stay the canonical port.
      if (NATIVE_OFFLINE_ANNOTATION_AUTHORING) {
        // A downloaded publication's queued edits live in that exact download's private
        // lease state; an ordinary session uses the protected record store. Bind before the
        // bridge can accept an edit, and only for this captured profile.
        await journal.bind(nativeAnnotationIdentity(captured.viewer), nativeAnnotationLeaseOf(session), {current: apiCurrent, signal: life.signal});
        if (current()) void annotations.flush(livePort.current);
      }
      const initialProgress = await session.progress(life.signal);
      const bundle: unknown = await NativeModules.PorticoReaderAssets?.bundle();
      const url = bundle && typeof bundle === 'object' && 'url' in bundle ? bundle.url : undefined;
      if (!readerAssetEntry(url) || !current()) throw new Error('reader_assets_unavailable');
      const highlightsSave = {saveHighlights: readingHighlightsSavePort()};
      const issued = session.manifest.format;
      const format: NativeAnnotationFormat | undefined = issued === 'epub' || issued === 'pdf' || issued === 'cbz' ? issued : undefined;
      const bridge = format ? nativeAnnotationBridge({session, journal, identity: nativeAnnotationIdentity(captured.viewer),
        source: {itemId: target.itemId, sourceId: target.sourceId, sourceRevision: session.manifest.revision, format}, fresh: current,
        onQueued: () => {
          // A transport failure kept the original edit; the guest sees the real error. Retry later, never in a loop.
          if (quietRetry.current) return;
          quietRetry.current = setTimeout(() => {quietRetry.current = undefined; if (current()) void annotations.flush(livePort.current);}, 15_000);
        }}) : session;
      host.current = createReadingHost({...highlightsSave, session: bridge, channel: routeBase64(nativeRouteCrypto.random(24)), preferences: preferences.getSnapshot, ...(creaseRef.current ? {crease: {left: creaseRef.current.left, right: creaseRef.current.right}} : {}),
        // Core fences ordinary packets. Its credentialless retirement packet
        // must still reach the captured guest after this authority has ended.
        initialProgress, initialContentsTarget: target.contentsTarget,
        onUnavailable: () => {if (current()) setState({failed: true}); void dispose().catch(() => {});},
        current, send: message => {observeBridge('host-to-guest', message); view.current?.injectJavaScript(readerDelivery(message));},
        onBack: () => {if (current() && callbacks.current.active) callbacks.current.onBack();}, onSettings: () => {if (current() && callbacks.current.active) callbacks.current.onOpenSettings();}});
      // The guest may handshake before the post-render activity effect runs.
      host.current.setActive(callbacks.current.active);
      setState({url});
    })().catch(() => {if (current()) {setState({failed: true});} void dispose().catch(() => {});});
    return () => {if (closeRef.current === dispose) closeRef.current = undefined; void dispose().catch(() => {});};
  }, [annotations, context, journal, preferences, retry, target]);
  useEffect(() => {host.current?.setActive(active);}, [active, state.url]);
  useEffect(() => {host.current?.setCrease(crease ? {left: crease.left, right: crease.right} : undefined);}, [crease, state.url]);
  return <View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: active ? 1 : 0}}>
    {state.failed ? <StateView variant="centered" title={defaultI18n.t('next.states.pageFailed')} body={defaultI18n.t('next.states.pageFailedBody')}
      primaryAction={{id: 'retry', label: defaultI18n.t('next.states.tryAgain'), disabled: !active, onPress: () => setRetry(value => value + 1)}}/>
      : state.url ? <WebView ref={view} source={{uri: state.url}} style={{flex: 1, backgroundColor: theme.colors.ink}}
        originWhitelist={['*']} onShouldStartLoadWithRequest={request => readerNavigationAllowed(state.url!, request.url, request.isTopFrame)}
        injectedJavaScriptBeforeContentLoaded={__DEV__ ? readerStartupProbe : undefined}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={event => {if (readerNavigationAllowed(state.url!, event.nativeEvent.url, true)) {
          if (__DEV__) {const diagnostic = readerStartupDiagnostic(event.nativeEvent.url, event.nativeEvent.data);
            if (diagnostic) {console.warn('portico_reader_startup', JSON.stringify(diagnostic)); return;}}
          observeBridge('guest-to-host', event.nativeEvent.data);
          host.current?.receive(event.nativeEvent.data);
        }}}
        renderError={() => <></>} incognito cacheEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} domStorageEnabled={false}
        allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
        javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows={false} onOpenWindow={() => {}}
        onError={() => {setState({failed: true}); void closeRef.current?.().catch(() => {});}}
        onContentProcessDidTerminate={() => {setState({failed: true}); void closeRef.current?.().catch(() => {});}}
        onRenderProcessGone={() => {setState({failed: true}); void closeRef.current?.().catch(() => {});}}/>
      : <SkeletonBlock width="100%" style={{flex: 1}}/>}
  </View>;
}
