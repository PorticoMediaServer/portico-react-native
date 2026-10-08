import React, {useCallback, useEffect, useState, useRef} from 'react';
import {BackHandler, Linking} from 'react-native';
import {useSession} from '../../app/session';
import {useTheme} from '../../ui';
import {Activation} from './Activation';
import {accountScreen} from './sign-in-steps';
import {DirectProfiles} from './DirectProfiles';
import {DirectSignIn} from './DirectSignIn';
import {PorticoLanding} from './PorticoLanding';
import {HostedSignIn} from './HostedSignIn';
import {AccountHelp} from './AccountHelp';
import {OfflineDownloadsScreen} from './OfflineDownloads';
import {JoinServer} from '../Invitation';
import {heldJoinLink, holdJoinLink, releaseJoinLink} from '../../app/join-link';
import {stepAfterEnding, type AuthStep} from '../../app/sign-in-ended';

let remembered: Step = 'welcome';
type Step = AuthStep;

/**
 * Sequences the pre-authentication screens. A signed-in Portico Account with
 * no selected server lands in the shell, where its server opens; a direct account with several
 * profiles lands on the profile picker.
 */
export function AuthFlow({onSavedServer}: {/** APL-AUTH-01: return to the saved server that could not be reached (it keeps retrying). */ onSavedServer?: () => void} = {}) {
  const session = useSession();
  const {isTV} = useTheme();
  // The flow can be remounted underneath the person (the session provider re-renders its gate
  // while a server is being contacted); where they were must survive that.
  // A sign-in that ended opens where it can be renewed (Justin, 23 Sep): the direct form with the
  // address filled in, or the Portico Account flow (the shell landing when the account is signed in).
  const hinted = (): Step | undefined => {
    const hint = session.signInHint;
    if (!hint) return undefined;
    return stepAfterEnding(hint.authority, !!session.hosted, isTV);
  };
  const [step, setStepState] = useState<Step>(() => { const next = hinted(); if (next) remembered = next; return next ?? remembered; });
  const setStep = (next: Step) => { remembered = next; setStepState(next); };
  useEffect(() => {
    const next = hinted();
    if (!next) return;
    session.clearSignInHint();
    setStep(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.signInHint]);
  useEffect(() => {
    if (session.hosted && step !== 'landing' && step !== 'direct' && !session.recovery) setStep('landing');
  }, [session.hosted, step, session.recovery]);
  // Development only: portico://dev/auth/<step> opens a sign-in step directly, so a screen the
  // simulator cannot be driven to can still be looked at.
  useEffect(() => {
    if (!__DEV__) return;
    const sub = Linking.addEventListener('url', ({url}) => { const m = /^portico:\/\/dev\/auth\/(welcome|hosted|direct|create|forgot)$/.exec(url); if (m) setStep(m[1] as Step); });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A server's invitation link while signed out: the join screen, after a Portico Account sign-in.
  const [joining, setJoining] = useState(() => !!heldJoinLink());
  useEffect(() => {
    const take = (url: string | null) => { if (url && holdJoinLink(url)) setJoining(true); };
    void Linking.getInitialURL().then(take, () => {});
    const sub = Linking.addEventListener('url', ({url}) => take(url));
    return () => sub.remove();
  }, []);
  const directBack = useRef<(() => void) | null>(null);
  const leaveDirect = useCallback(() => { session.direct.resetPin(); session.clearError(); setStep('welcome'); }, [session]);
  // Television Menu walks back one step instead of leaving the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (session.direct.pending) {
        session.direct.cancelPending();
        return true;
      }
      if (step === 'welcome') return false;
      if (step === 'landing') return false;
      if (step === 'offline') { setStep('welcome'); return true; }
      // QA (TV): the same cleanup as each screen's Back button, one sub-step at a time.
      if (step === 'direct') {
        if (directBack.current) directBack.current();
        else leaveDirect();
        return true;
      }
      session.clearError();
      setStep('welcome');
      return true;
    });
    return () => sub.remove();
  }, [step, session, leaveDirect]);
  // APP-03: what is already on the device stays reachable while the server is
  // not. It is checked before the other steps so a failed resume cannot pull the
  // person back to sign-in while they are watching.
  if (step === 'offline') return <OfflineDownloadsScreen onBack={() => setStep('welcome')} />;
  if (session.direct.pending) return <DirectProfiles onCancel={session.direct.cancelPending} />;
  if (joining && session.hosted) return <JoinServer link={heldJoinLink()} onDone={() => { releaseJoinLink(); setJoining(false); }} />;
  // Justin: a Portico Account lands in the shell at once; its server opens there (or is chosen
  // there, or says what failed there), never on a separate "Choose a server" screen.
  if (step === 'landing' && session.hosted) return <PorticoLanding onSignOut={() => { session.signOut(); setStep('welcome'); }} onDirect={() => { session.clearError(); setStep('direct'); }} />;
  const direct = () => { session.clearError(); setStep('direct'); };
  const account = () => { session.clearError(); setStep('hosted'); };
  if (step === 'create' || step === 'forgot') return <AccountHelp mode={step} onBack={() => setStep('welcome')} onSignedIn={() => setStep('landing')} />;
  if (step === 'direct') return <DirectSignIn backRef={directBack} onBack={leaveDirect} />;
  // Television opens on the code, because a remote is a poor keyboard; handhelds open on the form.
  if (accountScreen(isTV) === 'activation') return step === 'hosted' ? <HostedSignIn onBack={() => setStep('welcome')} onSignedIn={() => setStep('landing')} /> : <Activation onApproved={() => setStep('landing')} onAccount={account} onDirect={direct} onSavedServer={onSavedServer} />;
  return <HostedSignIn onSignedIn={() => setStep('landing')} onDirect={direct} onCreate={() => setStep('create')} onForgot={() => setStep('forgot')} onDownloads={() => setStep('offline')} onSavedServer={onSavedServer} />;
}
