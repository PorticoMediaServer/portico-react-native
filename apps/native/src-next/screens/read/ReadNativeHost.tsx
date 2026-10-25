import React, {useEffect, useRef, useState} from 'react';
import {NativeModules, View} from 'react-native';
import WebView from 'react-native-webview';
import {createReadingHost, type ReadingSession, type PreferenceSnapshot} from '../../../../../packages/client-core/src';
import {routeBase64} from '../../../../../packages/client-core/src/route-identity';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {nativeRouteCrypto} from '../../platform/server-connections';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {StateView, SkeletonBlock} from '../../kit/states';
import {useTheme} from '../../kit/theme';
import {readerAssetEntry, readerNavigationAllowed, readerDelivery} from './asset-origin';
import {readerStartupDiagnostic, readerStartupProbe} from './startup-diagnostics';

type Target = Readonly<{itemId: string; sourceId: string}>;
/** Only trusted immutable app code is loaded. The real API/session never enters
 * the WebView; the single browser controller receives structural byte callbacks. */
export function ReadNativeHost({context, target, active, preferences, onBack, onOpenSettings}: {
  context: NativeShellBootstrapContext; target: Target; active: boolean; preferences: Readonly<{getSnapshot: () => PreferenceSnapshot; subscribe: (listener: () => void) => () => void}>; onBack: () => void; onOpenSettings: () => void;
}) {
  const closeRef = useRef<(() => Promise<void>) | undefined>(undefined);
  const theme = useTheme(), view = useRef<WebView>(null), host = useRef<ReturnType<typeof createReadingHost>>(undefined);
  const callbacks = useRef({onBack, onOpenSettings, active}); callbacks.current = {onBack, onOpenSettings, active};
  const [state, setState] = useState<Readonly<{url?: string; failed?: boolean}>>({}), [retry, setRetry] = useState(0);
  useEffect(() => {
    const life = new AbortController(), captured = context.session();
    if (!captured || !context.current()) return;
    let alive = true, session: ReadingSession | undefined;
    const apiCurrent = () => !life.signal.aborted && context.current() && context.session()?.sessionFamilyId === captured.sessionFamilyId;
    const current = () => alive && apiCurrent();
    const client = context.api.reading({viewer: captured.viewer, isCurrent: apiCurrent, signal: life.signal});
    const authority = context.subscribeAuthority(() => {if (!context.current()) life.abort();});
    const offPreferences = preferences.subscribe(() => {if (current()) host.current?.confirm();});
    let disposal: Promise<void> | undefined;
    const dispose = () => {
      if (disposal) return disposal;
      alive = false; authority(); offPreferences(); host.current?.dispose(); host.current = undefined;
      // Explicit close uses the captured current viewer, before local retirement.
      disposal = (async () => {
        const deadline = new AbortController(), timer = setTimeout(() => deadline.abort(), 2000);
        try {if (context.current()) await session?.close(deadline.signal);} finally {clearTimeout(timer); life.abort(); client.dispose();}
      })();
      return disposal;
    };
    closeRef.current = dispose;
    setState({});
    void (async () => {
      const versions = await client.versions(target.itemId, life.signal);
      if (!versions.versions.some(value => value.sourceId === target.sourceId && value.inventoryAvailable)) throw new Error('reading_unavailable');
      session = await client.open(target, life.signal);
      const initialProgress = await session.progress(life.signal);
      const bundle: unknown = await NativeModules.PorticoReaderAssets?.bundle();
      const url = bundle && typeof bundle === 'object' && 'url' in bundle ? bundle.url : undefined;
      if (!readerAssetEntry(url) || !current()) throw new Error('reader_assets_unavailable');
      host.current = createReadingHost({session, channel: routeBase64(nativeRouteCrypto.random(24)), preferences: preferences.getSnapshot,
        // Core fences ordinary packets. Its credentialless retirement packet
        // must still reach the captured guest after this authority has ended.
        initialProgress, current, send: message => {view.current?.injectJavaScript(readerDelivery(message));},
        onBack: () => {if (current() && callbacks.current.active) callbacks.current.onBack();}, onSettings: () => {if (current() && callbacks.current.active) callbacks.current.onOpenSettings();}});
      // The guest may handshake before the post-render activity effect runs.
      host.current.setActive(callbacks.current.active);
      setState({url});
    })().catch(() => {if (current()) {setState({failed: true});} void dispose().catch(() => {});});
    return () => {if (closeRef.current === dispose) closeRef.current = undefined; void dispose().catch(() => {});};
  }, [context, target, preferences, retry]);
  useEffect(() => {host.current?.setActive(active);}, [active, state.url]);
  return <View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: active ? 1 : 0}}>
    {state.failed ? <StateView variant="centered" title={defaultI18n.t('next.states.pageFailed')} body={defaultI18n.t('next.states.pageFailedBody')}
      primaryAction={{id: 'retry', label: defaultI18n.t('next.states.tryAgain'), onPress: () => setRetry(value => value + 1)}}/>
      : state.url ? <WebView ref={view} source={{uri: state.url}} style={{flex: 1, backgroundColor: theme.colors.ink}}
        originWhitelist={['*']} onShouldStartLoadWithRequest={request => readerNavigationAllowed(state.url!, request.url, request.isTopFrame)}
        injectedJavaScriptBeforeContentLoaded={__DEV__ ? readerStartupProbe : undefined}
        injectedJavaScriptBeforeContentLoadedForMainFrameOnly
        onMessage={event => {if (readerNavigationAllowed(state.url!, event.nativeEvent.url, true)) {
          if (__DEV__) {const diagnostic = readerStartupDiagnostic(event.nativeEvent.url, event.nativeEvent.data);
            if (diagnostic) {console.warn('portico_reader_startup', JSON.stringify(diagnostic)); return;}}
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
