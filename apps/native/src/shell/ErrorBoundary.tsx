import React from 'react';
import {View} from 'react-native';
import {Atmosphere, StateView} from '../ui';
import {defaultI18n} from '../../../../packages/i18n/src/index';

/**
 * Last-resort boundary. A render crash shows a calm screen with a retry
 * instead of a blank window, and the stack goes to the console so a
 * connected developer can read it.
 */
type State = {error?: Error};
export class ErrorBoundary extends React.Component<{children: React.ReactNode}, State> {
  state: State = {};
  static getDerivedStateFromError(error: Error): State { return {error}; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Render failed:', error.message, '\n', error.stack, '\n', info.componentStack);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={{flex: 1}}>
        <Atmosphere />
        {/* Justin's rule: catalogue copy only; the error itself goes to the console above, never the screen.
            Try again mounts the app afresh. */}
        <StateView icon="warning" title={defaultI18n.t('route.errorTitle')} message={defaultI18n.t('error.screenCrashed')} action={defaultI18n.t('action.tryAgain')} onAction={() => this.setState({error: undefined})} style={{flex: 1}} />
      </View>
    );
  }
}
