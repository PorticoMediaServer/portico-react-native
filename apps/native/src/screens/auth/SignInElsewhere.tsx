import React, {useCallback, useEffect, useRef} from 'react';
import {BackHandler, TVEventControl} from 'react-native';
import {useTheme} from '../../ui';
import {useI18n} from '../../app/i18n';
import {useSession, type SessionValue} from '../../app/session';
import {signInMode, type SignInRequest} from '../../app/sign-in-mode';
import {DirectSignIn} from './DirectSignIn';
import {HostedChooser} from './HostedChooser';

/**
 * Leaving a sign-in begun while signed in: whatever it had under way is abandoned (a sign-in or
 * connection, a server's further step, first-run setup), so it cannot finish behind the viewer,
 * and what it showed is cleared. The viewer signed in is not touched.
 */
export function leaveSignIn(session: Pick<SessionValue, 'direct' | 'clearError' | 'saved'>): void {
  session.direct.cancel();
  // Everything else it began (an account's server being opened, a code, a Quick Connect) can no
  // longer sign in either, so a late answer cannot switch servers after Back, whatever the
  // remembered sign-in is doing: this leaves its confirmation and retries alone.
  session.direct.abandon();
  // A further step is released. Without one, the step's generation is not moved while a sign-in
  // this device remembered is not yet confirmed: that check would be abandoned with it.
  if (session.direct.step || !session.saved) session.direct.cancelStep();
  if (session.direct.setup) session.direct.cancelSetup();
  session.direct.resetPin();
  session.clearError();
  signInMode.close();
}

/**
 * Signing in elsewhere while signed in (`sign-in-mode.ts`), on the whole screen like any sign-in:
 * the account's servers, or one server by its address. Back (the button, the remote's Back or Menu)
 * walks back through the sign-in's own steps and then leaves it, back to the viewer signed in.
 */
export function SignInElsewhere({request}: {request: SignInRequest}) {
  const session = useSession();
  const i18n = useI18n();
  const {isTV} = useTheme();
  const leave = useCallback(() => leaveSignIn(session), [session]);
  // Apple TV: Menu is held while the sign-in shows, so it goes back rather than leaving the app.
  useEffect(() => {
    if (!isTV) return;
    TVEventControl.enableTVMenuKey();
    return () => TVEventControl.disableTVMenuKey();
  }, [isTV]);
  // The direct form's own step back (the code to the address, a further step to the form).
  const directBack = useRef<(() => void) | null>(null);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (request.kind === 'direct' && directBack.current) directBack.current();
      else leave();
      return true;
    });
    return () => sub.remove();
  }, [request.kind, leave]);
  if (request.kind === 'direct') return <DirectSignIn backRef={directBack} onBack={leave} />;
  // A named server opens once: its profiles cancelled, the account's servers are listed instead.
  return <HostedChooser title={i18n.t('servers.switch')} initialServerId={request.serverId} onInitialOpened={signInMode.targetOpened} onBack={leave} />;
}
