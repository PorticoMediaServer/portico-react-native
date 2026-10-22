import React from 'react';
import {Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {BlurView, glassRecipe} from '../../platform/native-blur';
import {nativeType, useTheme} from '../theme';
import {ownerDetails, type DetailsAudience} from './model';
import type {StateAction} from './types';
import {StateActionButton} from './StateActionButton';

export type StateFact = Readonly<{
  id: string;
  label: React.ReactNode;
  value?: React.ReactNode;
  status?: Readonly<{label: React.ReactNode; tone?: 'neutral' | 'warning' | 'success'}>;
}>;
export type OwnerStateDetails = Readonly<{
  heading: React.ReactNode;
  ownerTag: React.ReactNode;
  ownerMark: React.ReactNode;
  description?: React.ReactNode;
  codesLabel?: React.ReactNode;
  codes?: readonly string[];
  time?: React.ReactNode;
  actions?: readonly StateAction[];
}>;
export type DetailsPanelProps = Readonly<{
  facts: readonly StateFact[];
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}> & DetailsAudience<OwnerStateDetails>;

/** Content only. A caller can put the same facts in a disclosure, side panel or sheet. */
export function DetailsPanel(props: DetailsPanelProps) {
  const {facts, compact = false, style, testID} = props;
  const theme = useTheme();
  const tv = theme.isTV;
  const owner = ownerDetails(props);
  const glass = glassRecipe();
  const size = tv ? 22 : compact ? 13 : 13.5;
  const labelStyle = nativeType({size, lineHeight: size * 1.45, weight: 600, tracking: 0}, theme.textScale);
  return <View testID={testID} style={[{alignSelf: 'stretch', borderRadius: theme.baseRadii.overlay, overflow: 'hidden', backgroundColor: `${theme.colors.raised}D1`, borderWidth: 1, borderColor: `${theme.colors.text}14`}, style]}>
    {glass.nativeBlur && <BlurView pointerEvents="none" blurType="dark" blurAmount={24} reducedTransparencyFallbackColor={theme.colors.raised} style={{position: 'absolute', inset: 0}} />}
    {facts.map((fact, index) => <View key={fact.id} style={{flexDirection: 'row', alignItems: 'baseline', gap: tv ? 24 : compact ? 12 : 16, paddingHorizontal: tv ? 26 : compact ? 12 : 14, paddingVertical: tv ? 16 : compact ? 8 : 9, borderTopWidth: index ? 1 : 0, borderColor: `${theme.colors.text}0F`}}>
      <Text style={[labelStyle, {color: theme.colors.textTertiary, width: compact ? tv ? 190 : 112 : undefined, flex: compact ? undefined : 1}]}>{fact.label}</Text>
      {fact.value != null && <Text selectable style={[labelStyle, {color: theme.colors.text, flex: 1, flexShrink: 1}]}>{fact.value}</Text>}
      {fact.status && <Text style={[labelStyle, {color: fact.status.tone === 'warning' ? theme.colors.amber : fact.status.tone === 'success' ? theme.colors.healthy : theme.colors.textTertiary}]}>{fact.status.label}</Text>}
    </View>)}
    {owner && <View testID={testID ? `${testID}-owner` : undefined} style={{paddingHorizontal: tv ? 26 : compact ? 12 : 18, paddingTop: tv ? 22 : 14, paddingBottom: tv ? 24 : 16, backgroundColor: `${theme.colors.ink}B3`, borderTopWidth: 1, borderColor: `${theme.colors.accentStrong}29`}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: tv ? 14 : 10, marginBottom: tv ? 14 : 8}}>
        {owner.ownerMark}
        <Text style={[nativeType({size: tv ? 22 : compact ? 13 : 14, lineHeight: 'normal', weight: 800, tracking: 0}, theme.textScale), {color: theme.colors.text, flexShrink: 1}]}>{owner.heading}</Text>
        <View style={{marginLeft: 'auto'}}>{owner.ownerTag}</View>
      </View>
      {owner.description != null && <Text style={[nativeType({size: tv ? 21 : compact ? 12.5 : 13.5, lineHeight: tv ? 31.5 : compact ? 19.375 : 20.925, weight: 400, tracking: 0}, theme.textScale), {color: theme.colors.textSecondary}]}>{owner.description}</Text>}
      {Boolean(owner.codes?.length) && <View style={{flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: tv ? 12 : 6, marginTop: tv ? 10 : 6}}>
        {owner.codesLabel != null && <Text style={[labelStyle, {color: theme.colors.textSecondary}]}>{owner.codesLabel}</Text>}
        {owner.codes?.map(code => <Text key={code} selectable style={[labelStyle, {color: theme.colors.textSecondary, fontVariant: ['tabular-nums'], borderRadius: theme.baseRadii.tag, backgroundColor: `${theme.colors.text}14`, paddingHorizontal: tv ? 10 : 7, paddingVertical: 1}]}>{code}</Text>)}
        {owner.time != null && <Text style={[labelStyle, {color: theme.colors.textSecondary}]}>{owner.time}</Text>}
      </View>}
      {owner.actions && <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: tv ? 26 : 18, marginTop: tv ? 16 : 10}}>
        {owner.actions.map(action => <StateActionButton key={action.id} action={action} variant="text" size="small" />)}
      </View>}
    </View>}
  </View>;
}
