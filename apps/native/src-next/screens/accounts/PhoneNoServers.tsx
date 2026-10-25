import React, {useState} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {StateLayout} from '../../kit/states';
import {Button, TextField} from '../../kit/controls';
import {useTheme} from '../../kit/theme';

/** Empty directory only: discovery still proves a server through AccountEntry. */
export function PhoneNoServers({busy, error, onFind, onRefresh, onShare, onSignOut, onBack, onJoin}: {
  busy: boolean; error?: React.ReactNode; onFind: () => void; onRefresh: () => void;
  onJoin: (link: string) => void; onShare: () => void; onSignOut: () => void; onBack?: () => void;
}) {
  const [invitation, setInvitation] = useState('');
  const theme = useTheme(), t = defaultI18n.t;
  return <StateLayout testID="phone-no-servers" icon="i-server" title={t('web.hostedAccount.noServers')}
    body={t('web.chooser.noneBody')} beforeActions={<View style={{alignSelf: 'stretch', gap: 12, marginBottom: 18}}>{error}
      <TextField label={t('services.start.invitation')} value={invitation} onChangeText={setInvitation} autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={!busy}/>
      <Button variant="glass" disabled={busy || !invitation.trim()} onPress={() => onJoin(invitation)}>{t('services.start.joinAction')}</Button>
    </View>}
    primaryAction={{id: 'find-server', label: t('connection.discovery.find'), disabled: busy, onPress: onFind}}
    secondaryAction={{id: 'refresh-directory', label: t('accounts.servers.refresh'), disabled: busy, onPress: onRefresh}}
    detailsAction={onBack ? {id: 'back', label: t('action.back'), disabled: busy, onPress: onBack} : undefined}>
    <View style={{alignSelf: 'stretch', gap: 12, marginTop: 24}}>
      <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('services.start.setup')}</Text>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('services.start.phoneSetupBody')}</Text>
      <Button variant="glass" disabled={busy} onPress={onShare}>{t('services.start.shareLink')}</Button>
      <Button variant="text" disabled={busy} onPress={onSignOut}>{t('accounts.signOut.portico')}</Button>
    </View>
  </StateLayout>;
}
