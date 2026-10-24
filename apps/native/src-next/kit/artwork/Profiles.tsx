import {focusTestID} from '../focus/registry';
import React, {useEffect} from 'react';
import {ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle} from 'react-native';
import Animated, {useAnimatedStyle, useSharedValue, withTiming} from 'react-native-reanimated';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {profileArtColors} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src/index';
import {Button, Focusable, type FocusableProps} from '../controls/index';
import {Icon} from '../Icon';
import {fontFamilies, useTheme} from '../theme';
import {useMotion} from '../useMotion';
import {Artwork} from './Artwork';
import {mixColour} from './model';
import type {ArtworkSource} from './types';

export type ProfileFaceProps = Readonly<{
  initial: string;
  color?: keyof typeof profileArtColors;
  tint?: string;
  source?: ArtworkSource | null;
  size?: number;
  locked?: boolean;
  focused?: boolean;
  selected?: boolean;
  disabled?: boolean;
  add?: boolean;
  scaleOnFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}>;

/** Colour/initial identity is usable before profile choice; an optional real avatar uses the queue. */
export function ProfileFace({initial, color = 'blue', tint, source, size = 90, locked = false, focused = false, selected = false, disabled = false, add = false, scaleOnFocus = true, style}: ProfileFaceProps) {
  const {colors, isTV} = useTheme();
  const motion = useMotion();
  const scale = useSharedValue(1), ring = useSharedValue(0);
  const active = (focused || selected) && !disabled;
  useEffect(() => {
    scale.value = motion.transforms && active && scaleOnFocus ? withTiming(isTV ? 1.08 : 1.06, motion.timing('quick')) : withTiming(1, motion.timing('quick'));
    ring.value = withTiming(active ? 1 : 0, motion.timing('quick'));
  }, [active, isTV, scaleOnFocus, motion, scale, ring]);
  const faceStyle = useAnimatedStyle(() => ({transform: [{scale: scale.value}]}));
  const ringStyle = useAnimatedStyle(() => ({opacity: ring.value}));
  const base = tint ?? profileArtColors[color];
  const badge = size * 0.24;
  const offset = isTV ? 10 : 7;
  return <Animated.View style={[{width: size, height: size, opacity: disabled ? 0.42 : 1}, faceStyle, style]}>
    <View style={[StyleSheet.absoluteFillObject, {overflow: 'hidden', borderRadius: size / 2, borderWidth: add ? 2 : 0, borderColor: colors.lineStrong}]}>
      {!add ? <Svg accessible={false} pointerEvents="none" width={size} height={size}>
        <Defs><LinearGradient id="profile-colour" x1="0" y1="0" x2="100%" y2="100%">
          <Stop offset="0" stopColor={mixColour(base, colors.white, 18 / 118)}/><Stop offset="0.55" stopColor={base}/><Stop offset="1" stopColor={mixColour(base, colors.ink, 0.4)}/>
        </LinearGradient></Defs><Rect width="100%" height="100%" fill="url(#profile-colour)"/>
      </Svg> : null}
      <View style={[StyleSheet.absoluteFillObject, {alignItems: 'center', justifyContent: 'center'}]}>
        {add ? <Icon name="i-plus" size={size * 0.37} color={colors.textTertiary}/> : <Text accessible={false} allowFontScaling={false} style={{fontFamily: fontFamilies[800], fontSize: size * 0.4, letterSpacing: -size * 0.012, color: colors.white}}>{initial}</Text>}
      </View>
      {!add && source ? <Artwork source={source} sized/> : null}
    </View>
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, {inset: -offset, borderRadius: size / 2 + offset, borderWidth: isTV ? 5 : 3, borderColor: colors.focus,
      shadowColor: colors.focus, shadowOpacity: 0.22, shadowRadius: isTV ? 35 : 20, shadowOffset: {width: 0, height: isTV ? 30 : 0}}, ringStyle]}/>
    {locked && !add ? <View pointerEvents="none" style={{position: 'absolute', right: size * 0.04, bottom: size * 0.04, width: badge, height: badge, alignItems: 'center', justifyContent: 'center', borderRadius: badge / 2, backgroundColor: colors.raisedBright, borderWidth: size < 100 ? 3 : 4, borderColor: colors.ink}}><Icon name="i-lock" size={badge * 0.55} color={colors.text}/></View> : null}
  </Animated.View>;
}

