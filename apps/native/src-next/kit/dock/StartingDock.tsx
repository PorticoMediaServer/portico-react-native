import React from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {Artwork, type ArtworkSource} from '../artwork';
import {Focusable} from '../controls';
import {Icon} from '../Icon';
import {useTheme} from '../theme';
import {BlurView} from '../../platform/native-blur';
import {alpha, dockStyles as s, dockType} from './visual';
import type {DockBarFrame} from './model';

/** O-159's starting dock: an accepted Play drawn at once from the pressed card, in the dock's own
 * connecting look (art under a pending ring, the title, Stop only). It never shows Pause or
 * progress, and the real dock replaces it in place. On a television Stop takes the focus. */
export function StartingDock({title, artwork, onStop, frame, testID = 'playback-starting-dock'}: {
  title: string; artwork?: ArtworkSource; onStop: () => void; frame: DockBarFrame; testID?: string;
}) {
  const theme = useTheme(), t = defaultI18n.t, tv = theme.isTV;
  const artSize = tv ? 64 : 44;
  const stop = <Focusable testID={`${testID}.stop`} accessibilityRole="button" accessibilityLabel={t('next.dock.native.stopConnecting')} focusRadius={tv ? 36 : 20}
    hasTVPreferredFocus={tv} onPress={onStop} style={tv ? s.tvButton : s.phoneButton}>
    <Icon name="i-stop" size={tv ? 30 : 20}/>
  </Focusable>;
  return <View testID={testID} accessibilityLabel={`${title}, ${t('next.dock.starting')}`} accessibilityState={{busy: true}}
    style={tv ? {position: 'absolute', top: 44, right: theme.layout.gutter.tvRight} : {position: 'absolute', left: frame.left, right: frame.right, bottom: frame.bottom, ...(frame.maxWidth ? {maxWidth: frame.maxWidth} : {})}}>
    <View style={[tv ? s.tvQuiet : s.phone, {backgroundColor: alpha(theme.colors.raisedBright, .88), borderWidth: 1, borderColor: alpha(theme.colors.text, .08)}]}>
      <BlurView pointerEvents="none" style={s.fill} blurType="dark" blurAmount={24} reducedTransparencyFallbackColor={theme.colors.raisedBright}/>
      <View style={[s.art, {width: artSize, height: artSize, backgroundColor: theme.colors.shadow}]}>
        <Artwork source={artwork} width={artSize} height={artSize} priority imageStyle={{opacity: .55}}/>
        <View style={[s.fill, s.center, {backgroundColor: alpha(theme.colors.dim, .55)}]}><ActivityIndicator size={tv ? 'large' : 20} color={theme.colors.text}/></View>
      </View>
      <View style={s.text}>
        <Text numberOfLines={1} ellipsizeMode="tail" style={[dockType(theme, tv ? 24 : 14, 700), {color: theme.colors.text}]}>{title}</Text>
        <Text numberOfLines={1} style={[dockType(theme, tv ? 20 : 12, 400), {color: theme.colors.textSecondary}]}>{t('next.dock.starting')}</Text>
      </View>
      {stop}
    </View>
  </View>;
}
