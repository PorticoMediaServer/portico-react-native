import React from 'react';
import {StatusBar, View} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {PreferencesProvider, usePreferences} from './src/app/preferences';
import {SessionProvider, useSession} from './src/app/session';
import {AuthFlow} from './src/screens/auth/AuthFlow';
import {DirectProfiles} from './src/screens/auth/DirectProfiles';
import {Shell} from './src/shell/Shell';
import {useLinkIntake} from './src/shell/link-intents';
import {linkViewerKey} from './src/shell/pending-link';
import {signInMode} from './src/app/sign-in-mode';
import {SignInElsewhere} from './src/screens/auth/SignInElsewhere';
import {clearTopShelf} from './src/app/top-shelf';
import {ErrorBoundary} from './src/shell/ErrorBoundary';
import {Atmosphere, Ring, ThemeProvider, Wordmark, useMenuKey, useTheme} from './src/ui';

function Root() {
  const session = useSession();
  // Links from outside the app are taken here, whatever is on screen, and held for the shell.
  useLinkIntake(session.session?.viewer);
  // Android TV and Fire TV: the remote's Menu key, wherever focus is.
  useMenuKey();
  // Signed out (the shell and everything in it are gone): the Apple TV home screen must not go on
  // showing the last profile's titles.
  const signedOut = session.phase === 'signedOut';
  React.useEffect(() => { if (signedOut) clearTopShelf(); }, [signedOut]);
  // Who is signed in: a sign-in begun while signed in belongs to them and ends with them. The
  // session says when that sign-in is accepted and when the viewer is only set aside for a moment
  // (a new viewer being checked), so neither is read from who happens to be on screen.
  const viewer = session.phase === 'ready' ? linkViewerKey(session.session?.viewer) : null;
  const elsewhere = React.useSyncExternalStore(signInMode.subscribe, () => signInMode.current(viewer));
  const handingOver = React.useSyncExternalStore(signInMode.subscribe, signInMode.handingOver);
  React.useEffect(() => signInMode.settle(viewer), [viewer, handingOver]);
  // Justin (18 Oct 2026): browsing (the shell: its rail, tab bar, screens, their providers and
  // requests) is mounted only for a signed-in viewer with a profile, and never during a sign-in.
  // Signed out, choosing a profile, or signing in elsewhere is the whole screen; the shell is gone,
  // so nothing can move into it and links wait for it. A device's own sign-in, remembered from
  // before, still opens straight into the shell and is confirmed in the background (the shell's
  // status says how that is going).
  // Nobody is signed in while a sign-in's new viewer is checked: that sign-in (or its profiles)
  // stays on screen, and the shell stays unmounted, until the new viewer is in or the old one is back.
  if (session.phase === 'restoring') return <Connecting />;
  if (session.phase !== 'ready' && !elsewhere) return <AuthFlow onSavedServer={session.recovery ? session.openSaved : undefined} />;
  if (session.direct.pending) return <DirectProfiles onCancel={session.direct.cancelPending} />;
  if (elsewhere) return <SignInElsewhere request={elsewhere} />;
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


