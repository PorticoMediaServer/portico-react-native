import React, {useId} from 'react';
import {StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Svg, {Circle, Defs, RadialGradient, Stop} from 'react-native-svg';
import {fontFamilies, useTheme} from '../theme';
import {selectionText} from './copy';
import {holdFraction} from './selection-geometry';

export type SelectionHoldFeedbackProps = {active: boolean; progress: number | null; style?: StyleProp<ViewStyle>};

/** select17: real press feedback, without a clock, haptic trigger or focus target. */
export function SelectionHoldFeedback({active, progress, style}: SelectionHoldFeedbackProps) {
  const {colors, isTV} = useTheme();
  const id = useId().replace(/:/g, '');
  const fraction = holdFraction(progress);
  if (!active || isTV) return null;
  const circumference = 2 * Math.PI * 41;
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.root, style]}>
    <Svg width={85} height={85} viewBox="0 0 85 85" accessible={false}>
      <Defs><RadialGradient id={id}><Stop offset="0" stopColor={colors.text} stopOpacity={.34} /><Stop offset=".62" stopColor={colors.text} stopOpacity={.16} /><Stop offset="1" stopColor={colors.text} stopOpacity={.04} /></RadialGradient></Defs>
      <Circle cx={42.5} cy={42.5} r={31} fill={`url(#${id})`} stroke="rgba(237,245,250,.35)" strokeWidth={2} />
      {fraction !== null ? <Circle cx={42.5} cy={42.5} r={41} fill="none" stroke={colors.accentStrong} strokeWidth={3}
        strokeDasharray={`${circumference * fraction} ${circumference}`} rotation={-70} origin="42.5, 42.5" /> : null}
    </Svg>
    <View style={[styles.tip, {backgroundColor: colors.raisedBright}]}><Text numberOfLines={1} style={{fontFamily: fontFamilies[700], fontSize: 12.5, color: colors.text}}>{selectionText('next.selection.native.hold')}</Text></View>
  </View>;
}
const styles = StyleSheet.create({root: {alignItems: 'center', width: 85, height: 85}, tip: {position: 'absolute', top: 90, paddingVertical: 7, paddingHorizontal: 12, borderRadius: 9, boxShadow: '0 10px 24px -6px rgba(0,0,0,.75), 0 0 0 1px rgba(237,245,250,.12)'}});
