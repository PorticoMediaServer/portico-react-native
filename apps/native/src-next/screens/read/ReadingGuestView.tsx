import React from 'react';
import WebView from 'react-native-webview';
import type {createReadingHost} from '../../../../../packages/client-core/src';
import {readerNavigationAllowed} from './asset-origin';
import {readerStartupDiagnostic, readerStartupProbe} from './startup-diagnostics';

type Reader = ReturnType<typeof createReadingHost>;

/** Credential-free native view. The captured reader must still own this view
 * when a message or an error arrives; an old view cannot address its successor. */
export function ReadingGuestView({url, view, reader, currentReader, backgroundColor, observeBridge, onFailure}: {
  url: string; view: React.RefObject<WebView | null>; reader: Reader;
  currentReader: () => Reader | undefined; backgroundColor: string;
  observeBridge: (direction: 'guest-to-host' | 'host-to-guest', message: string) => void;
  onFailure: () => void;
}) {
  return <WebView ref={view} source={{uri: url}} style={{flex: 1, backgroundColor}}
    originWhitelist={['*']} onShouldStartLoadWithRequest={request => readerNavigationAllowed(url, request.url, request.isTopFrame)}
    injectedJavaScriptBeforeContentLoaded={__DEV__ ? readerStartupProbe : undefined}
    injectedJavaScriptBeforeContentLoadedForMainFrameOnly
    onMessage={event => {if (currentReader() === reader && readerNavigationAllowed(url, event.nativeEvent.url, true)) {
      if (__DEV__) {const diagnostic = readerStartupDiagnostic(event.nativeEvent.url, event.nativeEvent.data);
        if (diagnostic) {console.warn('portico_reader_startup', JSON.stringify(diagnostic)); return;}}
      observeBridge('guest-to-host', event.nativeEvent.data); reader.receive(event.nativeEvent.data);
    }}}
    renderError={() => <></>} incognito cacheEnabled={false} sharedCookiesEnabled={false} thirdPartyCookiesEnabled={false} domStorageEnabled={false}
    allowFileAccess={false} allowFileAccessFromFileURLs={false} allowUniversalAccessFromFileURLs={false} mixedContentMode="never"
    javaScriptCanOpenWindowsAutomatically={false} setSupportMultipleWindows={false} onOpenWindow={() => {}}
    onError={onFailure} onContentProcessDidTerminate={onFailure} onRenderProcessGone={onFailure}/>;
}
