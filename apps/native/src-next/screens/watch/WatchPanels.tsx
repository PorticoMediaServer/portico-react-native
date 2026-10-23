import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ActivityIndicator, ScrollView, Text, View} from 'react-native';
import {sameFence} from '../../../../../packages/player-core/src';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import type {NativePlaybackAdapter} from '../../platform/playback/types';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {useOverlayLifecycle} from '../../kit/overlays/OverlayHost';
import {PanelBackground} from '../../kit/overlays/surface';
import {Icon, type IconName} from '../../kit/Icon';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeWatchHostContext} from './WatchHost';
import type {NativeWatchPanel} from './controls';
import {nativeWatchTracks} from './track-identity';
import {nativeWatchPanelRows, type NativeWatchPanelNames, type NativeWatchChoiceRow} from './panel-model';
import type {NativeWatchPanelOptions} from './panel-options';
import {nativeWatchSubtitleTiming} from './subtitle-timing';

export type NativeWatchPanelsProps = Readonly<{
  context: NativeWatchHostContext;
  options: NativeWatchPanelOptions;
  playback: NativePlaybackAdapter;
  names: NativeWatchPanelNames;
  /** Exact localized frame copy; supplied by the genuine locale binding. */
  copy: Readonly<{sessionLead: string; sessionDefaults: string; audioContinues: string}>;
  reportError: (error: unknown) => void;
  renderError: (error: unknown, retry: () => void) => React.ReactNode;
  /** Rich current-fence producer content, never the old generic File info/title details. */
  playbackInfo?: (context: NativeWatchHostContext) => React.ReactNode;
  episodes?: (context: NativeWatchHostContext) => React.ReactNode;
}>;

/** The real Options/Audio/Subtitles/Quality/Speed/Chapters renderer. The host
 * positions it inside its accepted pane/canvas. It owns no Surface or engine. */
