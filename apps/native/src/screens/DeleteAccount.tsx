import React, {useCallback, useEffect, useState} from 'react';
import {NativeModules, View} from 'react-native';
import {HttpLocalApi, parseDeletionPreview, parseDeletionReceipt, type DeletionPreview} from '../../../../packages/client-core/src/index';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {nativeNetworkFetch} from '../bridge/server-connections';
import {Field, Notice, Sheet, Text, rowPaddingX, showToast, useSpecPlatform, useTheme} from '../ui';

/**
 * Deleting a Portico Account from the app (A80; App Store 5.1.1(v): an app that creates accounts
 * lets people delete them in the app). The signed-in session is the authority: no password. The
 * preview says what the deletion affects; the person confirms by typing the account's email (its
 * username when it has none). An account that still owns servers must transfer or remove them
 * first, on the web.
 */
export function DeleteAccountSheet({open, onClose}: {open: boolean; onClose: () => void}) {
  const session = useSession();
  const i18n = useI18n();
  const {space} = useTheme();
  const pad = rowPaddingX(useSpecPlatform());
  const credentials = session.credentials;
  const hostedUrl = session.hostedUrl;
  const [preview, setPreview] = useState<DeletionPreview>();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const request = useCallback(async (path: string, body: unknown) => {
    if (!credentials) throw new Error(i18n.t('account.delete.changed'));
    const live = await credentials.accessSession();
    return new HttpLocalApi(hostedUrl, live.accessToken, nativeNetworkFetch).request<unknown>(path, 'POST', body);
  }, [credentials, hostedUrl, i18n]);
  const load = useCallback(async () => {
    setPreview(undefined);
    setFailure('');
    try {
      const operationId: string = await NativeModules.PorticoRuntime.newRequestId();
      setPreview(parseDeletionPreview(await request('/v1/account/deletion/preview', {purpose: 'account_deletion_preview', target: '', operationId})));
    } catch (e) {
      setFailure(say(e, 'account', 'load'));
    }
  }, [request]);
  useEffect(() => {
    if (!open) return;
    setTyped('');
    void load();
  }, [open, load]);
  const remove = async () => {
    if (!preview) return;
    setBusy(true);
    setFailure('');
    try {
      // Accepted: the account is gone (servers it was on finish removing its profiles on their own).
      parseDeletionReceipt(await request('/v1/account/deletion', {deletionToken: preview.deletionToken, disposition: preview.requiredDisposition ?? '', confirmation: typed.trim()}));
      onClose();
      showToast({message: i18n.t('account.delete.done'), icon: 'check'});
      session.signOut();
    } catch (e) {
      const code = (e as {code?: unknown})?.code;
      if (code === 'deletion_confirmation_mismatch') setFailure(i18n.t('account.delete.mismatch'));
      else if (code === 'deletion_preview_changed') { setFailure(i18n.t('account.delete.changed')); void load(); }
      else setFailure(say(e, 'account', 'save'));
    } finally {
      setBusy(false);
    }
  };
  const names = (servers: {name: string}[]) => servers.map(s => s.name).join(', ');
  const blocked = !!preview && !preview.canDelete;
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={i18n.t('account.delete.title')}
      primary={blocked ? undefined : {label: i18n.t('account.delete.action'), tone: 'destructive', loading: busy, disabled: !preview || !typed.trim(), onPress: () => void remove()}}>
      <View style={{gap: space.md, paddingHorizontal: pad}}>
        {!preview && !failure ? <Text variant="body" tone="secondary">{i18n.t('account.delete.checking')}</Text> : null}
        {blocked ? <Notice tone="info" message={i18n.t('account.delete.ownsServers', {servers: names(preview.ownedServers)})} /> : null}
        {preview && !blocked ? (
          <>
            <Text variant="body" tone="secondary">{i18n.t('account.delete.consequence')}</Text>
            {preview.affectedServers.length ? <Text variant="body" tone="secondary">{i18n.t('account.delete.affects', {servers: names(preview.affectedServers)})}</Text> : null}
            <Field label={i18n.t('account.delete.typeEmail')} hint={i18n.t('account.delete.typeEmailHelp')} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" textContentType="emailAddress" />
          </>
        ) : null}
        {failure ? <Text variant="caption" tone="danger" accessibilityRole="alert">{failure}</Text> : null}
      </View>
    </Sheet>
  );
}
