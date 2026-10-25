import React, {useLayoutEffect, useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {parseJoinLink} from '../../../../../packages/client-core/src/join-link';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {ColourBackdrop} from '../../kit/artwork';
import {Button, TextField} from '../../kit/controls';
import {nativeType, useTheme} from '../../kit/theme';

/** Empty directory only: discovery and invitation entry still prove their server. */
export function PhoneNoServers({busy, error, onFind, onRefresh, onShare, onSignOut, onBack, onJoin}: {
  busy: boolean; error?: React.ReactNode; onFind: () => void; onRefresh: () => void;
  onJoin: (invitation: string, address: string) => void; onShare: () => void; onSignOut: () => void; onBack?: () => void;
}) {
  const [invitation, setInvitation] = useState(''), [address, setAddress] = useState('');
  const theme = useTheme(), insets = useSafeAreaInsets(), t = defaultI18n.t;
  const link = parseJoinLink(invitation);
  const opening = useRef<{active: boolean; invitation: string; address: string} | undefined>(undefined);
  const latestBusy = useRef(busy); latestBusy.current = busy;
  if (!opening.current || !opening.current.active || opening.current.invitation !== invitation || opening.current.address !== address) {
    if (opening.current) opening.current.active = false;
    opening.current = {active: true, invitation, address};
  }
  const ticket = opening.current;
  useLayoutEffect(() => {if (opening.current === ticket) ticket.active = true; return () => {ticket.active = false;};}, [ticket]);
  const current = () => ticket.active && opening.current === ticket && !latestBusy.current;
  const changeAddress = (raw: string) => {if (!current() || raw === ticket.address) return; ticket.active = false; setAddress(raw);};
  const changeInvitation = (raw: string) => {if (!current() || raw === ticket.invitation) return; ticket.active = false; setInvitation(raw);
    const target = parseJoinLink(raw); if (target) setAddress(target.server);};
  const join = () => {if (!current() || !ticket.invitation.trim()) return; ticket.active = false; onJoin(ticket.invitation, ticket.address);};
  return <View testID="phone-no-servers" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ColourBackdrop shape="top"/>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal: 24, paddingTop: insets.top + 24, paddingBottom: Math.max(24, insets.bottom + 16), gap: 20}}>
      {onBack && <Button variant="text" disabled={busy} onPress={onBack} style={{alignSelf: 'flex-start'}}>{t('action.back')}</Button>}
      <View style={{gap: 12}}>
        <Text accessibilityRole="header" style={[nativeType({size: 30, lineHeight: 34, weight: 700, tracking: 0}, theme.textScale), {color: theme.colors.text}]}>{t('web.hostedAccount.noServers')}</Text>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('web.chooser.noneBody')}</Text>
        {error}
      </View>
      <View style={{gap: 12, padding: 16, borderRadius: 16, backgroundColor: theme.colors.raised}}>
        <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('web.directJoin.title')}</Text>
        <TextField label={t('accounts.signIn.address')} value={link?.server ?? address} onChangeText={changeAddress} autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={!busy && !link}/>
        <TextField label={t('services.start.invitation')} placeholder={t('web.directJoin.codePlaceholder')} value={invitation} onChangeText={changeInvitation} autoCapitalize="none" autoCorrect={false} autoComplete="off" editable={!busy}/>
        <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('web.directJoin.entryBody')}</Text>
        <Button disabled={busy || !invitation.trim()} onPress={join}>{t('action.continue')}</Button>
      </View>
      <View style={{gap: 10}}>
        <Button variant="glass" disabled={busy} onPress={onFind}>{t('connection.discovery.find')}</Button>
        <Button variant="text" disabled={busy} onPress={onRefresh}>{t('accounts.servers.refresh')}</Button>
      </View>
      <View style={{gap: 12, padding: 16, borderRadius: 16, backgroundColor: theme.colors.raised}}>
        <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('services.start.setup')}</Text>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('services.start.phoneSetupBody')}</Text>
        <Button variant="glass" disabled={busy} onPress={onShare}>{t('services.start.shareLink')}</Button>
      </View>
      <Button variant="text" disabled={busy} onPress={onSignOut}>{t('accounts.signOut.portico')}</Button>
    </ScrollView>
  </View>;
}
