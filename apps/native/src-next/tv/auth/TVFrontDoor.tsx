import React from 'react';
import {Image, Text, View, useWindowDimensions} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {ColourBackdrop} from '../../kit/artwork';
import {Button} from '../../kit/controls';
import {FocusProvider, FocusRegion} from '../../kit/focus';
import {nativeType, useTheme} from '../../kit/theme';
import {useDestinationEntryFocus} from '../../screens/destinations/useEntryFocus';
import {shellLayout} from '../../shell/model';

export type TVFrontDoorProps = Readonly<{
  busy: boolean; error?: React.ReactNode;
  onPortico: () => void; onLocal: () => void;
}>;

/** connect40's signed-out screen. The account owner alone starts either flow;
 * rendering this screen makes no Services request and installs no Back action. */
export function TVFrontDoor(props: TVFrontDoorProps) {
  return <FocusProvider><FrontDoor {...props}/></FocusProvider>;
}
function FrontDoor({busy, error, onPortico, onLocal}: TVFrontDoorProps) {
  const theme = useTheme(), window = useWindowDimensions(), canvas = shellLayout(window.width, window.height, true), id = 'tv.auth.front-door';
  useDestinationEntryFocus({visible: !busy, intent: 'enter', revision: 0}, {regionId: id, childId: 'portico'});
  const textStyle = nativeType({size: 26, weight: 700, lineHeight: 'normal', tracking: 0}, theme.textScale);
  return <View testID="tv-front-door" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{position: 'absolute', left: canvas.left, top: canvas.top, width: canvas.width, height: canvas.height,
      transformOrigin: 'top left', transform: [{scale: canvas.scale}]}}>
      <ColourBackdrop shape="side" fill/>
      <View style={{position: 'absolute', left: 200, top: 0, bottom: 0, width: 900, justifyContent: 'center'}}>
        <Image source={require('../../../assets/wordmark.png')} accessibilityLabel={defaultI18n.t('accounts.brand')}
          resizeMode="contain" style={{position: 'absolute', left: 0, top: 72, width: 174, height: 40}}/>
        <Text accessibilityRole="header" style={[nativeType({size: 88, weight: 800, lineHeight: 88, tracking: -.045}, theme.textScale),
          {color: theme.colors.text, marginBottom: 56}]}>{defaultI18n.t('web.signin.welcomeHome')}</Text>
        {error && <View accessibilityRole="alert" style={{marginBottom: 16}}>{error}</View>}
        <FocusRegion id={id} entry="portico" order={['portico', 'local']} orientation="horizontal" enabled={!busy} style={{flexDirection: 'row', gap: 36}}>
          <Button focusId="portico" testID="tv-front-door-portico" disabled={busy} onPress={() => {if (!busy) onPortico();}}
            style={{height: 72, paddingHorizontal: 38, borderRadius: 14}} textStyle={textStyle}>{defaultI18n.t('accounts.signIn.portico')}</Button>
          <Button focusId="local" testID="tv-front-door-local" variant="glass" disabled={busy} onPress={() => {if (!busy) onLocal();}}
            style={{height: 72, paddingHorizontal: 38, borderRadius: 14}} textStyle={textStyle}>{defaultI18n.t('accounts.signIn.local')}</Button>
        </FocusRegion>
      </View>
    </View>
  </View>;
}
