import React from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {BottomSheet} from '../../kit/overlays';
import {Button} from '../../kit/controls';
import {useTheme} from '../../kit/theme';

export function PhoneSetupApproval({display, busy, error, onClose, onApprove}: {
  display: {serverName: string; address: string; accountName: string}; busy: boolean; error?: React.ReactNode;
  onClose: () => void; onApprove: () => void;
}) {
  const theme = useTheme(), t = defaultI18n.t;
  return <View style={{flex: 1, backgroundColor: theme.colors.ink}}><BottomSheet open title={t('web.claim.title', {server: display.serverName})}
    testID="accounts-setup-approval" fitContent dismissOnOutsidePress={!busy} dismissOnBack={!busy}
    onOpenChange={open => {if (!open && !busy) onClose();}}
    footer={<View style={{flexDirection: 'row', gap: 12}}>
      <View style={{flex: 1}}><Button variant="glass" disabled={busy} onPress={onClose}>{t('action.cancel')}</Button></View>
      <View style={{flex: 1}}><Button disabled={busy} onPress={onApprove}>{t('web.claim.approve')}</Button></View>
    </View>}>
    <View style={{gap: 18}}>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('web.claim.becomesOwnerOf', {account: display.accountName, server: display.serverName})}</Text>
      <View style={{gap: 4}}><Text style={[theme.type.body, {color: theme.colors.text}]}>{display.serverName}</Text>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{new URL(display.address).host}</Text></View>
      <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('web.claim.checkAddress')}</Text>
      {error}
    </View>
  </BottomSheet></View>;
}
