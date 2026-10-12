import React from 'react';
import {StatusBar, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {PreferencesProvider, usePreferences} from './src/app/preferences';
import {SessionProvider, useSession} from './src/app/session';
import {AuthFlow} from './src/screens/auth/AuthFlow';
import {DirectProfiles} from './src/screens/auth/DirectProfiles';
import {Shell} from './src/shell/Shell';
import {useLinkIntake} from './src/shell/link-intents';
import {clearTopShelf} from './src/app/top-shelf';
import {ErrorBoundary} from './src/shell/ErrorBoundary';
import {Atmosphere, Ring, ThemeProvider, Wordmark, useTheme} from './src/ui';

function Root() {
  const session = useSession();
  // Links from outside the app are taken here, whatever is on screen, and held for the shell.
  useLinkIntake(session.session?.viewer);
  // Signed out (the shell and everything in it are gone): the Apple TV home screen must not go on
  // showing the last profile's titles.
  const signedOut = session.phase === 'signedOut';
  React.useEffect(() => { if (signedOut) clearTopShelf(); }, [signedOut]);
  // Justin's rule: the app always opens into the shell. A remembered sign-in is shown at once and
  // confirmed in the background (the shell's banner says how that is going); sign-in appears only
  // when there is no sign-in at all, or after "Use another server or account" / "Sign in again".
  if (session.phase === 'restoring') return <Connecting />;
  if (session.phase !== 'ready') return <AuthFlow onSavedServer={session.recovery ? session.openSaved : undefined} />;
  if (session.direct.pending) return <DirectProfiles onCancel={session.direct.cancelPending} />;
  return <Shell />;
}

/** The moment the remembered sign-in is read from this device (no network): the brand and a ring. */
function Connecting() {
  const {space, isTV} = useTheme();
  return (
    <View style={{flex: 1}}>
      <Atmosphere />
      <View style={{flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.xl}}>
        <Wordmark height={isTV ? 56 : 32} />
        <Ring size={isTV ? 44 : 28} thickness={isTV ? 3 : 2} />
      </View>
    </View>
  );
}

function Themed({children}: {children: React.ReactNode}) {
  const {preferences} = usePreferences();
  // TV "Text size" device preference (F-core); 1.2 when large.
  const textSize = (preferences as {textSize?: string}).textSize;
  return <ThemeProvider reduceMotion={preferences.reduceMotion} textScale={textSize === 'large' ? 1.2 : 1}>{children}</ThemeProvider>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <PreferencesProvider>
        <Themed>
          <SessionProvider>
            <StatusBar barStyle="light-content" />
            <ErrorBoundary><Root /></ErrorBoundary>
          </SessionProvider>
        </Themed>
      </PreferencesProvider>
    </SafeAreaProvider>
  );
}


