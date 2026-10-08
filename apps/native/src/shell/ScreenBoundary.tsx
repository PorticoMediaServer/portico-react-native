import React, {useEffect, useState} from 'react';
import {TVFocusGuideView, View} from 'react-native';
import {CommonActions, useIsFocused, useNavigation} from '@react-navigation/native';
import {Button, NavScope, StateView, useTheme} from '../ui';
import {useConnectionStatus} from '../app/connection-context';
import {CONNECTION_EXEMPT_SCREENS, connectionView} from '../app/connection-status';
import {useI18n} from '../app/i18n';
import {ReconnectingStatus} from './ReconnectingStatus';

export {CONNECTION_EXEMPT_SCREENS, connectionView};

/**
 * Per-screen boundary. A render failure inside one screen shows a calm state
 * in that screen's place while the rail or tab bar and the stack stay alive,
 * so the viewer can go back or switch destination. The root boundary in
 * App.tsx remains the last resort for failures outside the navigator.
 */
type State = {error?: Error};
class Boundary extends React.Component<{children: React.ReactNode; onBack?: () => void; onHome: () => void; resetKey: string}, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return {error}; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // The details go to the console (and the device log) only; never to the screen.
    console.error('Screen render failed:', error.message, '\n', error.stack, '\n', info.componentStack);
  }
  componentDidUpdate(prev: {resetKey: string}) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({error: undefined});
  }
  render() {
    if (!this.state.error) return this.props.children;
    return <Fallback onRetry={() => this.setState({error: undefined})} onBack={this.props.onBack} onHome={this.props.onHome} />;
  }
}

/** APL-SYS-04 / Justin's rule: catalogue copy only. A raw error never reaches the screen, in any build. */
function Fallback({onRetry, onBack, onHome}: {onRetry: () => void; onBack?: () => void; onHome: () => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  return (
    <View style={{flex: 1, justifyContent: 'center'}}>
      <StateView icon="warning" title={i18n.t('route.errorTitle')} message={i18n.t('error.screenCrashed')} action={i18n.t('action.tryAgain')} onAction={onRetry} />
      <View style={{flexDirection: 'row', justifyContent: 'center', gap: space.sm, marginTop: -space.md}}>
        {onBack ? <Button variant="ghost" icon="back" label={i18n.t('action.back')} onPress={onBack} /> : null}
        <Button variant="ghost" icon="home" label={i18n.t('route.goHome')} onPress={onHome} />
      </View>
    </View>
  );
}

/** Wraps a stack screen so its failures stay inside the screen area. */
export function guarded<P extends object>(Screen: React.ComponentType<P>): (props: P & {route: {key: string; name: string}}) => React.JSX.Element {
  // PERF-08: a covered screen re-renders only when its own props (route, navigation) change, not
  // on every push or pop above it.
  const MemoScreen = React.memo(Screen) as unknown as React.ComponentType<P>;
  const Guarded = (props: P & {route: {key: string; name: string}}) => {
    // Every hook first, before any conditional return (§4a).
    const navigation = useNavigation();
    const {isTV} = useTheme();
    const focused = useIsFocused();
    const status = useConnectionStatus();
    // The status generation this screen's content was mounted with. When the status clears, the
    // screen remounts its content (reloading its data) once it is focused.
    const [mountedGeneration, setMountedGeneration] = useState(status.generation);
    useEffect(() => {
      if (focused && status.generation !== mountedGeneration) setMountedGeneration(status.generation);
    }, [focused, status.generation, mountedGeneration]);
    const view = connectionView({name: props.route.name, status, mountedGeneration, focused});
    // While the status shows, it replaces the screen's content (which unmounts, so no card shows
    // its own error). Exempt screens (Settings, Servers, Account, About, Downloads, Gallery) keep
    // rendering normally whatever the connection does.
    const body =
      view === 'status' ? (
        <ReconnectingStatus />
      ) : (
        <Boundary key={mountedGeneration} resetKey={props.route.key} onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} onHome={() => navigation.dispatch(CommonActions.navigate({name: 'HomeRoot', params: {screen: 'Home', pop: true}}))}>
          {/* Each screen has its own navigation-bar scope (its scroll position and its title). */}
          <NavScope><MemoScreen {...props} /></NavScope>
        </Boundary>
      );
    // Television: a screen covered by a pushed one must leave the focus engine
    // (its late data loads would otherwise pull focus), and autoFocus gives
    // each screen its own memory so Back returns to the card you came from.
    return isTV ? <TVFocusGuideView focusable={focused} autoFocus style={{flex: 1}}>{body}</TVFocusGuideView> : body;
  };
  Guarded.displayName = `Guarded(${Screen.displayName ?? Screen.name ?? 'Screen'})`;
  return Guarded;
}
