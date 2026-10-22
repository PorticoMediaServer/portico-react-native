import React from 'react';
import {Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../packages/i18n/src';
import {BlurView, phoneTabBarRecipe} from '../platform/native-blur';
import {Focusable} from '../kit/controls';
import {Icon} from '../kit/Icon';
import {useTheme} from '../kit/theme';
import {phoneBarHeight, phoneTabs, selectedTab, type ShellDestination, type ShellTab} from './model';

export function PhoneTabBar({destination, hasLiveTV, onSelect}: {destination: ShellDestination; hasLiveTV: boolean; onSelect: (tab: ShellTab['id']) => void}) {
  const {colors, type, layers} = useTheme(), insets = useSafeAreaInsets();
  const recipe = phoneTabBarRecipe();
  return <View accessibilityLabel={defaultI18n.t('next.home.native.mainNavigation')} testID="phone-tab-bar"
    style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: phoneBarHeight(insets.bottom), zIndex: layers.sticky, overflow: 'hidden', borderTopWidth: 1, borderTopColor: `${colors.text}14`}}>
    <BlurView pointerEvents="none" style={{position: 'absolute', inset: 0}} blurType="dark" blurAmount={recipe.blur} reducedTransparencyFallbackColor={colors.raised}/>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: colors.raised, opacity: recipe.alpha}}/>
    <View style={{flexDirection: 'row', paddingHorizontal: recipe.paddingX, paddingTop: recipe.paddingTop}}>
      {phoneTabs(hasLiveTV).map(tab => {
        const selected = selectedTab(destination) === tab.id, color = selected ? colors.text : colors.textTertiary;
        return <Focusable key={tab.id} testID={`phone-tab-${tab.id}`} accessibilityRole="tab" accessibilityLabel={defaultI18n.t(tab.message)} accessibilityState={{selected}} onPress={() => onSelect(tab.id)} focusRadius={10}
          style={{flex: 1, height: 44, alignItems: 'center', justifyContent: 'flex-start', gap: recipe.gap}}>
          <Icon name={tab.icon} size={22} color={color}/><Text numberOfLines={1} style={[type.tabBar, {color}]}>{defaultI18n.t(tab.message)}</Text>
        </Focusable>;
      })}
    </View>
  </View>;
}