export type ProfileOption = Readonly<{
  id: string;
  name: string;
  initial: string;
  color?: keyof typeof profileArtColors;
  tint?: string;
  source?: ArtworkSource | null;
  pinRequired?: boolean;
  primary?: boolean;
  unavailableReason?: 'restricted' | 'not-shared' | 'access-removed';
  disabled?: boolean;
}>;
export type ProfilePickerProps = Readonly<{
  testID?: string;
  profiles: readonly ProfileOption[];
  onSelect: (id: string) => void;
  onAdd?: () => void;
  onManage?: () => void;
  selectedId?: string;
  preferredProfileId?: string;
  onFocusChange?: (id: string | undefined) => void;
  profileProps?: (profile: ProfileOption) => Omit<FocusableProps, 'children' | 'disabled' | 'onPress'>;
  title?: string;
  description?: string;
  showTitle?: boolean;
  layout?: 'phone' | 'row' | 'tv';
  style?: StyleProp<ViewStyle>;
}>;

function profileBadge(profile: ProfileOption): string | undefined {
  const t = defaultI18n.t;
  if (profile.unavailableReason) return t(profile.unavailableReason === 'restricted' ? 'web.profilePicker.restricted' : profile.unavailableReason === 'not-shared' ? 'web.profilePicker.notShared' : 'web.profilePicker.accessRemoved');
  if (profile.pinRequired) return t('profile.protected');
  if (profile.primary) return t('profile.main');
  return undefined;
}

function ProfileTileContents({profile, focused, selected, layout}: {profile: ProfileOption; focused: boolean; selected: boolean; layout: 'phone' | 'row' | 'tv'}) {
  const theme = useTheme();
  const motion = useMotion();
  const scale = useSharedValue(1);
  const disabled = profile.disabled || Boolean(profile.unavailableReason);
  useEffect(() => {scale.value = withTiming(layout === 'tv' && focused && motion.transforms ? 1.08 : 1, motion.timing('quick'));}, [layout, focused, motion, scale]);
  const animated = useAnimatedStyle(() => ({transform: [{scale: scale.value}]}));
  const size = layout === 'tv' ? 216 : layout === 'row' ? 160 : 90;
  const label = profileBadge(profile);
  return <Animated.View style={[{alignItems: 'center', width: '100%', opacity: disabled ? 0.42 : 1}, animated]}>
    <ProfileFace initial={profile.initial} color={profile.color} tint={profile.tint} source={profile.source} size={size} locked={profile.pinRequired} focused={focused && !disabled} selected={selected && !disabled} scaleOnFocus={layout !== 'tv'}/>
    <Text numberOfLines={1} style={{fontFamily: fontFamilies[700], fontSize: (layout === 'tv' ? 30 : layout === 'row' ? 21 : 15) * theme.textScale, letterSpacing: (layout === 'row' ? -0.21 : 0) * theme.textScale, color: layout !== 'tv' || focused ? theme.colors.text : theme.colors.textSecondary, marginTop: layout === 'tv' ? 26 : layout === 'row' ? 18 : 10, maxWidth: '100%'}}>{profile.name}</Text>
    <Text numberOfLines={1} style={{fontFamily: fontFamilies[layout === 'phone' ? 600 : 400], fontSize: (layout === 'tv' ? 22 : layout === 'row' ? 14 : 12) * theme.textScale, color: theme.colors.textTertiary, marginTop: layout === 'phone' ? 3 : 6, minHeight: layout === 'tv' ? 28 : layout === 'row' ? 20 : 16, maxWidth: '100%'}}>{label}</Text>
  </Animated.View>;
}

