import React from 'react';
import {uiI18n} from './i18n';
import {Image, View} from 'react-native';
import {Focusable} from './Focusable';
import {Text} from './Text';
import Svg, {Path} from 'react-native-svg';
import {useTheme} from './theme';

/** The Play-P mark, as prebuilt paths (PERF-15: no XML parser in the bundle). Geometry and viewBox
 * copied verbatim from `assets/brandSymbol`. */
const brandViewBox = '206 184 304 405';
const brandOutline = 'M228.0 567.0V206.0H354.3530578613281Q395.70135498046875 206.0 425.38002014160156 221.2514419555664Q455.0586853027344 236.5028839111328 471.0293426513672 265.1856155395508Q487.0 293.86834716796875 487.0 333.6389465332031Q487.0 372.9089660644531 471.0293426513672 401.5841369628906Q455.0586853027344 430.2593078613281 425.38002014160156 445.51832580566406Q395.70135498046875 460.77734375 354.3530578613281 460.77734375H324.0V408.46429443359375H352.413818359375Q392.6810607910156 408.46429443359375 413.2369079589844 388.8592529296875Q433.7927551269531 369.25421142578125 433.7927551269531 333.6389465332031Q433.7927551269531 297.52313232421875 413.2369079589844 277.91807556152344Q392.6810607910156 258.3130187988281 352.413818359375 258.3130187988281H280.7454833984375V408.46429443359375H281.0V460.77734375H280.7454833984375V567.0Z';
const brandPlay = 'M324 298 L324 369 Q324 374 329 371 L392 338 Q398 333 392 328 L329 296 Q324 293 324 298 Z';

/** The Play-P mark. */
export function BrandMark({size, color}: {size: number; color?: string}) {
  const {colors} = useTheme();
  const fill = color ?? colors.text;
  return (
    <Svg viewBox={brandViewBox} width={size * (304 / 405)} height={size}>
      <Path d={brandOutline} fill={fill} />
      <Path d={brandPlay} fill={fill} />
    </Svg>
  );
}

/** The PORTICO wordmark. */
export function Wordmark({height, color}: {height: number; color?: string}) {
  const {colors} = useTheme();
  return <Image source={require('../../assets/wordmark.png')} resizeMode="contain" style={{width: height * (512 / 117), height, tintColor: color ?? colors.text}} accessibilityLabel="Portico" />; // lint-strings-allow: the brand name
}

/** The provider marks for "Sign in with" buttons, drawn to each provider's own guidelines. */
export function GoogleMark({size = 20}: {size?: number}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <Path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <Path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <Path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </Svg>
  );
}
export function AppleMark({size = 20, color = '#fff'}: {size?: number; color?: string}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path fill={color} d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </Svg>
  );
}

/** "Sign in with Google" / "Sign in with Apple", in each provider's own colours. */
export function ProviderButton({provider, onPress, disabled}: {provider: 'google' | 'apple'; onPress: () => void; disabled?: boolean}) {
  const {metrics, space, isTV} = useTheme();
  const google = provider === 'google';
  const height = metrics.control + (isTV ? 8 : 6);
  return (
    <Focusable accessibilityRole="button" accessibilityLabel={uiI18n().t(google ? 'auth.signInWithGoogle' : 'auth.signInWithApple')} radius={metrics.radius.control} disabled={disabled} onPress={onPress} style={{alignSelf: 'stretch'}}>
      {({pressed}) => (
        <View style={{height, borderRadius: metrics.radius.control, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: google ? '#fff' : '#000', borderWidth: 1, borderColor: google ? '#dadce0' : '#fff', opacity: disabled ? 0.5 : pressed ? 0.85 : 1}}>
          {google ? <GoogleMark size={isTV ? 26 : 20} /> : <AppleMark size={isTV ? 28 : 22} />}
          <Text variant="bodyStrong" style={{color: google ? '#1f1f1f' : '#fff'}}>{uiI18n().t(google ? 'auth.signInWithGoogle' : 'auth.signInWithApple')}</Text>
        </View>
      )}
    </Focusable>
  );
}
