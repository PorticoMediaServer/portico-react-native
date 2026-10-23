import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {ColourBackdrop} from '../../kit/artwork';
import {Icon} from '../../kit/Icon';
import {useTheme} from '../../kit/theme';
import {PushedNavBar, SettingsRow, ServerMark} from '../../kit/shell';
import {StateLayout} from '../../kit/states';
import {Focusable} from '../../kit/controls';

/** Presentation only. The captured read-only adapter supplies live, localized facts;
 * neither a credential nor a command/authority object enters these props. */
export type SignInSummaryProps = Readonly<{
  method: string; privacy: string; owner: string; ownerDetail?: string;
  progress?: Readonly<{heading: string; label: string; fraction: number}>;
  webURL: string;
  onBack: () => void; onOpenWeb: () => void; onPeople: () => void; onRemote: () => void;
}>;

/** Auth24g: phones read the actual method/owner/progress and open the server web page.
 * Television has a QR handoff, deliberately no Sign-in settings page or move mutation. */
export function SignInSummary({method, privacy, owner, ownerDetail, progress, webURL, onBack, onOpenWeb, onPeople, onRemote}: SignInSummaryProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), t = defaultI18n.t;
  if (theme.isTV) return <StateLayout testID="accounts-sign-in-web" title={t('accounts.settings.changeOnWeb')} body={t('settings.openOnWeb', {url: webURL})}
    beforeActions={<View style={{gap: 18, marginBottom: 28}}><QRCode value={webURL} size={240}/><Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{method}</Text></View>}
    secondaryAction={{id: 'back', label: t('action.back'), onPress: onBack}}/>;
  const group = {borderRadius: 16, overflow: 'hidden' as const, backgroundColor: theme.colors.raised, borderWidth: 1, borderColor: theme.colors.lineSoft};
  const link = (label: string, onPress: () => void, external = false) => <Focusable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} focusRadius={10}
    style={{minHeight: 48, paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: external ? 0 : 1, borderTopColor: theme.colors.lineSoft}}>
    {external && <Icon name="i-globe" size={18} color={theme.colors.textSecondary}/>}
    <Text style={[theme.type.body, {flex: 1, color: theme.colors.text}]}>{label}</Text>
    <Icon name={external ? 'i-ext' : 'i-right'} size={18} color={theme.colors.textSecondary}/>
  </Focusable>;
  return <View testID="accounts-sign-in-summary" style={{flex: 1, backgroundColor: theme.colors.ink, paddingTop: insets.top}}>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0}}><ColourBackdrop shape="top" height={340}/></View>
    <PushedNavBar backLabel={t('settings.title')} onBack={onBack}/>
    <ScrollView contentContainerStyle={{paddingHorizontal: 22, paddingTop: 18, paddingBottom: insets.bottom + 32, gap: 20}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 7}}><ServerMark variant="editorPhone"/>
        <Text style={[theme.type.captionStrong, {color: theme.colors.text}]}>{t('settings.heading.server')}</Text>
        <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('next.shell.serverVisibility.owner')}</Text>
      </View>
      <Text accessibilityRole="header" style={[theme.type.title, {fontSize: 32 * theme.textScale, color: theme.colors.text}]}>{t('accounts.settings.title')}</Text>
      {progress && <View style={{gap: 8}}><Text style={[theme.type.captionStrong, {color: theme.colors.textTertiary}]}>{progress.heading}</Text>
        <View style={[group, {padding: 14, gap: 10}]}><Text style={[theme.type.body, {color: theme.colors.text}]}>{progress.label}</Text>
          <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('accounts.settings.codesOnWeb')}</Text>
          <View accessibilityRole="progressbar" accessibilityValue={{min: 0, max: 100, now: Math.round(Math.max(0, Math.min(1, progress.fraction)) * 100)}} style={{height: 4, backgroundColor: theme.colors.lineSoft, borderRadius: 2}}>
            <View style={{height: 4, width: `${Math.max(0, Math.min(1, progress.fraction)) * 100}%`, backgroundColor: theme.colors.accentStrong, borderRadius: 2}}/>
          </View>
        </View>
      </View>}
      <View style={{gap: 8}}><Text style={[theme.type.captionStrong, {color: theme.colors.textTertiary}]}>{t('accounts.settings.method')}</Text>
        <View style={group}>
          <SettingsRow first label={t('accounts.settings.title')} description={privacy} control={<Text style={[theme.type.captionStrong, {color: theme.colors.accentStrong, backgroundColor: theme.colors.ink, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4}]}>{method}</Text>}/>
          <SettingsRow label={t('accounts.settings.owner')} description={ownerDetail} value={owner}/>
          {link(t('settings.server.people'), onPeople)}
          {link(t('next.settingsSpec.server.signin.groups.0.rows.7.label'), onRemote)}
        </View>
      </View>
      <View style={group}>{link(t('accounts.settings.changeOnWeb'), onOpenWeb, true)}</View>
    </ScrollView>
  </View>;
}
