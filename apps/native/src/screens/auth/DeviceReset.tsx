import React, {useState} from 'react';
import {View} from 'react-native';
import {useI18n} from '../../app/i18n';
import {word} from '../../app/new-words';
import {useSession} from '../../app/session';
import {Button, ConfirmSheet, Ring, Text, useTheme} from '../../ui';
import {AuthFrame} from './AuthFrame';

/**
 * This device can no longer read its saved sign-in: the system lost the key that protects what
 * Portico saved here (seen on Android before version 12 and on Fire OS, usually after a system
 * update). A new sign-in could not be kept either, so this is shown in place of the sign-in
 * screens. It says what happened in one sentence and offers the one thing that fixes it: reset
 * what this device saved, after confirming, and sign in again. "Try again" looks once more first,
 * for the rare case where the system was only slow to answer.
 */
export function DeviceReset() {
  const session = useSession();
  const reset = session.deviceReset;
  const i18n = useI18n();
  const {space, isTV} = useTheme();
  const [confirming, setConfirming] = useState(false);
  const [state, setState] = useState<'idle' | 'working' | 'reopen'>('idle');
  const [error, setError] = useState('');
  if (!reset) return null;
  const run = async (work: () => Promise<'restarting' | 'reopen'>) => {
    setError('');
    setState('working');
    try {
      // 'restarting': the app is about to start again and this screen goes with it.
      if ((await work()) === 'reopen') setState('reopen');
    } catch {
      setState('idle');
      setError(word('signIn.reset.failed', undefined, i18n));
    }
  };
  return (
    <AuthFrame title={word('signIn.reset.title', undefined, i18n)} lead={word('signIn.reset.body', undefined, i18n)} centered={isTV} wide={isTV} error={error} onDismissError={() => setError('')}>
      {state === 'idle' ? (
        <View style={{gap: space.sm, alignItems: isTV ? 'center' : 'stretch'}}>
          <Button variant="primary" size="lg" label={word('signIn.reset.action', undefined, i18n)} fullWidth={!isTV} hasTVPreferredFocus onPress={() => setConfirming(true)} />
          <Button variant="ghost" label={i18n.t('action.tryAgain')} fullWidth={!isTV} onPress={() => void run(reset.tryAgain)} />
        </View>
      ) : (
        <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: isTV ? 'center' : 'flex-start', gap: space.sm}}>
          {state === 'working' ? <Ring size={isTV ? 28 : 18} thickness={2} /> : null}
          <Text variant="body" tone="secondary" accessibilityLiveRegion="polite">{word(state === 'working' ? 'signIn.reset.working' : 'signIn.reset.reopen', undefined, i18n)}</Text>
        </View>
      )}
      <ConfirmSheet
        open={confirming}
        onDismiss={() => setConfirming(false)}
        title={word('signIn.reset.confirmTitle', undefined, i18n)}
        consequence={word('signIn.reset.consequence', undefined, i18n)}
        confirmLabel={word('signIn.reset.confirm', undefined, i18n)}
        describeError={() => word('signIn.reset.failed', undefined, i18n)}
        onConfirm={async () => {
          // A failure stays in the confirmation, where the person can try again or cancel.
          const outcome = await reset.reset();
          setConfirming(false);
          setState(outcome === 'reopen' ? 'reopen' : 'working');
        }}
      />
    </AuthFrame>
  );
}