/** Authentication/PIN/management authority stays with these real caller callbacks (Q34). */
export function ProfilePicker({profiles, onSelect, onAdd, onManage, selectedId, preferredProfileId, onFocusChange, profileProps, title, description, showTitle = true, layout: requestedLayout, style, testID}: ProfilePickerProps) {
  const theme = useTheme();
  const layout = requestedLayout ?? (theme.isTV ? 'tv' : theme.platform === 'phone' ? 'phone' : 'row');
  const phone = layout === 'phone';
  const faceSize = layout === 'tv' ? 216 : phone ? 90 : 160;
  const tiles = <View style={{flexDirection: 'row', flexWrap: phone ? 'wrap' : 'nowrap', justifyContent: phone ? 'flex-start' : 'center', columnGap: phone ? 0 : layout === 'tv' ? 60 : 32, rowGap: phone ? 26 : 0}}>
    {profiles.map(profile => {
      const forwarded = profileProps?.(profile);
      return <Focusable key={profile.id} {...forwarded} testID={forwarded?.testID ?? controlID(testID, 'profile', profile.id)}
      accessibilityRole="button" accessibilityLabel={profile.name} accessibilityHint={profileBadge(profile)}
      accessibilityState={{...forwarded?.accessibilityState, selected: selectedId === profile.id}}
      disabled={profile.disabled || Boolean(profile.unavailableReason)} focusTreatment="none"
      hasTVPreferredFocus={profile.id === preferredProfileId}
      onFocus={event => {forwarded?.onFocus?.(event); onFocusChange?.(profile.id);}}
      onBlur={event => {forwarded?.onBlur?.(event); onFocusChange?.(undefined);}}
      onPress={() => onSelect(profile.id)} style={state => [{width: phone ? '33.333333%' : layout === 'tv' ? 236 : 168, paddingHorizontal: phone ? 4 : 0}, typeof forwarded?.style === 'function' ? forwarded.style(state) : forwarded?.style]}>
      {state => <ProfileTileContents profile={profile} focused={state.focused} selected={selectedId === profile.id} layout={layout}/>}
    </Focusable>;
    })}
    {onAdd ? <Focusable testID={controlID(testID, 'add')} accessibilityRole="button" accessibilityLabel={defaultI18n.t('profile.add')} onPress={onAdd} focusTreatment="none" style={{width: phone ? '33.333333%' : layout === 'tv' ? 236 : 168, alignItems: 'center', paddingHorizontal: phone ? 4 : 0}}>
      {state => <><ProfileFace initial="" add size={faceSize} focused={state.focused}/><Text style={{fontFamily: fontFamilies[700], color: theme.colors.text, fontSize: (layout === 'tv' ? 30 : phone ? 15 : 21) * theme.textScale, marginTop: layout === 'tv' ? 26 : phone ? 10 : 18}}>{defaultI18n.t('profile.add')}</Text></>}
    </Focusable> : null}
  </View>;
  return <View style={[{alignItems: phone ? 'stretch' : 'center'}, style]}>
    {showTitle ? <Text accessibilityRole="header" style={{fontFamily: fontFamilies[800], fontSize: (layout === 'tv' ? 72 : phone ? 32 : 64) * theme.textScale, letterSpacing: (layout === 'tv' ? 72 : phone ? 32 : 64) * (phone ? -0.04 : -0.045) * theme.textScale, color: theme.colors.text, marginBottom: description ? 6 : layout === 'tv' ? 80 : phone ? 30 : 56}}>{title ?? defaultI18n.t('auth.whosWatching')}</Text> : null}
    {description ? <Text style={{...theme.type.body, color: theme.colors.textSecondary, marginBottom: 30}}>{description}</Text> : null}
    {phone ? tiles : <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{padding: 18}}>{tiles}</ScrollView>}
    {onManage ? <Button testID={controlID(testID, 'manage')} variant="glass" size="hero" icon="i-edit" onPress={onManage} style={{alignSelf: phone ? 'flex-start' : 'center', marginTop: 56}}>{defaultI18n.t('next.artwork.native.manageProfiles')}</Button> : null}
  </View>;
}

const controlID = (prefix: string | undefined, ...parts: readonly string[]) => prefix ? focusTestID(prefix, JSON.stringify(parts)) : undefined;
