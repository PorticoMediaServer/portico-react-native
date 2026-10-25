import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {BackHandler, ScrollView, Text, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {FocusProvider, FocusRegion} from '../../kit/focus';
import {NativeTVKeyboard} from '../search/TVKeyboard';
import {ColourBackdrop} from '../../kit/artwork';
import {Button, TextField} from '../../kit/controls';
import {nativeType, useTheme} from '../../kit/theme';

type Props = {busy: boolean; error?: React.ReactNode; isCurrent: () => boolean; onBack: () => void;
  onJoin: (invitation: string, address: string) => void; onFind: () => void; onRefresh: () => void; onSignOut: () => void};
const addressKeys = ['abcdef', 'ghijkl', 'mnopqr', 'stuvwx', 'yz1234', '567890', '.:/-_@'].map(row => [...row]);
const invitationKeys = ['ABCDEF', 'GHIJKL', 'MNOPQR', 'STUVWX', 'YZ1234', '567890', '-_'].map(row => [...row]);
type Ticket = {live: boolean; scope: object};

/** Empty authenticated directory only. Joining still uses the parent's original
 * invitation parser, issuer inspection and normal account continuation. */
export function TVNoServers(props: Props) {
  const theme = useTheme(), t = defaultI18n.t;
  const [joining, setJoining] = useState(false), [address, setAddress] = useState(''), [invitation, setInvitation] = useState('');
  const [field, setField] = useState<'address' | 'invitation'>('address');
  const draft = useMemo(() => Object.freeze({joining, address, invitation, field}), [joining, address, invitation, field]);
  const latest = useRef(draft); latest.current = draft;
  const scope = useMemo(() => ({isCurrent: props.isCurrent}), [props.isCurrent]);
  const active = useRef<Ticket | undefined>(undefined), [committed, setCommitted] = useState<Ticket>();
  if (active.current && active.current.scope !== scope) {active.current.live = false; active.current = undefined;}
  useLayoutEffect(() => {const ticket = {live: true, scope}; active.current = ticket; setCommitted(ticket);
    return () => {ticket.live = false; if (active.current === ticket) active.current = undefined;};}, [scope]);
  const current = useCallback(() => !!committed?.live && committed.scope === scope && active.current === committed && props.isCurrent(), [committed, scope, props.isCurrent]);
  const owns = () => current() && latest.current === draft && !props.busy;
  const back = useCallback(() => {if (!current()) return; if (joining) {setInvitation(''); setJoining(false);} else props.onBack();}, [current, joining, props.onBack]);
  useEffect(() => {const subscription = BackHandler.addEventListener('hardwareBackPress', () => {if (!joining || !current()) return false; back(); return true;});
    return () => subscription.remove();}, [joining, current, back]);
  return <FocusProvider><View testID="tv-no-servers" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <ColourBackdrop shape="top"/>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding: 64, gap: 28}}>
      <Button variant="text" disabled={props.busy} onPress={back} style={{alignSelf: 'flex-start'}}>{t('action.back')}</Button>
      <View style={{gap: 12}}>
        <Text style={[theme.type.captionStrong, {color: theme.colors.textSecondary}]}>{t('services.start.ready')}</Text>
        <Text accessibilityRole="header" style={[nativeType({size: 44, lineHeight: 52, weight: 700, tracking: -.03}, theme.textScale), {color: theme.colors.text}]}>{t(joining ? 'services.start.join' : 'services.start.welcome')}</Text>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t(joining ? 'web.directJoin.entryBody' : 'services.start.body')}</Text>
        {props.error}
      </View>
      {joining ? <FocusRegion id="accounts.empty.fields" entry="address" order={['address', 'invitation', 'join']} style={{maxWidth: 1100, gap: 20}}>
        <TextField focusId="address" label={t('accounts.signIn.address')} value={address} onFocus={() => {if (current()) setField('address');}} showSoftInputOnFocus={false} editable={!props.busy} autoCapitalize="none" autoCorrect={false}
          onChangeText={value => {if (owns()) setAddress(value);}}/>
        <TextField focusId="invitation" label={t('services.start.invitation')} value={invitation} onFocus={() => {if (current()) setField('invitation');}} showSoftInputOnFocus={false} editable={!props.busy} autoCapitalize="none" autoCorrect={false} autoComplete="off"
          onChangeText={value => {if (owns()) setInvitation(value);}}/>
        <NativeTVKeyboard id={`accounts.empty.keyboard.${field}`} value={field === 'address' ? address : invitation}
          rows={field === 'address' ? addressKeys : invitationKeys} width={500} leftRegionId="accounts.empty.fields"
          activation={{visible: current() && !props.busy, intent: 'enter', revision: field === 'address' ? 0 : 1}}
          onChangeText={value => {if (owns()) {if (field === 'address') setAddress(value); else setInvitation(value);}}}/>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('services.start.whereBody')}</Text>
        <Button focusId="join" disabled={props.busy || !invitation.trim()} onPress={() => {if (owns()) {setInvitation(''); props.onJoin(draft.invitation, draft.address);}}}>{t('services.start.joinAction')}</Button>
      </FocusRegion> : <View style={{flexDirection: 'row', gap: 40, alignItems: 'flex-start'}}>
        <View style={{flex: 1, gap: 18, padding: 28, borderRadius: 20, backgroundColor: theme.colors.raised}}>
          <Button hasTVPreferredFocus disabled={props.busy} onPress={() => {if (owns()) setJoining(true);}}>{t('services.start.join')}</Button>
          <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('services.start.joinBody')}</Text>
          <Button variant="text" disabled={props.busy} onPress={() => {if (current()) props.onRefresh();}}>{t('accounts.servers.refresh')}</Button>
        </View>
        <View style={{flex: 1, gap: 18, padding: 28, borderRadius: 20, backgroundColor: theme.colors.raised}}>
          <Text accessibilityRole="header" style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('services.start.setup')}</Text>
          <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('services.start.phoneSetupBody')}</Text>
          <View accessible accessibilityLabel="https://getportico.tv/download/" style={{padding: 16, alignSelf: 'flex-start', backgroundColor: theme.colors.white, borderRadius: 16}}>
            <QRCode value="https://getportico.tv/download/" size={220}/>
          </View>
          <Text selectable style={[theme.type.caption, {color: theme.colors.textSecondary}]}>getportico.tv/download/</Text>
        </View>
      </View>}
      <View style={{flexDirection: 'row', gap: 24}}>
        <Button variant="text" disabled={props.busy} onPress={() => {if (current()) props.onFind();}}>{t('connection.discovery.find')}</Button>
        <Button variant="text" disabled={props.busy} onPress={() => {if (current()) props.onSignOut();}}>{t('accounts.signOut.portico')}</Button>
      </View>
    </ScrollView>
  </View></FocusProvider>;
}