export function NativeWatchPanels({context, options, playback, names, copy, reportError, renderError, playbackInfo, episodes}: NativeWatchPanelsProps) {
  const {source, fence, state} = context, theme = useTheme(), t = defaultI18n.t;
  const choices = useSyncExternalStore(options.subscribe, options.getSnapshot);
  const first = useRef<View>(null), scroll = useRef<ScrollView>(null), busy = useRef(false);
  const [pending, setPending] = useState(false);
  const latest = useRef(context); latest.current = context;
  const fenceKey = JSON.stringify(fence);
  const current = useCallback(() => !playback.getSnapshot().retired && sameFence(playback.getSnapshot().fence, latest.current.fence)
    && sameFence(latest.current.state.fence, latest.current.fence) && !!latest.current.state.panel, [playback]);
  const back = () => {if (current()) context.backPanel();};
  useOverlayLifecycle(!!state.panel, true, back, first, undefined, 0, 'watch-panel');
  useEffect(() => {const expected = latest.current.fence; void options.load(expected); return () => options.clear();}, [options, fenceKey]);
  useEffect(() => {scroll.current?.scrollTo({y: state.panelOffset, animated: false});}, [state.panel, state.panelOffset]);
  useEffect(() => {first.current?.requestTVFocus?.();}, [state.panel, state.panelFocus, choices.phase]);
  const run = async (command: () => Promise<void>) => {
    if (busy.current || !current()) return;
    busy.current = true; setPending(true);
    try {await command();} catch (error) {if (current()) reportError(error);}
    finally {busy.current = false; if (current()) setPending(false);}
  };
  if (!state.panel || !sameFence(state.fence, fence)) return null;
  if (state.panel === 'episodes') return episodes?.(context) ?? null;
  const ready = choices.phase === 'ready' && sameFence(choices.fence, fence) ? choices.options : undefined;
  const rows = ready ? nativeWatchPanelRows(source, ready, names) : undefined;
  const selected = nativeWatchTracks(source);
  const rateLabel = (rate: number) => rate === 1 ? t('player.opt.normalSpeed') : `${new Intl.NumberFormat(context.runtime.text.locale, {maximumFractionDigits: 2}).format(rate)}×`;
  const labels: Record<Exclude<NativeWatchPanel, 'episodes'>, string> = {options: t('player.opt.menu'), audio: t('title.audio'), subtitles: t('player.opt.subtitles'),
    quality: t('player.opt.quality'), speed: t('player.opt.speed'), chapters: t('player.opt.chapters'), 'playback-info': t('player.opt.info')};
  const chooseRow = <T,>(row: NativeWatchChoiceRow<T>, action: (value: T) => Promise<void>, preferred: boolean) => <Focusable key={row.id} ref={preferred ? first : undefined}
    focusId={`watch-choice-${row.id}`} testID={`watch-choice-${row.id}`} focusKind="row" focusRadius={theme.isTV ? 12 : 0}
    accessibilityRole="button" accessibilityLabel={[row.primary, row.secondary, row.unavailable ? t('player.opt.unavailable') : undefined].filter(Boolean).join(', ')}
    accessibilityState={{selected: row.selected, busy: pending}} disabled={!current() || pending || row.unavailable}
    onPress={() => {if (!row.selected) void run(() => action(row.value));}}
    style={({focused}) => ({minHeight: theme.isTV ? 54 : 52, paddingVertical: 8, paddingHorizontal: theme.isTV ? 14 : 12,
      flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 14 : 12, borderRadius: theme.isTV ? 12 : 0,
      backgroundColor: theme.isTV && focused ? '#edf5fa29' : 'transparent', opacity: row.unavailable ? .5 : 1,
      borderBottomWidth: theme.isTV ? 0 : 1, borderBottomColor: '#3b566873'})}>
    {({focused}) => <>
      {theme.isTV && <View style={{width: 28}}>{row.selected && <Icon name="i-check" size={24} color={theme.colors.accentStrong}/>}</View>}
      <View style={{flex: 1}}><Text style={[nativeType({size: theme.isTV ? 22 : 15, weight: 600, tracking: 0, lineHeight: 'normal'}), {color: row.selected || focused || !theme.isTV ? theme.colors.text : theme.colors.textSecondary}]}>{row.primary}</Text>
        {row.secondary && <Text style={[nativeType({size: theme.isTV ? 19 : 12.5, weight: 500, tracking: 0, lineHeight: 'normal'}), {marginTop: theme.isTV ? 2 : 1, color: row.selected || focused ? theme.colors.textSecondary : theme.colors.textTertiary}]}>{row.secondary}</Text>}</View>
      {row.unavailable ? <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('player.opt.unavailable')}</Text> : !theme.isTV && row.selected && <Icon name="i-check" size={20} color={theme.colors.accentStrong}/>}
    </>}
  </Focusable>;
  const list = <T,>(values: readonly NativeWatchChoiceRow<T>[], action: (value: T) => Promise<void>) => <View style={theme.isTV ? {padding: 4, borderRadius: 14, backgroundColor: '#edf5fa0d'} : {marginHorizontal: 12, borderRadius: 14, backgroundColor: theme.colors.raisedHigh, overflow: 'hidden'}}>
    {values.map((row, index) => chooseRow(row, action, values.some(value => value.selected && !value.unavailable) ? row.selected && !row.unavailable : index === 0))}
  </View>;
  const footer = (lines: readonly string[]) => lines.map((line, index) => <Text key={index} style={[nativeType({size: theme.isTV ? 19 : 12.5, weight: 500, tracking: 0, lineHeight: theme.isTV ? 28.5 : 18.75}), {marginHorizontal: theme.isTV ? 14 : 18, marginTop: index ? 0 : 10, color: theme.colors.textTertiary}]}>{line}</Text>);
  const retry = () => {void options.load(fence);};
  let body: React.ReactNode = null;
  if (state.panel === 'playback-info') body = playbackInfo?.(context);
  else if (choices.phase === 'failed' && state.panel !== 'audio') body = renderError(choices.error, retry);
  else if (choices.phase === 'failed') body = <View style={{padding: theme.isTV ? 14 : 24, alignItems: 'center', gap: 12}}>
    <Icon name="i-audio" size={theme.isTV ? 36 : 22}/><Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{t('player.opt.audioLoadFailed')}</Text>
    {!theme.isTV && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{copy.audioContinues}</Text>}
    <Button ref={first} focusId="watch-choices-retry" variant="glass" icon="i-restart" onPress={retry}>{t('action.tryAgain')}</Button>
  </View>;
  else if (!ready || !rows) body = <ActivityIndicator accessibilityLabel={t('player.opt.loadingAudio')}/>;
  else if (state.panel === 'audio') body = <>{list(rows.audio, track => playback.change(fence, {audioTrackId: track.id}))}{footer(names.audioFooter(source))}</>;
  else if (state.panel === 'subtitles') body = <>
    {list([{id: 'subtitle-off', primary: t('player.opt.off'), selected: selected.subtitlesOff, value: null}, ...rows.subtitles], track => playback.change(fence, {subtitleTrackId: track?.id ?? null}))}
    {selected.resource && source.subtitles?.plan && <View style={{marginHorizontal: theme.isTV ? 14 : 18, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 6}}>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text, flex: 1}]}>{t('player.opt.timing')}</Text>
      <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{t('player.opt.offsetSeconds', {seconds: new Intl.NumberFormat(context.runtime.text.locale, {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(Number(source.subtitles.plan.offsetUs) / 1_000_000)})}</Text>
      {[-500, 500].map(delta => <Button key={delta} focusId={`watch-subtitle-offset-${delta}`} variant="glass" size="small" disabled={pending || !nativeWatchSubtitleTiming(source, delta)}
        accessibilityLabel={t(delta < 0 ? 'player.opt.earlier' : 'player.opt.later')} onPress={() => {const choice = nativeWatchSubtitleTiming(playback.getSnapshot(), delta); if (choice) void run(() => playback.change(fence, choice));}}>
        {`${delta < 0 ? '−' : '+'}${new Intl.NumberFormat(context.runtime.text.locale, {minimumFractionDigits: 1, maximumFractionDigits: 1}).format(.5)}`}
      </Button>)}
    </View>}
  </>;
  else if (state.panel === 'quality') body = <>{list(rows.qualities, quality => playback.chooseQuality(fence, quality))}{footer(names.qualityFooter(source))}</>;
  else if (state.panel === 'speed') body = list(source.supportedRates.map(rate => ({id: String(rate), primary: rateLabel(rate), selected: source.effectiveRate === rate, value: rate})), async rate => {playback.setRate(fence, rate);});
  else if (state.panel === 'chapters') body = list(ready.chapters.map((chapter, index) => ({id: `${index}:${chapter.startMs}`, primary: chapter.title || t('player.chapter.numbered', {number: index + 1}), secondary: clockText(chapter.startMs / 1000), selected: source.playback.positionSeconds * 1000 >= chapter.startMs && (!ready.chapters[index + 1] || source.playback.positionSeconds * 1000 < ready.chapters[index + 1]!.startMs), value: chapter})), chapter => playback.seek(fence, chapter.startMs / 1000));
  const option = (panel: NativeWatchPanel, icon: IconName, value?: string) => <Focusable key={panel} ref={state.panel === 'options' && (state.panelFocus === panel || !state.panelFocus && panel === 'subtitles') ? first : undefined}
    focusId={`watch-option-${panel}`} testID={`watch-option-${panel}`} focusKind="row" accessibilityRole="button" onPress={() => {if (current()) context.openPanel(panel);}}
    style={({focused}) => ({minHeight: theme.isTV ? 60 : 44, paddingHorizontal: theme.isTV ? 20 : 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: theme.isTV ? 14 : 0, backgroundColor: focused ? '#edf5fa29' : undefined})}>
    {!theme.isTV && <Icon name={icon} size={18}/>}<Text style={[nativeType({size: theme.isTV ? 24 : 15, weight: 600, tracking: 0, lineHeight: 'normal'}), {color: theme.colors.text, flex: 1}]}>{labels[panel as keyof typeof labels]}</Text>
    {value && <Text style={[nativeType({size: theme.isTV ? 22 : 14, weight: 500, tracking: 0, lineHeight: 'normal'}), {color: theme.colors.textSecondary}]}>{value}</Text>}<Icon name="i-right" size={theme.isTV ? 24 : 18}/>
  </Focusable>;
  const expandedBody = body;
  if (state.panel === 'options' || theme.isTV && state.panel !== 'playback-info') body = <View style={{marginHorizontal: theme.isTV ? 0 : 12, borderRadius: 14, backgroundColor: theme.isTV ? undefined : theme.colors.raisedHigh}}>
    {option('subtitles', 'i-cc', selected.subtitlesOff ? t('player.opt.off') : rows?.subtitles.find(row => row.selected)?.primary)}
    {state.panel === 'subtitles' && expandedBody}
    {option('audio', 'i-audio', rows?.audio.find(row => row.selected)?.primary)}
    {state.panel === 'audio' && expandedBody}
    {option('quality', 'i-quality', rows?.qualities.find(row => row.selected)?.primary)}
    {state.panel === 'quality' && expandedBody}
    {option('speed', 'i-gauge', rateLabel(source.effectiveRate))}
    {state.panel === 'speed' && expandedBody}
    {!!ready?.chapters.length && option('chapters', 'i-queue')}
    {state.panel === 'chapters' && expandedBody}
    {playbackInfo && option('playback-info', 'i-pulse')}
  </View>;
  const upright = !theme.isTV && context.layout.mode === 'watch';
  return <View testID="watch-panels" style={{flex: 1, backgroundColor: theme.colors.raised, borderRadius: theme.isTV ? 0 : 20, overflow: 'hidden', paddingTop: theme.isTV ? 60 : 8, paddingLeft: theme.isTV ? 56 : 0, paddingRight: theme.isTV ? 96 : 0, paddingBottom: theme.isTV ? 56 : 20}}>
    {theme.isTV && <PanelBackground/>}
    {upright && <View pointerEvents="none" style={{height: 5, width: 36, borderRadius: 3, backgroundColor: '#9bbdce66', alignSelf: 'center', marginBottom: 10}}/>}
    <FocusRegion id="watch-panel" hold orientation="vertical" style={{flex: 1}}>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: theme.isTV ? 0 : 6, paddingBottom: theme.isTV ? 0 : 8}}>
        {!theme.isTV && state.panel !== 'options' && <Button focusId="watch-panel-back" variant="text" iconOnly icon="i-left" accessibilityLabel={t('player.opt.menu')} onPress={back}/>}
        <Text accessibilityRole="header" style={[nativeType({size: theme.isTV ? 44 : upright ? 19 : 18, weight: 800, tracking: theme.isTV ? -.03 : -.02, lineHeight: 'normal'}), {color: theme.colors.text, flex: 1}]}>{theme.isTV && state.panel !== 'playback-info' ? t('player.opt.menu') : labels[state.panel]}</Text>
        {!theme.isTV && (upright ? <Button focusId="watch-panel-close" variant="text" textStyle={{color: theme.colors.accentStrong}} onPress={context.closePanel}>{t('action.done')}</Button>
          : <Button focusId="watch-panel-close" variant="text" iconOnly icon="i-close" accessibilityLabel={t('action.close')} onPress={context.closePanel}/>)}
      </View>
      {(theme.isTV && state.panel !== 'playback-info' || state.panel === 'options') && <Text style={[nativeType({size: theme.isTV ? 22 : 12.5, weight: 400, tracking: 0, lineHeight: theme.isTV ? 31.9 : 18.125}), {marginTop: theme.isTV ? 10 : 2, marginBottom: theme.isTV ? 20 : 10, marginHorizontal: theme.isTV ? 0 : 18, color: theme.colors.textSecondary}]}><Text style={{fontFamily: theme.type.bodyStrong.fontFamily}}>{copy.sessionLead}</Text>{' '}{copy.sessionDefaults}</Text>}
      <ScrollView ref={scroll} contentContainerStyle={{paddingTop: theme.isTV ? 4 : 0, paddingBottom: theme.isTV ? 72 : 12}} onScroll={event => {if (current()) context.rememberPanel(event.nativeEvent.contentOffset.y);}} scrollEventThrottle={32}>{body}</ScrollView>
      {theme.isTV && <View style={{flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 14}}><Text style={[theme.type.caption, {color: theme.colors.textSecondary, borderWidth: 1, borderColor: theme.colors.textTertiary, borderRadius: 6, padding: 4}]}>{t('action.back')}</Text><Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('action.close')}</Text></View>}
    </FocusRegion>
  </View>;
}
