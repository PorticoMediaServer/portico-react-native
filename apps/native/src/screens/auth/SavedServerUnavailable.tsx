import React, {useEffect, useRef, useState} from 'react';
import {AppState, View} from 'react-native';
import {friendlyHost} from '../../app/content';
import {useOffline} from '../../app/downloads';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {Button, Ring, Surface, Text, useTheme} from '../../ui';
import {AuthFrame} from './AuthFrame';

const BACKOFF_SECONDS = [2, 4, 8, 15, 30, 60];

/**
 * APL-AUTH-01: a remembered server that cannot be reached right now. The person is still signed
 * in, so this is not the sign-in page: it retries on its own with backoff (and whenever the app
 * returns to the foreground), says so truthfully, and keeps downloads and other servers reachable
 * without discarding the saved sign-in.
 */
export function SavedServerUnavailable({onDownloads, onElsewhere}: {onDownloads: () => void; onElsewhere: () => void}) {
  const session = useSession();
  const {space, isTV} = useTheme();
  const kept = useOffline().entries.some(e => e.state === 'ready');
  const i18n = useI18n();
  const host = friendlyHost(session.recovery?.serverUrl);
  const [attempt, setAttempt] = useState(0);
  const [remaining, setRemaining] = useState(BACKOFF_SECONDS[0]);
  const resume = useRef(session.resumeSaved);
  resume.current = session.resumeSaved;
  const busy = session.busy;
  // Count down to the next automatic attempt; each failure waits longer, up to a minute.
  useEffect(() => {
    if (busy) return;
    const wait = BACKOFF_SECONDS[Math.min(attempt, BACKOFF_SECONDS.length - 1)];
    setRemaining(wait);
    const started = Date.now();
    const timer = setInterval(() => {
      const left = wait - Math.floor((Date.now() - started) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(timer);
        setAttempt(a => a + 1);
        void resume.current();
      }
    }, 500);
    return () => clearInterval(timer);
  }, [attempt, busy]);
  // Coming back to the app is a good moment to try at once (the network may have changed).
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void resume.current();
    });
    return () => sub.remove();
  }, []);
  const tryNow = () => {
    setAttempt(0);
    void resume.current();
  };
  return (
    <AuthFrame title={host ? i18n.t('savedServer.title', {host}) : i18n.t('savedServer.titleGeneric')} lead={i18n.t('savedServer.lead')} centered={isTV} wide={isTV}>
      <Surface style={{alignItems: 'center', gap: space.md}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
          {busy ? <Ring size={isTV ? 28 : 18} thickness={2} /> : null}
          <Text variant="body" tone="secondary" accessibilityLiveRegion="polite">{busy ? i18n.t('savedServer.checking') : i18n.t('savedServer.retryIn', {seconds: remaining})}</Text>
        </View>
        <Text variant="caption" tone="tertiary" align="center">{i18n.t('savedServer.help')}</Text>
      </Surface>
      <View style={{gap: space.sm, alignItems: isTV ? 'center' : 'stretch'}}>
        <Button variant="primary" size="lg" label={i18n.t('action.tryAgain')} fullWidth={!isTV} loading={busy} hasTVPreferredFocus onPress={tryNow} />
        {kept ? <Button variant="secondary" icon="download" label={i18n.t('action.watchDownloads')} fullWidth={!isTV} onPress={onDownloads} /> : null}
        <Button variant="ghost" label={i18n.t('action.useAnotherServerOrAccount')} fullWidth={!isTV} onPress={onElsewhere} />
      </View>
    </AuthFrame>
  );
}
