import React, {useEffect, useMemo, useRef, useState} from 'react';
import {AppState, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import type {HttpLocalApi, LocalSession} from '../../../../../packages/client-core/src/index';
import {friendlyHost} from '../../app/content';
import {signInMessage} from '../../app/errors';
import {useI18n} from '../../app/i18n';
import {useSession} from '../../app/session';
import {nativeQuickConnect} from '../../bridge/setup-codes';
import {Button, Text, useTheme} from '../../ui';
import {AuthFrame} from './AuthFrame';
import {approvalLink} from '../../app/approval-link';

/**
 * TV-AUTH-01: sign a television in to a server directly without typing a password. The TV shows a
 * code; someone already signed in to that server approves it from Portico on their phone
 * (Settings → Link a TV) or on the web. Only the server's address is typed with the remote.
 */
export function QuickConnect({api, onPassword, onBack}: {api: HttpLocalApi; onPassword: () => void; onBack: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space, colors} = useTheme();
  const service = useMemo(() => nativeQuickConnect(api), [api]);
  const [state, setState] = useState(service.getSnapshot());
  const [error, setError] = useState('');
  const handled = useRef(false);
  useEffect(() => service.subscribe(() => setState(service.getSnapshot())), [service]);
  useEffect(() => {
    void service.start();
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') void service.start();
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
    const issued = state.grant as LocalSession;
    session.direct
      .acceptSession(api, issued)
      .then(() => service.complete(issued))
      .catch(e => {
        setError(signInMessage(e));
        // QA: a failed accept starts over with a new code instead of staying on "Approved, connecting".
        void service.cancel().catch(() => {}).then(() => { handled.current = false; return service.start(); });
      });
  }, [state, session.direct, service, api]);
  const code = state.userCode ?? '';
  const host = friendlyHost(api.baseUrl) ?? i18n.t('quickConnect.yourServer');
  // The code is approved on this server (its web app's /device page, or Settings → Link a TV in
  // the app), never on the account service: a link that points anywhere else is replaced by this
  // server's own page.
  const link = approvalLink(api.baseUrl, state.verificationUriComplete ?? state.verificationUri, code);
  return (
    <AuthFrame title={i18n.t('quickConnect.title', {host})} lead={i18n.t('quickConnect.lede', {host})} wide centered onBack={onBack} error={error || (state.phase === 'error' ? i18n.t('quickConnect.failed') : '')} onDismissError={() => setError('')}>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xxl, minHeight: 300}}>
        {state.phase === 'waiting' && code && link ? (
          <View style={{padding: space.md, backgroundColor: colors.white, borderRadius: 12}}>
            <QRCode value={link} size={240} backgroundColor={colors.white} color={colors.ink} />
          </View>
        ) : null}
        <View style={{alignItems: 'center', gap: space.md, maxWidth: 640}}>
          {state.phase === 'waiting' && code ? (
            <>
              <Text variant="display" style={{fontSize: 84, lineHeight: 96, letterSpacing: 10, fontVariant: ['tabular-nums']}}>{code}</Text>
              <Text variant="caption" tone="tertiary" align="center">{i18n.t('activation.codeRefreshes')}</Text>
            </>
          ) : state.phase === 'approved' ? (
            <Text variant="heading" tone="healthy">{i18n.t('launch.approvedConnecting')}</Text>
          ) : state.phase === 'denied' ? (
            <>
              <Text variant="body" tone="secondary" align="center">{i18n.t('activation.declined')}</Text>
              <Button variant="secondary" label={i18n.t('activation.getNewCode')} onPress={() => void service.start()} />
            </>
          ) : (
            <Text variant="body" tone="secondary" align="center">{state.phase === 'error' ? i18n.t('quickConnect.noCode') : `${i18n.t('quickConnect.gettingCode')}…`}</Text>
          )}
        </View>
      </View>
      <View style={{flexDirection: 'row', justifyContent: 'center', gap: space.md}}>
        {state.phase === 'error' ? <Button variant="primary" size="lg" label={i18n.t('action.tryAgain')} hasTVPreferredFocus onPress={() => void service.start()} /> : null}
        <Button variant={state.phase === 'error' ? 'secondary' : 'primary'} size="lg" label={i18n.t('quickConnect.usePassword')} hasTVPreferredFocus={state.phase !== 'error'} onPress={() => { void service.cancel().catch(() => {}); onPassword(); }} />
      </View>
    </AuthFrame>
  );
}

