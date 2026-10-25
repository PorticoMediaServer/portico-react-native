import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Text, View} from 'react-native';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import {videoTrackWords} from '../../../../../packages/client-core/src/video-track-labels';
import {codecName} from '../../../../../packages/client-core/src/presentation/playback-info';
import type {PlaybackInfoField, PlaybackInfoWords} from '../../../../../packages/client-core/src/playback-info-projection';
import type {NativePlaybackReadLifetime} from '../../platform/playback/types';
import {Button} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import type {NativeWatchHostContext} from './WatchHost';
import type {NativePlaybackInfo} from './playback-info';

const t = defaultI18n.t;
const route = {original: 'next.kit.originalDelivery', repackaged: 'next.kit.repackaged', converted: 'next.kit.converting'} as const;
const fields: Record<PlaybackInfoField, MessageId> = {
  container: 'next.kit.container', codec: 'next.watch.info.codec', hdr: 'next.kit.hdr', bitDepth: 'next.watch.info.bitDepth',
  resolution: 'next.kit.resolution', frameRate: 'next.kit.frameRate', screen: 'next.watch.info.screen',
  format: 'next.watch.info.format', channels: 'next.watch.info.channels', sampleRate: 'next.watch.info.sampleRate',
  output: 'next.watch.info.output', track: 'next.watch.info.track', shown: 'next.watch.info.shown',
};
const range = (value: string | undefined) => value === 'sdr' ? t('next.watch.info.sdr') : value === 'hdr10' ? t('next.kit.hdr.hdr10')
  : value === 'hdr10plus' ? t('next.kit.hdr.hdr10Plus') : value === 'hlg' ? t('next.kit.hdr.hlg')
    : value === 'dolby_vision' ? t('next.kit.hdr.dolbyVision') : '';
function words(): PlaybackInfoWords {
  return {tracks: videoTrackWords(t), standardRange: t('next.watch.info.sdr'),
    hls: container => t('next.watch.info.hls', {container}), bitDepth: bits => t('next.kit.bitDepth', {bits}),
    frameRate: rate => t('next.kit.fps', {rate}), sampleRate: rate => t('next.watch.info.khz', {rate}),
    dolbyVision: (profile, enhancement) => t('next.watch.info.dolbyVision', {details: [profile, enhancement].filter(Boolean).join(' ')}).trim(),
    convertedFromDolbyVision: (delivered, profile, enhancement) => t('next.watch.info.convertedVision', {delivered, profile, enhancement: enhancement ?? ''}).trim(),
    reason: reason => reason.kind === 'compatible' ? undefined : reason.kind === 'container' ? t('next.kit.reason.container')
      : reason.kind === 'subtitles' ? t('next.kit.reason.subtitles') : t('player.info.reason.unknown'),
    loss: loss => t('next.watch.info.lost', {feature: t(loss.feature === 'dolbyVision' ? 'next.kit.hdr.dolbyVision'
      : loss.feature === 'hdr' ? 'next.kit.hdr' : loss.feature === 'atmos' ? 'next.kit.object.atmos' : 'next.kit.object.dtsx')}),
    network: (network, measured) => [network === 'home' ? t('next.kit.session.local') : network === 'away' ? t('next.kit.session.remote') : undefined,
      measured ? t('next.kit.kbps', {rate: measured}) : undefined].filter(Boolean).join(' ') || undefined,
    screen: value => [range(value.dynamicRange), value.refreshRateHz ? t('next.watch.info.hz', {rate: value.refreshRateHz}) : undefined].filter(Boolean).join(' ') || undefined,
    output: value => [value.handling ? t(`next.watch.info.${value.handling}`) : undefined, codecName(value.codec),
      value.channels ? t('mediaInfo.channels', {count: value.channels}) : undefined,
      value.sampleRate ? t('next.watch.info.khz', {rate: value.sampleRate / 1000}) : undefined,
      value.bitDepth ? t('next.kit.bitDepth', {bits: value.bitDepth}) : undefined].filter(Boolean).join(' ') || undefined,
    shown: value => t(`next.watch.info.${value}`),
  };
}
export type NativePlaybackInfoReader = (fence: PlaybackFence, words: PlaybackInfoWords, lifetime: NativePlaybackReadLifetime) => Promise<NativePlaybackInfo | undefined>;

