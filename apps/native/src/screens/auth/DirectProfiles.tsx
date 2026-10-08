import React, {useEffect, useState} from 'react';
import {BackHandler, TVEventControl, View} from 'react-native';
import {parseDirectSnapshot, type ManagedProfile} from '../../../../../packages/client-core/src/profile-management';
import {useSession} from '../../app/session';
import {Focusable, Icon, PinEntry, StateView, Text, useTheme} from '../../ui';
import {useI18n} from '../../app/i18n';
import {AuthFrame} from './AuthFrame';
import {say} from '../../app/errors';
import {ProfileAvatar, useProfilePictures} from './ProfileAvatar';

/**
 * Profile chooser for a direct (server credential) account. Shown after
 * sign-in when the account has more than one profile, and when switching.
 */
export function DirectProfiles({onCancel}: {onCancel: () => void}) {
  const session = useSession();
  const {space, colors, isTV} = useTheme();
  const pending = session.direct.pending;
  const [profiles, setProfiles] = useState<readonly ManagedProfile[] | undefined>(pending?.snapshot?.profiles);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [pinFor, setPinFor] = useState<ManagedProfile>();
  const [pin, setPin] = useState('');
  const [pinKey, setPinKey] = useState(0);
  const i18n = useI18n();
  useEffect(() => {
    if (!pending || pending.snapshot) return;
    let active = true;
    setLoadError('');
    pending.api
      // QA: the account snapshot (profiles included) is `GET /v1/direct`; there is no GET on /profiles.
      .request('/v1/direct')
      .then(raw => {
        if (active) setProfiles(parseDirectSnapshot(raw).profiles);
      })
      .catch(e => {
        if (__DEV__) console.warn('[profiles] load failed', (e as {status?: number})?.status, (e as {code?: string})?.code, String(e)); // lint-raw-errors-allow: __DEV__ logging, never rendered
        if (active) setLoadError(say(e, 'profiles', 'load'));
      });
    return () => {
      active = false;
    };
  }, [pending, attempt]);
  // QA (TV): Menu goes back (AuthFlow cancels the chooser) instead of leaving the app, so the
  // Menu key is held while the chooser is up.
  useEffect(() => {
    if (!isTV) return;
    TVEventControl.enableTVMenuKey();
    return () => TVEventControl.disableTVMenuKey();
  }, [isTV]);
  // Switching profiles (signed in) shows the chooser on its own, outside the sign-in flow, so it
  // handles Back itself: the PIN step goes back to the faces, the faces go back to the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pinFor) setPinFor(undefined);
      else onCancel();
      return true;
    });
    return () => sub.remove();
  }, [pinFor, onCancel]);
  const avatar = isTV ? 180 : 88;
  // APL-SYS-10: uploaded pictures, read with the account grant (choosing) or the profile session (switching).
  const pictures = useProfilePictures(pending?.api, pending?.accountSession?.accessToken ?? session.session?.accessToken, avatar);
  if (!pending) return null;
  const choose = (profile: ManagedProfile) => {
    if (profile.pinRequired) {
      setPinFor(profile);
      setPin('');
      return;
    }
    void session.direct.chooseProfile(profile.id);
  };
  // APL-AUTH-09: a wrong PIN clears the pad and says so; the session's error is the reason.
  const submitPin = async (value: string) => {
    if (!pinFor) return;
    await session.direct.chooseProfile(pinFor.id, value);
    setPin('');
    setPinKey(k => k + 1);
  };
  return (
    <AuthFrame title={pinFor ? i18n.t('auth.enterProfilePin') : i18n.t('auth.whosWatching')} centered={isTV} wide={isTV && !pinFor} onBack={isTV ? undefined : pinFor ? () => setPinFor(undefined) : onCancel} error={pinFor || (!profiles && loadError) ? undefined : loadError || session.error} onDismissError={session.clearError}>
      {pinFor ? (
        <View style={{alignItems: isTV ? 'center' : 'flex-start', gap: space.md}}>
          <Text variant="body" tone="secondary">{pinFor.name}</Text>
          <PinEntry value={pin} onChange={setPin} onComplete={value => void submitPin(value)} label={i18n.t('pin.fourDigit')} error={session.error || undefined} errorKey={pinKey} disabled={session.busy} />
        </View>
      ) : !profiles && loadError ? (
        // QA: a failed load says so and offers another try, instead of spinning forever.
        <StateView icon="warning" title={loadError} action={i18n.t('action.tryAgain')} onAction={() => setAttempt(n => n + 1)} />
      ) : !profiles ? (
        <StateView loading title={i18n.t('auth.loadingProfiles')} />
      ) : (
        // APL-AUTH-03: one focus treatment (a ring hugging the avatar, a gentle lift), centred on TV.
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: isTV ? space.xl : space.lg, justifyContent: isTV ? 'center' : 'flex-start'}}>
          {profiles.map((profile, index) => (
            <Focusable key={profile.id} accessibilityRole="button" radius={avatar / 2} ring={false} scale={isTV ? 1.08 : 1} disabled={session.busy} onPress={() => choose(profile)} hasTVPreferredFocus={index === 0} accessibilityLabel={profile.name} style={{alignItems: 'center', width: avatar + 40}}>
              {({focused}) => (
                <>
                  <ProfileAvatar name={profile.name} art={profile.art} source={pictures.get(profile.id)} size={avatar} focused={focused} />
                  <Text variant={isTV ? 'bodyStrong' : 'captionStrong'} align="center" lines={1} style={{marginTop: space.sm}}>{profile.name}</Text>
                  {profile.pinRequired ? <Icon name="lock" size={14} color={colors.textTertiary} /> : null}
                </>
              )}
            </Focusable>
          ))}
        </View>
      )}
    </AuthFrame>
  );
}
