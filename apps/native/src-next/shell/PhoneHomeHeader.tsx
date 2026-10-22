import React from 'react';
import {Image, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../packages/i18n/src';
import {ProfileAvatar} from '../kit/shell';
import type {ProfileOption} from '../kit/artwork';
import {useTheme} from '../kit/theme';
import {BlurView} from '../platform/native-blur';

export function PhoneHomeHeader({profile, unread, avatarRef, onProfile, castControl, scrolled = false}: {
  profile: ProfileOption; unread: boolean; avatarRef: React.RefObject<View | null>; onProfile: () => void; castControl?: React.ReactNode; scrolled?: boolean;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets();
  return <View pointerEvents="box-none" style={{position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top, paddingHorizontal: 20, height: insets.top + 50, zIndex: theme.layers.navigation, flexDirection: 'row', alignItems: 'center', backgroundColor: scrolled ? `${theme.colors.ink}EB` : undefined}}>
    {scrolled && <BlurView pointerEvents="none" style={{position: 'absolute', inset: 0}} blurType="dark" blurAmount={24} reducedTransparencyFallbackColor={theme.colors.ink}/>}
    <Image accessible accessibilityLabel={defaultI18n.t('next.platform.appName')} source={require('../../assets/wordmark.png')} resizeMode="contain" style={{width: 69, height: 16}}/>
    <View style={{marginLeft: 'auto', flexDirection: 'row', gap: 16, alignItems: 'center'}}>{castControl}<ProfileAvatar ref={avatarRef} profile={profile} size={30} unread={unread} accessibilityLabel={defaultI18n.t('profiles.title')} onPress={onProfile}/></View>
  </View>;
}