/** Read only on committed mount or explicit Retry. The existing factory owns authority and transport. */
export function NativePlaybackInfoPanel({context, read, renderError}: {
  context: NativeWatchHostContext; read: NativePlaybackInfoReader;
  renderError: (error: unknown, retry: () => void) => React.ReactNode;
}) {
  const theme = useTheme(), latest = useRef(context); latest.current = context;
  const [retry, setRetry] = useState(0), [result, setResult] = useState<{identity: string; runtime: NativeWatchHostContext['runtime']; value?: NativePlaybackInfo; error?: unknown}>();
  const identity = JSON.stringify([context.fence, context.source.lease]);
  const runtime = context.runtime;
  useEffect(() => {
    const captured = latest.current, abort = new AbortController();
    const current = () => !abort.signal.aborted && latest.current.runtime === runtime
      && latest.current.source.lease === captured.source.lease && !latest.current.source.retired
      && latest.current.state.panel === 'playback-info' && sameFence(latest.current.fence, captured.fence)
      && sameFence(latest.current.source.fence, captured.fence) && sameFence(latest.current.state.fence, captured.fence);
    setResult(undefined);
    const deadline = setTimeout(() => {
      if (current()) setResult({identity, runtime});
      abort.abort();
    }, 15000);
    if (current()) void read(captured.fence, words(), {signal: abort.signal, isCurrent: current})
      .then(value => {if (current()) setResult({identity, runtime, value});})
      .catch(error => {if (current()) setResult({identity, runtime, error});})
      .finally(() => clearTimeout(deadline));
    return () => {clearTimeout(deadline); abort.abort();};
  }, [identity, runtime, read, retry]);
  if (!result || result.identity !== identity || result.runtime !== runtime) return <ActivityIndicator accessibilityLabel={t('player.opt.info')}/>;
  if (result.error !== undefined) return <>{renderError(result.error, () => setRetry(value => value + 1))}</>;
  const comparison = result.value?.comparison;
  if (!comparison) return <View style={{gap: 12}}><Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.watch.info.unavailable')}</Text>
    <Button variant="glass" onPress={() => setRetry(value => value + 1)}>{t('action.tryAgain')}</Button></View>;
  const label = [theme.type.caption, {color: theme.colors.textSecondary}], value = [theme.type.body, {color: theme.colors.text}];
  return <View testID="watch-playback-info-comparison" style={{gap: 18, padding: theme.isTV ? 12 : 16}}>
    <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t(route[comparison.route])}</Text>
    {!!comparison.explanation && <Text style={value}>{comparison.explanation}</Text>}
    {!!comparison.networkAndBitrate && <Text style={label}>{comparison.networkAndBitrate}</Text>}
    {comparison.sections.map(section => <View key={section.kind} style={{gap: 10}}>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t(section.kind === 'picture' ? 'next.kit.video' : section.kind === 'sound' ? 'next.kit.audio' : 'next.kit.subtitles')}</Text>
      <Text style={label}>{t(route[section.route])}</Text>
      <View style={{flexDirection: 'row', gap: 12}}><View style={{flex: 1}}/><Text style={[label, {flex: 1}]}>{t('next.watch.info.source')}</Text><Text style={[label, {flex: 1}]}>{t('next.watch.info.delivered')}</Text></View>
      {section.rows.map(row => <View key={row.field} style={{flexDirection: 'row', gap: 12}}>
        <Text style={[label, {flex: 1}]}>{t(fields[row.field])}</Text><Text style={[value, {flex: 1}]}>{row.source}</Text>
        <Text style={[value, {flex: 1, color: row.changed ? theme.colors.accentStrong : theme.colors.text}]}>{row.delivered}</Text>
      </View>)}
      {section.losses.map((loss, index) => <Text key={index} style={label}>{loss}</Text>)}
    </View>)}
  </View>;
}
