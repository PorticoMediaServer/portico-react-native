import {qualityControlModel, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {qualityOptionSelected} from '../../../../../packages/client-core/src/playback-v1/quality';
import {videoTrackName, videoTrackWords} from '../../../../../packages/client-core/src/video-track-labels';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativeWatchPanelNames} from './panel-model';

/** VS-3e names from the actual offers. Codec, layout and subtitle origin are
 * file facts; none of them establishes how the engine is rendering the track. */
export function createNativeWatchPanelNames(text: TextEnvironment): NativeWatchPanelNames {
  const words = videoTrackWords(defaultI18n.t, text.locale);
  const unnamed = (rows: readonly {id: string}[], id: string) => text.t('next.kit.track', {number: Math.max(0, rows.findIndex(row => row.id === id)) + 1});
  return {
    audio: (track, source) => {
      const version = source.options?.versions.find(value => value.id === source.session?.versionId);
      const rows = version?.audio ?? [track];
      const name = videoTrackName(track, words);
      // Keep the canonical ordinal fallback when neither a title nor a language
      // was supplied; counts alone never become an invented speaker layout.
      return {primary: name.first || unnamed(rows, track.id), secondary: name.rest || undefined};
    },
    subtitle: (track, source) => {
      const version = source.options?.versions.find(value => value.id === source.session?.versionId), plan = source.subtitles?.plan;
      const actual = [...(version?.subtitles ?? []), ...(plan?.resources ?? []).filter(value => !version?.subtitles.some(offered => offered.id === value.id))];
      const rows = actual.some(value => value.id === track.id) ? actual : [track];
      const origin = 'origin' in track ? track.origin === 'embedded' || track.origin === 'sidecar' ? track.origin : track.origin === 'provider' ? 'downloaded' : 'other' : track.source;
      const name = videoTrackName({...track, source: origin}, words);
      return {primary: name.first || unnamed(rows, track.id), secondary: name.rest || undefined};
    },
    quality: choice => {
      if (choice.mode === 'cd-quality') return {primary: defaultI18n.t('quality.cdQuality'), unavailable: choice.applicable === false};
      const model = qualityControlModel({choice: choice.mode === 'fixed' || choice.mode === 'limit' ? {kind: 'fixed', height: choice.maxHeight} : {kind: choice.mode}}, 'viewer', text);
      return {primary: model.optionName, secondary: model.detail.map(part => part.text).join(' · ') || undefined, unavailable: choice.applicable === false};
    },
    // tv-player 4 / phone-player 3: the audio footer names what this device loses,
    // and the quality footer says what the server is doing with the picture.
    audioFooter: source => {
      const decision = source.session?.presentation.decision.audio;
      const version = source.options?.versions.find(value => value.id === source.session?.versionId);
      const chosen = version?.audio.find(value => value.id === source.session?.presentation.audioTrackId) ?? version?.audio.find(value => value.default) ?? version?.audio[0];
      if (!decision || decision.action !== 'transcode' || chosen?.objectAudio !== 'atmos') return [];
      const layout = decision.to;
      return [defaultI18n.t('player.signal.server.atmosUnavailable', {device: 'other'}), ...(layout ? [defaultI18n.t('player.audioLoss.playing', {layout})] : [])];
    },
    qualityFooter: source => {
      const plan = source.options?.plan;
      if (!plan) return [];
      const inForce = source.session?.presentation.quality;
      const option = source.options?.qualities.find(value => qualityOptionSelected(value, inForce));
      const label = option
        ? option.mode === 'cd-quality' ? defaultI18n.t('quality.cdQuality') : qualityControlModel({choice: option.mode === 'fixed' || option.mode === 'limit' ? {kind: 'fixed', height: option.maxHeight} : {kind: option.mode}}, 'viewer', text).optionName
        : undefined;
      return [plan.mode === 'direct' ? defaultI18n.t('player.quality.playingOriginal') : defaultI18n.t('player.quality.converting', {quality: label ?? defaultI18n.t('player.opt.automatic')}),
        ...(plan.streams.some(stream => stream.reasons.includes('transcoding_disabled')) ? [defaultI18n.t('player.quality.conversionOff')] : [])];
    },
  };
}
