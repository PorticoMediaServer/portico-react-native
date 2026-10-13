import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import {HttpLocalApi} from '../../../../packages/client-core/src/index';
import {SetupCodeApprover, type SetupPreview} from '../../../../packages/client-core/src/setup-code';
import {useSession} from '../app/session';
import {nativeNetworkFetch} from '../bridge/server-connections';
import {Button, Field, Notice, Sheet, Text, useTheme} from '../ui';
import {ShownError, say as presentedMessage} from '../app/errors';
import {useI18n} from '../app/i18n';

/** IOS-LINKTV-01: ABCD-1234 as it's typed or pasted; the dash goes in after four characters. */
function formatCode(text: string): string {
  const raw = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw;
}

// APL-SYS-04: errors are presented by code; the old per-call fallback text is no longer shown.
const say = (e: unknown, _fallback?: string) => presentedMessage(e, 'devices', 'action');
const platforms: Record<string, string> = {tvos: 'Apple TV', androidtv: 'Android TV', firetv: 'Fire TV', vega: 'Fire TV', webos: 'LG TV', tizen: 'Samsung TV', roku: 'Roku', web: 'Web browser', ios: 'iPhone or iPad', android: 'Android'};

/**
 * Sign a television in from the phone: type the code the TV is showing, check it is the right
 * TV, approve. A Portico Account signs the TV in to the account; someone signed in directly to
 * a server as its owner signs the TV in to that server.
 */
export function LinkTVSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space} = useTheme();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<SetupPreview>();
  const [done, setDone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const approver = useRef<SetupCodeApprover | undefined>(undefined);
  useEffect(() => { if (open) { setCode(''); setPreview(undefined); setDone(''); setError(''); } }, [open]);
  const hosted = !!session.hosted && !!session.credentials;
  // IOS-LINKTV-01 / TV-AUTH-01: anyone signed in directly can approve a TV for their own profile
  // (Quick Connect); the server decides what that TV may do.
  const local = session.session?.viewer.authority === 'local';
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); } catch (e) { setError(say(e)); } finally { setBusy(false); }
  };
  const review = () => run(async () => {
    if (hosted) {
      const live = await session.credentials!.accessSession();
      approver.current = new SetupCodeApprover(new HttpLocalApi(session.hostedUrl, live.accessToken, nativeNetworkFetch), 'hosted');
    } else if (local && session.api) approver.current = new SetupCodeApprover(session.api, 'local');
    else throw new ShownError(i18n.t('linkTV.signInFirst'));
    setPreview(await approver.current.review(code));
  });
  const decide = (decision: 'approve' | 'deny') => run(async () => {
    if (!preview || !approver.current) return;
    await approver.current.decide(preview, decision);
    setDone(decision === 'approve' ? i18n.t('linkTV.approved', {device: preview.deviceName || i18n.t('linkTV.yourTV')}) : i18n.t('linkTV.declined'));
  });
  if (done) return <Sheet open={open} onClose={onClose} title={i18n.t('settings.linkTV')} footer={<Button variant="primary" label={i18n.t('action.done')} onPress={onClose} />}><Text variant="body" tone="secondary">{done}</Text></Sheet>;
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('settings.linkTV')} subtitle={preview ? i18n.t('linkTV.askConfirm') : i18n.t('linkTV.enterCode')}
      footer={preview
        ? <View style={{flexDirection: 'row', gap: space.sm}}><Button variant="ghost" label={i18n.t('web.device.notMine')} disabled={busy} onPress={() => void decide('deny')} /><Button variant="primary" label={i18n.t('web.device.signItIn')} loading={busy} onPress={() => void decide('approve')} /></View>
        : <Button variant="primary" label={i18n.t('action.continue')} loading={busy} disabled={code.replace(/[^A-Za-z0-9]/g, '').length < 6} onPress={() => void review()} />}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        {preview ? (
          <>
            <Text variant="heading">{preview.deviceName || i18n.t('linkTV.genericTV')}</Text>
            <Text variant="body" tone="secondary">{[platforms[preview.platform] ?? preview.platform, preview.appVersion ? `Portico ${preview.appVersion}` : ''].filter(Boolean).join(' · ')}</Text>
            <Text variant="caption" tone="tertiary">{i18n.t('linkTV.approveCaption', {where: hosted ? i18n.t('linkTV.scopeAccount') : i18n.t('linkTV.scopeServer')})}</Text>
          </>
        ) : (
          <Field label={i18n.t('auth.code')} /* lint-strings-allow: ABCD-1234 is a code format example, not copy */ placeholder="ABCD-1234" value={code} onChangeText={t => setCode(formatCode(t))} autoCapitalize="characters" textContentType="oneTimeCode" autoCorrect={false} maxLength={12} autoFocus returnKeyType="go" onSubmitEditing={() => void review()} />
        )}
      </View>
    </Sheet>
  );
}
