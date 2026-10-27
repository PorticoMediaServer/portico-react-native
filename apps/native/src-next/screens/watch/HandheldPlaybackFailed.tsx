import React from 'react';
import {Text, View} from 'react-native';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import type {NativePlaybackFailure} from './PlaybackFailed';

/** A compact state inside the picture, leaving the player's own exit controls usable. */
export function NativeHandheldPlaybackFailed({failure, retry}: {failure: NativePlaybackFailure; retry?: () => void}) {
  const t = defaultI18n.t, theme = useTheme();
  return <View testID="watch-handheld-failed" pointerEvents="box-none" style={{position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center'}}>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: '#03080c8c'}}/>
    <View testID="watch-handheld-failure" style={{maxWidth: '80%', alignItems: 'center', gap: 4}}>
      <Text accessibilityRole="header" numberOfLines={1} style={{color: theme.colors.text, fontSize: 16, fontWeight: '700', textAlign: 'center'}}>{t('next.states.playbackStopped')}</Text>
      <Text numberOfLines={1} style={{color: theme.colors.textSecondary, fontSize: 13, textAlign: 'center'}}>{t('next.dock.native.stoppedAt', {position: clockText(failure.positionSeconds) ?? ''})}</Text>
      {retry && <Button testID="watch-handheld-retry" size="compact" onPress={retry}>{t('next.states.tryAgain')}</Button>}
    </View>
  </View>;
}
