import React from 'react';
import {View} from 'react-native';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {StateView} from '../../kit/states';
import type {NativePlaybackFailure} from './PlaybackFailed';

/** A compact state inside the picture, leaving the player's own exit controls usable. */
export function NativeHandheldPlaybackFailed({failure, retry}: {failure: NativePlaybackFailure; retry?: () => void}) {
  const t = defaultI18n.t;
  return <View testID="watch-handheld-failed" pointerEvents="box-none" style={{position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center'}}>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: '#03080c8c'}}/>
    <StateView title={t('next.states.playbackStopped')} body={t('next.dock.native.stoppedAt', {position: clockText(failure.positionSeconds) ?? ''})}
      icon="i-warn" tone="warning" testID="watch-handheld-failure"
      {...(retry ? {primaryAction: {id: 'retry', label: t('next.states.tryAgain'), onPress: retry}} : {})}/>
  </View>;
}
