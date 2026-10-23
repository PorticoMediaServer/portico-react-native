import React from 'react';
import {Text, View} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button} from '../../kit/controls';
import {FocusProvider, FocusRegion} from '../../kit/focus';
import {nativeType, useTheme} from '../../kit/theme';
import {useDestinationEntryFocus} from '../../screens/destinations/useEntryFocus';
import {BlurView, glassRecipe} from '../../platform/native-blur';
import {TVAuthLayout} from './TVAuthLayout';

export type TVCodePresenterProps = Readonly<{
  body: React.ReactNode;
  verificationUri?: string; verificationUriComplete?: string; userCode?: string;
  status?: React.ReactNode; busy: boolean; onTypeCredentials: () => void; onBack: () => void;
}> & Readonly<{mode: 'portico'; serverName?: string} | {mode: 'local'; serverName: string}>;

/** Auth8/9 route buttons call the real transaction owner; this view never contacts either authority. */
export function TVCodePresenter(props: TVCodePresenterProps) {
  return <FocusProvider><CodePresenter {...props}/></FocusProvider>;
}
function CodePresenter(props: TVCodePresenterProps) {
  const theme = useTheme(), id = `tv.auth.${props.mode}.code`, t = defaultI18n.t, material = glassRecipe();
  useDestinationEntryFocus({visible: !props.busy, intent: 'enter', revision: 0}, {regionId: id, childId: 'credentials'});
  const type = (size: number, weight: 400 | 600 | 700 | 800 = 400, lineHeight = 1.45) => nativeType({size, weight, tracking: 0, lineHeight: size * lineHeight}, theme.textScale);
  const aside = <View style={{position: 'absolute', right: 140, top: 0, bottom: 0, width: 720, justifyContent: 'center'}}>
    <View style={{paddingTop: 52, paddingHorizontal: 56, paddingBottom: 48, borderRadius: 28, backgroundColor: '#0d1b25C7',
      borderWidth: 1.5, borderColor: `${theme.colors.text}1A`, alignItems: 'center'}}>
      {material.nativeBlur && <View pointerEvents="none" style={{position: 'absolute', inset: 0, borderRadius: 28, overflow: 'hidden'}}>
        <BlurView style={{position: 'absolute', inset: 0}} blurType="dark" blurAmount={30} reducedTransparencyFallbackColor="#0d1b25"/>
      </View>}
      {props.verificationUriComplete && <View style={{width: 300, height: 300, padding: 20, marginBottom: 34, borderRadius: 20, backgroundColor: theme.colors.white}}>
        <QRCode value={props.verificationUriComplete} size={260}/>
      </View>}
      <Text selectable style={[type(30, 700), {color: theme.colors.textSecondary}]}>{props.verificationUri}</Text>
      <Text selectable style={[type(90, 800, 1.05), {color: theme.colors.text, letterSpacing: 3.6, marginTop: 10, marginBottom: 16}]}>{props.userCode ?? t('activation.preparingCode')}</Text>
      <Text style={[type(21), {color: theme.colors.textTertiary, textAlign: 'center'}]}>{t('activation.codeRefreshes')}</Text>
    </View>
  </View>;
  return <TVAuthLayout testID={`tv-${props.mode}-code`} portico={props.mode === 'portico'} aside={aside}
    heading={props.mode === 'portico' ? t('activation.title') : props.serverName}
    eyebrow={props.mode === 'local' ? t('accounts.signIn.to') : undefined} body={props.body}>
    {props.status}
    <FocusRegion id={id} entry="credentials" order={props.mode === 'portico' ? ['credentials', 'back'] : ['credentials']} enabled={!props.busy} style={{flexDirection: 'row', gap: 20}}>
      <Button focusId="credentials" disabled={props.busy} onPress={props.onTypeCredentials} style={{height: 72, paddingHorizontal: 38, borderRadius: 14}}>{t(props.mode === 'portico' ? 'accounts.signIn.onTV' : 'quickConnect.usePassword')}</Button>
      {props.mode === 'portico' && <Button focusId="back" variant="glass" disabled={props.busy} onPress={props.onBack} style={{height: 72, paddingHorizontal: 38, borderRadius: 14}}>{t('action.back')}</Button>}
    </FocusRegion>
  </TVAuthLayout>;
}
