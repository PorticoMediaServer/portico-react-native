import React, {useState} from 'react';
import {ScrollView, View, type LayoutChangeEvent} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming, Easing} from 'react-native-reanimated';
import {Focusable} from './Focusable';
import {Text} from './Text';
import {hitSlopFor, spec, useInitialFocus, useSpecPlatform, useTheme} from './theme';

export type TabItem = {id: string; label: string};

/**
 * Top tab strip (Discover · Browse · Collections · Categories). Text tabs with
 * an animated accent underline. A tab is chosen by pressing it, on every platform: moving
 * focus across the strip on television changes nothing.
 */
export function Tabs({items, selected, onSelect, style, entryFocus = true}: {items: readonly TabItem[]; selected: string; onSelect: (id: string) => void; style?: object; /** False where the content below, not the strip, should take focus when the screen opens. */ entryFocus?: boolean}) {
  const {colors, space, isTV, motion, metrics} = useTheme();
  const [layouts, setLayouts] = useState<Record<string, {x: number; width: number}>>({});
  const initial = useInitialFocus();
  const x = useSharedValue(0);
  const w = useSharedValue(0);
  const current = layouts[selected];
  React.useEffect(() => {
    if (!current) return;
    const timing = {duration: motion.reduce ? 0 : motion.standard, easing: Easing.out(Easing.cubic)};
    x.value = withTiming(current.x, timing);
    w.value = withTiming(current.width, timing);
  }, [current, motion.reduce, motion.standard, x, w]);
  const underline = useAnimatedStyle(() => ({transform: [{translateX: x.value}], width: w.value}));
  return (
    <View style={[{borderBottomWidth: 1, borderBottomColor: colors.lineSoft}, style]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: space.page - space.sm}}>
        <View style={{flexDirection: 'row'}}>
          {items.map((item, index) => {
            const active = item.id === selected;
            return (
              <Focusable
                key={item.id}
                hasTVPreferredFocus={isTV && entryFocus && initial && (item.id === selected || (index === 0 && !items.some(i => i.id === selected)))}
                accessibilityRole="tab"
                accessibilityState={{selected: active}}
                radius={metrics.radius.control}
                scale={isTV ? 1.04 : 1}
                ring={false}
                onPress={() => onSelect(item.id)}
                onLayout={(e: LayoutChangeEvent) => {
                  const {x: lx, width} = e.nativeEvent.layout;
                  setLayouts(prev => (prev[item.id]?.x === lx && prev[item.id]?.width === width ? prev : {...prev, [item.id]: {x: lx, width}}));
                }}>
                {({focused, hovered}) => (
                  // TV-LIB-01: focus gets a plate of its own on television, in the focus colour with
                  // ink text so it reads at ten feet; the underline marks the selected tab only
                  // (selection is not focus).
                  <View style={{paddingHorizontal: space.sm + (isTV ? space.xs : 0), paddingVertical: space.md, borderRadius: metrics.radius.control, backgroundColor: isTV && focused ? colors.focus : 'transparent'}}>
                    <Text variant={isTV ? 'subheading' : 'bodyStrong'} style={{color: isTV && focused ? colors.ink : active ? colors.text : focused || hovered ? colors.textSecondary : colors.textTertiary}}>
                      {item.label}
                    </Text>
                  </View>
                )}
              </Focusable>
            );
          })}
          <Animated.View pointerEvents="none" style={[{position: 'absolute', bottom: -1, height: isTV ? 4 : 3, borderRadius: 2, backgroundColor: colors.accent}, underline]} />
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Segmented control (segmentedSpec) for 2–5 peer choices: sorts, layouts, Unread / All / Archived.
 * 32 pt with a 44 pt hit area on touch (APL-NOTIF-01), 64 px on TV; the selected segment is a
 * raised plate with a primary-text label.
 */
export function Segmented({items, selected, onSelect, accessibilityLabel}: {items: readonly TabItem[]; selected: string; onSelect: (id: string) => void; accessibilityLabel?: string}) {
  const {colors, isTV} = useTheme();
  const platform = useSpecPlatform();
  const g = spec.segmented;
  const height = g.height[platform];
  const pad = g.padding[platform];
  // Touch: the whole control is 32 pt and each segment reaches 44 through its hit area. TV: each
  // focusable segment is itself 64 px (APL-SYS-01), so the track grows around it.
  const inner = isTV ? height : height - pad * 2;
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={{flexDirection: 'row', padding: pad, gap: pad, borderRadius: g.radius[platform], backgroundColor: colors[g.track], alignSelf: 'flex-start'}}>
      {items.map(item => {
        const active = item.id === selected;
        return (
          <Focusable key={item.id} radius={g.segmentRadius[platform]} scale={isTV ? spec.focus.scale.button.tv : 1} hitSlop={hitSlopFor(inner, g.minHit[platform])} accessibilityRole="tab" accessibilityState={{selected: active}} accessibilityLabel={item.label} onPress={() => onSelect(item.id)}>
            {({focused, hovered}) => (
              <View style={{paddingHorizontal: spec.chip.paddingX[platform], height: inner, alignItems: 'center', justifyContent: 'center', borderRadius: g.segmentRadius[platform], backgroundColor: active ? colors[g.selected.background as keyof typeof colors] : focused || hovered ? colors.raised : 'transparent'}}>
                <Text variant={g.label} tone={active || focused ? 'primary' : 'tertiary'}>{item.label}</Text>
              </View>
            )}
          </Focusable>
        );
      })}
    </View>
  );
}
