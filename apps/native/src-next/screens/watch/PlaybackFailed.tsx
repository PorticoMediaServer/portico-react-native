import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {playbackIdentity} from '../../../../../packages/client-core/src/presentation/kit-model';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {PlaybackFence} from '../../../../../packages/player-core/src';
import {Button} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {useTheme} from '../../kit/theme';
import type {NativeWatchHostContext} from './WatchHost';

/** The exact playback that failed: its fence, session and saved place. A callback
 * reads only this, never the live context, so a successor start is never touched. */
export type NativePlaybackFailure = Readonly<{fence: PlaybackFence; sessionId?: string; positionSeconds: number; itemId?: string}>;

/** states 11: the ten-foot failure state. The frozen picture stays behind it,
 * the bar below keeps working, and nothing here retries by itself. The retry
 * control exists only when the runtime supplies its own resume port. */
export function NativePlaybackFailed({context, failure, retry, details, chromeVisible}: {
  context: NativeWatchHostContext;
  failure: NativePlaybackFailure;
  retry?: (failure: NativePlaybackFailure) => void;
  details?: (failure: NativePlaybackFailure) => void;
  /** The overlay's own title lockup is drawn once; the state adds it only when the overlay is down. */
  chromeVisible: boolean;
}) {
  const theme = useTheme(), t = defaultI18n.t;
  const identity = context.source.subject ? playbackIdentity(context.source.subject, 'full', context.runtime.text) : undefined;
  // states 11 places the block at left 96, top 486 and centres it on its own height.
  const [blockHeight, setBlockHeight] = React.useState(0);
  const position = clockText(failure.positionSeconds);
  const body = t('next.states.native.tvStoppedBody', {position: position ?? ''});
  return <View testID="watch-playback-failed" pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: '#03080c8c'}]}/>
    {!chromeVisible && identity && <View pointerEvents="none" style={{position: 'absolute', left: 96, right: 96, top: 72}}>
      <Text numberOfLines={1} style={{fontFamily: theme.type.bodyStrong.fontFamily, fontSize: 44, lineHeight: 48.4, fontWeight: '800', letterSpacing: -1.32, marginBottom: 6, color: theme.colors.text}}>{identity.title}</Text>
      <View style={{flexDirection: 'row', alignItems: 'baseline', marginTop: 4}}>
        {identity.subtitle.map((part, index) => <Text key={`${part.role}:${index}`} numberOfLines={1} ellipsizeMode="tail"
          style={{fontFamily: theme.type.bodyStrong.fontFamily, fontSize: 24, lineHeight: 32, fontWeight: index === 0 ? '700' : '600',
            marginRight: 22, color: index === 0 ? theme.colors.text : theme.colors.textSecondary}}>{part.text}</Text>)}
      </View>
    </View>}
    <View pointerEvents="box-none" onLayout={event => {const height = event.nativeEvent.layout.height; if (height !== blockHeight) setBlockHeight(height);}}
      style={{position: 'absolute', left: 96, top: 486, transform: [{translateY: -blockHeight / 2}], width: 1000, maxWidth: '100%'}}>
      <View style={{width: 88, height: 88, borderRadius: 44, marginBottom: 34, alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(237,245,250,.1)', borderWidth: 1, borderColor: 'rgba(237,245,250,.12)'}}>
        <Icon name="i-warn" size={40} color={theme.colors.amber}/>
      </View>
      <Text accessibilityRole="header" style={{fontFamily: theme.type.bodyStrong.fontFamily, fontSize: 72, lineHeight: 72, fontWeight: '800', letterSpacing: -3.24,
        marginBottom: 24, color: theme.colors.text, textShadowColor: 'rgba(7,16,24,.5)', textShadowOffset: {width: 0, height: 2}, textShadowRadius: 30}}>{t('next.states.playbackStopped')}</Text>
      <Text style={{fontSize: 28, lineHeight: 40.6, fontWeight: '400', marginBottom: 28, maxWidth: 900, color: theme.colors.textSecondary}}>{body}</Text>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 18}}>
        {retry && <Button focusId="watch-failed-retry" testID="watch-failed-retry" icon="i-restart" hasTVPreferredFocus onPress={() => retry(failure)}>{t('next.states.tryAgain')}</Button>}
        {details && <Button focusId="watch-failed-details" testID="watch-failed-details" variant="glass" onPress={() => details(failure)}>{t('next.states.details')}</Button>}
      </View>
    </View>
  </View>;
}
