import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AppState, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type {HostedSession} from '../../../../../packages/client-core/src/index';
import {nativeTVActivation} from '../../bridge/setup-codes';
import {useSession} from '../../app/session';
import {Button, Text, useTheme} from '../../ui';
import {AuthFrame} from './AuthFrame';
import {signInMessage} from '../../app/errors';
import {useI18n} from '../../app/i18n';
import {word} from '../../app/new-words';

/**
 * Television activation: a short code plus a QR link that the viewer approves
 * on a phone or computer. The service owns polling, expiry and cancellation.
 */
export function Activation({onApproved, onAccount, onDirect, onSavedServer}: {onApproved: () => void; onAccount: () => void; onDirect: () => void; /** APL-AUTH-01: go back to the saved server that is retrying. */ onSavedServer?: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space, colors} = useTheme();
  const service = useMemo(() => nativeTVActivation(session.hostedUrl), [session.hostedUrl]);
  const [state, setState] = useState(service.getSnapshot());
  const [error, setError] = useState('');
  const handled = useRef(false);
  useEffect(() => service.subscribe(() => setState(service.getSnapshot())), [service]);
  useEffect(() => {
    void service.start();
    const sub = AppState.addEventListener('change', s => {
      // Coming back to the app is a person asking again; a timed retry is not.
      if (s === 'active') { service.userActed(); void service.start(); }
      else service.pause();
    });
    return () => {
      sub.remove();
      service.pause();
    };
  }, [service]);
  useEffect(() => {
    if (state.phase !== 'approved' || !state.grant || handled.current) return;
    handled.current = true;
    const grant = state.grant as HostedSession;
    let accepted = true;
    session
      .activationApproved(grant, () => accepted)
      .then(() => service.complete(grant))
      .then(onApproved)
      .catch(e => {
        accepted = false;
        setError(signInMessage(e));
        // QA: never stay on "Approved, connecting" after a failed accept; that approval is spent,
        // so a fresh code replaces it and the error says what happened.
        void service.cancel().catch(() => {}).then(() => { handled.current = false; return service.start(); });
      });
  }, [state, session, service, onApproved]);
  const code = state.userCode ?? '';
  const link = state.verificationUriComplete ?? state.verificationUri ?? '';
  const host = state.verificationUri?.replace(/^https?:\/\//, '') ?? 'web.getportico.tv/device';
  // The television's front door: nothing to type. Scan or visit, approve on a phone, done;
  // the two buttons are for people who would rather use the remote.
  return (
    <AuthFrame title={i18n.t('activation.title')} lead={i18n.t('activation.lead', {host})} wide centered error={error || (state.phase === 'error' ? word('activation.failed', undefined, i18n) : '') || (onSavedServer ? '' : session.error)} onDismissError={() => { setError(''); session.clearError(); }}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xxl, minHeight: 300}}>
        {state.phase === 'waiting' && code && link ? (
          <View style={{padding: space.md, backgroundColor: colors.white, borderRadius: 12}}>
            <QRCode value={link} size={260} backgroundColor={colors.white} color={colors.ink} />
          </View>
        ) : null}
        <View style={{alignItems: 'center', gap: space.md, maxWidth: 640}}>
          {state.phase === 'waiting' && code ? (
            <>
              <Text variant="heading" tone="secondary">{host}</Text>
              <Text variant="display" style={{fontSize: 84, lineHeight: 96, letterSpacing: 10, fontVariant: ['tabular-nums']}}>{code}</Text>
              <Text variant="caption" tone="tertiary" align="center">{i18n.t('activation.codeRefreshes')}</Text>
            </>
          ) : state.phase === 'approved' ? (
            <Text variant="heading" tone="healthy">{i18n.t('launch.approvedConnecting')}</Text>
          ) : state.phase === 'denied' ? (
            <>
              <Text variant="body" tone="secondary" align="center">{i18n.t('activation.declined')}</Text>
              <Button variant="secondary" label={i18n.t('activation.getNewCode')} onPress={() => { service.userActed(); void service.start(); }} />
            </>
          ) : (
            <>
              <Text variant="body" tone="secondary" align="center">{state.phase === 'error' ? i18n.t('activation.codeFailed') : i18n.t('activation.preparingCode')}</Text>
              {state.phase === 'error' ? <Button variant="secondary" label={i18n.t('action.tryAgain')} onPress={() => { service.userActed(); void service.start(); }} /> : null}
            </>
          )}
        </View>
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'center', gap: space.md}}>
        <Button variant="primary" size="lg" label={i18n.t('auth.signInWithAccount')} hasTVPreferredFocus onPress={onAccount} />
        <Button variant="secondary" size="lg" label={i18n.t('auth.signInDirectly')} onPress={onDirect} />
        {onSavedServer ? <Button variant="ghost" size="lg" label={i18n.t('auth.backToSavedServer')} onPress={onSavedServer} /> : null}
      </View>
      <Text variant="caption" tone="tertiary" align="center">{i18n.t('activation.termsNote')}</Text>
    </AuthFrame>
  );
}
