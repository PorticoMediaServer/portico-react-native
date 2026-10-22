import React, {useId} from 'react';
import {ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import {tabsSpec} from '@portico/design';
import {useTheme} from '../theme';
import {Focusable, type FocusableProps} from './Focusable';
import {colorAlpha, enabledChoice, minimumHitSlop} from './control-model';
import {useControlValue} from './useControlValue';

export type TabItem = {value: string; label: React.ReactNode; disabled?: boolean; panel?: React.ReactNode};
export type TabsProps = {
  items: readonly TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  itemProps?: (item: TabItem) => Omit<FocusableProps, 'children'>;
  testID?: string;
};
export type SegmentedProps = TabsProps & {variant?: 'glass' | 'browse' | 'phone'};

export function Tabs({items, value, defaultValue, onValueChange, disabled, accessibilityLabel, style, itemProps, testID}: TabsProps) {
  const theme = useTheme();
  const id = useId();
  const [current, setCurrent] = useControlValue(value, defaultValue ?? enabledChoice(items) ?? '', onValueChange);
  const active = items.find(item => item.value === current);
  return <View style={style} testID={testID}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{overflow: 'visible'}}
      contentContainerStyle={[styles.tabs, {gap: tabsSpec.gap[theme.platform], paddingHorizontal: theme.gutter, borderBottomColor: theme.colors.line}]}
      accessibilityRole="tablist" accessibilityLabel={accessibilityLabel}>
      {items.map(item => {
        const childProps = itemProps?.(item);
        const blocked = disabled || item.disabled;
        const selected = item.value === current;
        return <Focusable {...childProps} key={item.value} nativeID={`${id}-${item.value}`} accessibilityRole="tab"
          disabled={blocked} accessibilityState={{...childProps?.accessibilityState, selected}}
          focusRadius={4} focusInset focusKind="row" onPress={event => {if (!blocked) {setCurrent(item.value); childProps?.onPress?.(event);}}}
          style={state => [{paddingTop: tabsSpec.paddingTop[theme.platform], paddingBottom: tabsSpec.paddingBottom[theme.platform], opacity: blocked ? .45 : 1},
            typeof childProps?.style === 'function' ? childProps.style(state) : childProps?.style]}>
          <Text numberOfLines={1} style={[theme.type.tab, {color: selected ? theme.colors.text : theme.colors.textTertiary}]}>{item.label}</Text>
          {selected ? <View pointerEvents="none" style={[styles.underline, {height: tabsSpec.underline[theme.platform], backgroundColor: theme.colors.accent}]} /> : null}
        </Focusable>;
      })}
    </ScrollView>
    {active?.panel !== undefined ? <View accessibilityLabelledBy={`${id}-${active.value}`}>{active.panel}</View> : null}
  </View>;
}

export function Segmented({items, value, defaultValue, onValueChange, variant = 'glass', disabled, accessibilityLabel, style, itemProps, testID}: SegmentedProps) {
  const theme = useTheme();
  const [current, setCurrent] = useControlValue(value, defaultValue ?? enabledChoice(items) ?? '', onValueChange);
  const phone = variant === 'phone';
  const height = theme.isTV ? 64 : phone ? 28 : 34;
  const slop = minimumHitSlop(height + 6, theme.isTV);
  return <View accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel} testID={testID}
    style={[styles.segmented, {borderRadius: theme.isTV ? 14 : phone ? 9 : 11, padding: 3,
      backgroundColor: variant === 'glass' ? theme.colors.ink : phone ? theme.colors.raisedBright : theme.colors.raisedHigh,
      borderColor: variant === 'glass' ? theme.colors.line : 'transparent', borderWidth: variant === 'glass' ? 1 : 0}, style]}>
    {items.map(item => {
      const childProps = itemProps?.(item);
      const blocked = disabled || item.disabled;
      const selected = item.value === current;
      return <Focusable {...childProps} key={item.value} accessibilityRole="radio" accessibilityState={{...childProps?.accessibilityState, checked: selected}}
        disabled={blocked} focusKind="row" focusRadius={theme.isTV ? 10 : phone ? 7 : 8} focusInset
        hitSlop={childProps?.hitSlop ?? {top: slop, bottom: slop}}
        onPress={event => {if (!blocked) {setCurrent(item.value); childProps?.onPress?.(event);}}}
        style={state => [styles.segment, {height, borderRadius: theme.isTV ? 10 : phone ? 7 : 8, paddingHorizontal: theme.isTV ? 20 : phone ? 11 : 14,
          backgroundColor: selected ? variant === 'browse' ? theme.colors.raisedBright : colorAlpha(theme.colors.text, .16) : 'transparent', opacity: blocked ? .45 : 1},
          typeof childProps?.style === 'function' ? childProps.style(state) : childProps?.style]}>
        <Text numberOfLines={1} style={[theme.type.captionStrong, {color: selected ? theme.colors.text : theme.colors.textTertiary, fontSize: (theme.isTV ? 22 : phone ? 13 : 14) * theme.textScale}]}>{item.label}</Text>
      </Focusable>;
    })}
  </View>;
}

const styles = StyleSheet.create({tabs: {flexDirection: 'row', alignItems: 'stretch', borderBottomWidth: 1}, underline: {position: 'absolute', left: 0, right: 0, bottom: -1, borderRadius: 3}, segmented: {flexDirection: 'row', alignSelf: 'flex-start'}, segment: {alignItems: 'center', justifyContent: 'center', flexShrink: 1, minWidth: 38}});
