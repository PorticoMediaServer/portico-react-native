import React, {useLayoutEffect, useRef, useState} from 'react';
import {NativeModules, View, useWindowDimensions} from 'react-native';
import WebView from 'react-native-webview';
import type {PreferenceSnapshot} from '../../../../../packages/client-core/src/preferences';
import type {ReadingHostSearchAll, ReadingHostContentsTarget} from '../../../../../packages/client-core/src/reading-host';
import {LoadingPaint, SkeletonBlock, StateView} from '../../kit/states';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {useTheme} from '../../kit/theme';
import {Button} from '../../kit/controls/Button';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {usePlatformPosture} from '../../platform/platformPosture';
import {readerAssetEntry} from './asset-origin';
import {createReadingGuestBridge, ReadingGuestView} from './ReadingGuestView';
import type {createReadingSessionOwner} from './reading-session-owner';

type Owner = ReturnType<typeof createReadingSessionOwner>;
type Reader = ReturnType<typeof createReadingGuestBridge>;

/** One disposable rendering ticket over an already accepted logical session. */
export function NativeReadingGuestHost({owner, active, preferences, onBack, onSettings, onSearchAll, contentsTarget}: {
  owner: Owner; active: boolean; preferences: Readonly<{getSnapshot: () => PreferenceSnapshot; subscribe: (listener: () => void) => () => void}>;
  onBack: () => void; onSettings: () => void; onSearchAll?: ReadingHostSearchAll; contentsTarget?: ReadingHostContentsTarget;
}) {
  const theme = useTheme(), view = useRef<WebView>(null), reader = useRef<Reader | undefined>(undefined);
  const dimensions = useWindowDimensions(), insets = useSafeAreaInsets(), posture = usePlatformPosture();
  const crease = posture.status === 'available' && posture.window?.width === dimensions.width && posture.window.height === dimensions.height
    ? posture.folds.find(value => value.orientation === 'vertical' && value.bounds.left > 0 && value.bounds.left <= value.bounds.right && value.bounds.right <= dimensions.width)?.bounds : undefined;
  const creaseRef = useRef(crease); creaseRef.current = crease;
  const disposeGuest = useRef<(() => void) | undefined>(undefined);
  const callbacks = useRef({active, onBack, onSettings, onSearchAll}); callbacks.current = {active, onBack, onSettings, onSearchAll};
  const [state, setState] = useState<Readonly<{url?: string; reader?: Reader; failed?: boolean}>>({});
  const [attempt, setAttempt] = useState(0);
  useLayoutEffect(() => {
    let alive = true, owned: Reader | undefined, ticket: ReturnType<Owner['attach']> | undefined, offPreferences = () => {};
    const current = () => {if (!alive || !ticket?.current()) return false;
      return owner.current() && alive && !!ticket?.current();};
    const dispose = () => {if (!alive) return; alive = false; offPreferences(); owned?.dispose();
      if (reader.current === owned) reader.current = undefined; ticket?.release();};
    disposeGuest.current = dispose; setState({});
    void (async () => {
      ticket = owner.attach(); ticket.onRetire(dispose); if (!current()) throw new Error('reading_retired');
      const bundle: unknown = await NativeModules.PorticoReaderAssets?.bundle();
      const url = bundle && typeof bundle === 'object' && 'url' in bundle ? bundle.url : undefined;
      if (!readerAssetEntry(url) || !current()) throw new Error('reader_assets_unavailable');
      owned = createReadingGuestBridge({session: ticket.session, initialProgress: ticket.initialProgress,
        preferences: preferences.getSnapshot, current, initialContentsTarget: contentsTarget,
        ...(creaseRef.current ? {crease: {left: creaseRef.current.left, right: creaseRef.current.right}} : {}),
        onBack: () => {if (current() && callbacks.current.active) callbacks.current.onBack();},
        onSettings: () => {if (current() && callbacks.current.active) callbacks.current.onSettings();},
        ...(onSearchAll ? {onSearchAll: (query, signal, isLive) => current() && callbacks.current.active && !!callbacks.current.onSearchAll
          ? callbacks.current.onSearchAll(query, signal, isLive) : false} : {}),
        onUnavailable: () => {if (current()) setState({failed: true}); dispose();},
      }, view, () => {});
      if (!current()) {owned.dispose(); throw new Error('reading_retired');}
      reader.current = owned; owned.setActive(callbacks.current.active);
      offPreferences = preferences.subscribe(() => {if (current()) owned?.confirm();});
      if (!current()) throw new Error('reading_retired');
      setState({url, reader: owned});
    })().catch(() => {if (current()) setState({failed: true}); dispose();});
    return () => {if (disposeGuest.current === dispose) disposeGuest.current = undefined; dispose();};
  }, [owner, preferences, attempt, !!onSearchAll, contentsTarget]);
  useLayoutEffect(() => {reader.current?.setActive(active);}, [active, state.reader]);
  useLayoutEffect(() => {reader.current?.setCrease(crease ? {left: crease.left, right: crease.right} : undefined);}, [crease, state.reader]);
  const failure = () => {if (!state.reader || reader.current !== state.reader) return; setState({failed: true}); disposeGuest.current?.();};
  return <View pointerEvents={active ? 'auto' : 'none'} accessibilityElementsHidden={!active} importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink, opacity: active ? 1 : 0}}>
    {state.failed ? <StateView variant="centered" title={defaultI18n.t('next.states.pageFailed')} body={defaultI18n.t('next.states.pageFailedBody')}
      primaryAction={{id: 'retry', label: defaultI18n.t('next.states.tryAgain'), disabled: !active || !owner.current(), onPress: () => setAttempt(value => value + 1)}}/>
      : <LoadingPaint ready={!!state.url} immediate={!!state.url} skeleton={<SkeletonBlock width="100%" style={{flex: 1}}/>}>
        {state.url && state.reader ? <ReadingGuestView url={state.url} view={view} reader={state.reader} currentReader={() => reader.current}
          backgroundColor={theme.colors.ink} observeBridge={() => {}} onFailure={failure}/> : null}
      </LoadingPaint>}
    {!state.url || state.failed ? <View pointerEvents="box-none" style={{position: 'absolute', left: 12, top: insets.top + 8, zIndex: 20}}>
      <Button testID="native-read-host-back" variant="icon" size="compact" icon="i-left" iconOnly
        accessibilityLabel={defaultI18n.t('action.back')} focusRadius={dimensions.width >= 700 ? 22 : 19}
        onPress={() => {if (callbacks.current.active) onBack();}}
        style={{height: dimensions.width >= 700 ? 44 : 38, width: dimensions.width >= 700 ? 44 : 38, paddingHorizontal: 0}}/>
    </View> : null}
  </View>;
}
