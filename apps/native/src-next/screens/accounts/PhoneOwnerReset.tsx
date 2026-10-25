import React from 'react';
import {Text, View} from 'react-native';
import type {ResetFileLocation} from '../../../../../packages/client-core/src/account-reset';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {StateLayout} from '../../kit/states';
import {TextField} from '../../kit/controls';
import {useTheme} from '../../kit/theme';

export function PhoneOwnerReset({phase, serverName, location, code, onCodeChange, busy, error, onBack, onWrite, onVerify, onContinue}: {
  phase: 'intro' | 'code' | 'done'; serverName: string; location?: ResetFileLocation; code: string; onCodeChange: (value: string) => void;
  busy: boolean; error?: React.ReactNode; onBack: () => void; onWrite: () => void; onVerify: () => void; onContinue: () => void;
}) {
  const theme = useTheme(), t = defaultI18n.t;
  const back = {id: 'back', label: t('action.back'), disabled: busy, onPress: onBack};
  if (phase === 'done') return <StateLayout testID="accounts-owner-reset-done" title={t('accounts.recovery.ownerSessionTitle')}
    body={t('accounts.recovery.ownerSessionBody')} beforeActions={<>{error}<Text style={[theme.type.body, {color: theme.colors.textSecondary, marginBottom: 18}]}>{t('accounts.recovery.ownerSessionHelp')}</Text></>}
    primaryAction={{id: 'open-server', label: t('accounts.recovery.continueServer', {server: serverName}), disabled: busy, loading: busy, onPress: onContinue}} secondaryAction={back}/>;
  if (phase === 'code') {
    const separator = location?.systemKind === 'windows' ? '\\' : '/';
    const path = location ? location.fileDirectory.replace(/[\\/]+$/, '') + separator + location.fileName : undefined;
    return <StateLayout testID="accounts-owner-reset-code" title={t('accounts.recovery.fileTitle')} body={t('accounts.recovery.fileBody')}
      beforeActions={<View style={{alignSelf: 'stretch', gap: 14, marginBottom: 18}}>{error}
        {path && <View><Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('accounts.recovery.fileLocation')}</Text><Text selectable style={[theme.type.caption, {color: theme.colors.text}]}>{path}</Text></View>}
        <TextField label={t('accounts.recovery.code')} value={code} onChangeText={onCodeChange} editable={!busy} autoCapitalize="characters" autoCorrect={false} autoComplete="off"/>
      </View>}
      primaryAction={{id: 'verify-reset-code', label: t('action.continue'), disabled: busy || !code.trim(), loading: busy, onPress: onVerify}} secondaryAction={back}/>;
  }
  return <StateLayout testID="accounts-owner-reset-intro" title={t('accounts.signIn.cannotUsePortico')} body={t('accounts.recovery.porticoBody')}
    beforeActions={<View style={{alignSelf: 'stretch', gap: 14, marginBottom: 18}}>{error}<Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{serverName}</Text>
      <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('accounts.recovery.fileHelp')}</Text>
      <View style={{gap: 4}}><Text style={[theme.type.body, {color: theme.colors.text}]}>{t('accounts.recovery.notOwner')}</Text>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('accounts.recovery.notOwnerBody')}</Text></View>
    </View>}
    primaryAction={{id: 'write-reset-file', label: t('accounts.recovery.writeFile'), disabled: busy, loading: busy, onPress: onWrite}} secondaryAction={back}/>;
}
