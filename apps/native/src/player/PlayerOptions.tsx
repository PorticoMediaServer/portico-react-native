import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {Animated, Pressable, ScrollView, StyleSheet, TVFocusGuideView, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import type {MediaItem} from '../../../../packages/client-core/src/index';
import {useSession} from '../app/session';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {defaultI18n} from '../../../../packages/i18n/src/index';
import {Button, ListRow, Notice, Sheet, StateView, Text, ToggleRow, alpha, showToast, useTheme, type IconName} from '../ui';
import type {PlayerEngine} from './usePlayer';
import {bitmapWarningNeeded, isBitmapResource, ownerPlaybackSwitches, textTrackForLanguage, trackName} from '../../../../packages/client-core/src/presentation/index';
import {playbackInfoRows, qualityNetworkFooter} from '../../../../packages/client-core/src/presentation/index';
import {PlaybackApiError} from '../../../../packages/client-core/src/playback-v1/http';
import {qualityOptionSelected, type QualityInForce, type QualityOption} from '../../../../packages/client-core/src/playback-v1/quality';
import {queueSaveMessage, type QueuePlaylistSave} from '../../../../packages/client-core/src/playback-v1/queue';
import {subtitleReason} from '../../../../packages/client-core/src/subtitles';
import {useArtwork} from '../app/content';
import {formatClock} from '../app/content';
import {usePreferences} from '../app/preferences';
import {useServerPreferences} from '../app/server-preferences';
import {engineSettings} from './engine-choice';
import {engineSettingStore} from './engine-setting-store';
import {chapterAt} from './engine-media';
import {playerSettingsSupport} from '../bridge/native-listening-kinds';
import {usePlaybackChoice} from './playback-choice';

export type OptionKey = 'audio' | 'subtitles' | 'quality' | 'speed' | 'sleep' | 'menu' | 'queue' | 'info' | 'engine' | 'chapters' | 'version';

/** A quality as the menu and the option box name it: "Original", "Automatic", "1080p". */
export function qualityName(quality: Readonly<{mode: string; id?: string; maxHeight?: number}> | undefined, t: (id: 'player.quality.original' | 'player.quality.automatic' | 'quality.height' | 'quality.4k', values?: {height: number}) => string): string {
  if (!quality || quality.mode === 'original') return t('player.quality.original');
  if (quality.mode === 'automatic') return t('player.quality.automatic');
  const height = quality.id && /^\d+p$/.test(quality.id) ? Number(quality.id.slice(0, -1)) : quality.maxHeight;
  return height ? (height >= 2160 ? t('quality.4k') : t('quality.height', {height})) : t('player.quality.original');
}

/** The quality in force, said in a few words: "Original", "720p", "Automatic · 720p". */
export function qualityInForceLabel(inForce: QualityInForce | undefined, t: ReturnType<typeof useI18n>['t']): string {
  if (inForce?.mode !== 'automatic' || !inForce.id) return qualityName(inForce, t);
  return t('player.quality.automaticNow', {quality: qualityName({mode: 'fixed', id: inForce.id}, t)});
}
export const optionBoxes: {key: OptionKey; label: string; icon: IconName}[] = [
  {key: 'audio', label: defaultI18n.t('player.opt.audio'), icon: 'audio'},
  {key: 'subtitles', label: defaultI18n.t('player.opt.subtitles'), icon: 'subtitles'},
  {key: 'quality', label: defaultI18n.t('player.opt.quality'), icon: 'quality'},
  {key: 'speed', label: defaultI18n.t('player.opt.speed'), icon: 'speed'},
  {key: 'sleep', label: defaultI18n.t('player.opt.sleep'), icon: 'sleep'},
];
/** The boxes for what is playing: music has no Speed (an audiobook keeps it). */
/** The option boxes for what is playing. Speed is left out for music, and on a device whose
 * player has one speed only (`playerSettingsSupport`). */
export const optionBoxesFor = (music: boolean) => (music || !playerSettingsSupport.playbackSpeed ? optionBoxes.filter(o => o.key !== 'speed') : optionBoxes);
const titleIds = {audio: 'player.opt.audio', subtitles: 'player.opt.subtitles', quality: 'player.opt.quality', speed: 'player.opt.speed', sleep: 'player.opt.sleepTimer', menu: 'player.opt.menu', queue: 'player.queue', info: 'player.opt.info'} as const;
const titles = {...Object.fromEntries(Object.entries(titleIds).map(([k, id]) => [k, defaultI18n.t(id)])), engine: defaultI18n.t('settings.row.player'), chapters: defaultI18n.t('player.opt.chapters'), version: defaultI18n.t('title.version')} as Record<OptionKey, string>;

/** A window rectangle an option panel hangs from (the box that opened it). */
export type OptionAnchor = {x: number; y: number; width: number; height: number};

type Props = {
  option: OptionKey | null;
  anchor?: OptionAnchor;
  /** The option was reached from the Playback options list, so it shows a way back to it. */
  fromMenu: boolean;
  compact: boolean;
  engine: PlayerEngine;
  valueOf: (key: OptionKey) => string;
  onClose: () => void;
  onPick: (key: OptionKey) => void;
  onReport?: () => void;
  upcoming: number;
  /** MU4 FEAT-07: on a channel, the menu also opens the mini guide and records. */
  isChannel?: boolean;
  onMiniGuide?: () => void;
  canRecordLive?: boolean;
  onRecordLive?: () => void;
};

/**
 * APL-PLAYER-02: where an option opens depends on the device.
 * - iPhone portrait: one bottom sheet, and choosing an option pushes within it ("‹ Playback
 *   options" goes back), so the sheet never closes and reopens.
 * - iPad and landscape phone: a popover anchored above the box that opened it (fade + 6 pt rise).
 * - Television: a right-edge panel, full height. Focus goes to the selected choice, and Menu
 *   returns focus to the box that opened it (the caller restores it).
 */
export function PlayerOptions(props: Props) {
  const {option, anchor, compact, onClose} = props;
  const {isTV} = useTheme();
  const body = option ? <OptionBody {...props} /> : null;
  if (isTV) return option ? <SidePanel title={titles[option]} onClose={onClose}>{body}</SidePanel> : null;
  if (compact || !anchor || option === 'queue' || option === 'info') {
    return (
      <Sheet open={option !== null} onClose={onClose} title={option ? titles[option] : ''} kind="picker" placement={compact ? 'auto' : 'center'}>
        {body}
      </Sheet>
    );
  }
  return option ? <Popover anchor={anchor} title={titles[option]} onClose={onClose}>{body}</Popover> : null;
}

function SidePanel({title, onClose, children}: {title: string; onClose: () => void; children: React.ReactNode}) {
  const {colors, space} = useTheme();
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(slide, {toValue: 1, duration: 160, useNativeDriver: true}).start(); }, [slide]);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={[StyleSheet.absoluteFill, {backgroundColor: alpha(colors.black, 0.35)}]} onPress={onClose} focusable={false} accessibilityLabel={defaultI18n.t('action.dismiss')} />
      <Animated.View style={{position: 'absolute', top: 0, bottom: 0, right: 0, width: 560, backgroundColor: colors.overlaySurface, borderLeftWidth: 1, borderLeftColor: colors.lineSoft, opacity: slide, transform: [{translateX: slide.interpolate({inputRange: [0, 1], outputRange: [40, 0]})}]}}>
        <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={{flex: 1, paddingTop: Math.max(insets.top, 60), paddingBottom: 40}}>
          <Text variant="heading" style={{paddingHorizontal: 28, marginBottom: space.sm}}>{title}</Text>
          {/* The top padding keeps the first row's focus ring inside the scroll view's clip. */}
          <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingTop: space.sm, paddingBottom: space.xl}}>{children}</ScrollView>
        </TVFocusGuideView>
      </Animated.View>
    </View>
  );
}

function Popover({anchor, title, onClose, children}: {anchor: OptionAnchor; title: string; onClose: () => void; children: React.ReactNode}) {
  const {colors, space, metrics, window} = useTheme();
  const insets = useSafeAreaInsets();
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(rise, {toValue: 1, duration: 140, useNativeDriver: true}).start(); }, [rise]);
  const width = Math.min(380, window.width - space.md * 2);
  const left = Math.max(space.md, Math.min(anchor.x + anchor.width / 2 - width / 2, window.width - width - space.md));
  const bottom = window.height - anchor.y + space.sm;
  const maxHeight = Math.max(200, anchor.y - Math.max(insets.top, space.md) - space.md);
  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel={defaultI18n.t('action.dismiss')} />
      <Animated.View accessibilityRole="menu" style={{position: 'absolute', left, bottom, width, maxHeight, backgroundColor: colors.overlaySurface, borderRadius: metrics.radius.panel, borderWidth: 1, borderColor: alpha(colors.lineStrong, 0.7), overflow: 'hidden', opacity: rise, transform: [{translateY: rise.interpolate({inputRange: [0, 1], outputRange: [6, 0]})}]}}>
        <Text variant="label" tone="tertiary" style={{paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.xs}}>{title}</Text>
        <ScrollView contentContainerStyle={{paddingHorizontal: space.sm, paddingBottom: space.sm}}>{children}</ScrollView>
      </Animated.View>
    </View>
  );
}

function OptionBody({option, engine, valueOf, onClose, onPick, fromMenu, compact, onReport, upcoming, isChannel, onMiniGuide, canRecordLive, onRecordLive}: Props) {
  const {state} = engine;
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const device = usePreferences();
  // A player chosen here is for this playback; Settings keeps the one every playback starts with.
  const playerInForce = useSyncExternalStore(engineSettingStore.subscribe, engineSettingStore.get);
  const back = fromMenu && option !== 'menu' ? <ListRow icon="back" title={i18n.t('player.opt.menu')} onPress={() => onPick('menu')} /> : null;
  // TV: a panel whose content has nothing to choose (loading, one track, info) still needs a focus stop inside its trapped guide.
  const closeRow = isTV ? <ListRow icon="close" title={i18n.t('player.opt.close')} hasTVPreferredFocus={!back} onPress={onClose} /> : null;
  let body: React.ReactNode = null;
  if (option === 'menu') {
    const hasChapters = engine.chapters.length > 1, hasVersions = engine.versions.list.length > 1;
    // The first row takes focus when the panel opens (TV), whichever rows this playback has.
    const rows = [compact ? 'boxes' : '', isChannel && onMiniGuide ? 'guide' : '', isChannel && canRecordLive && onRecordLive ? 'record' : '', upcoming > 0 ? 'queue' : '', onReport ? 'report' : '', hasChapters ? 'chapters' : '', hasVersions ? 'version' : '', engine.engineSelectable ? 'engine' : ''].filter(Boolean);
    const first = (key: string) => rows[0] === key;
    body = (
      <>
        {compact ? optionBoxesFor(engine.identity.kind === 'song').map((o, i) => <ListRow key={o.key} icon={o.icon} title={o.label} meta={valueOf(o.key)} trailingIcon="forward" hasTVPreferredFocus={i === 0} onPress={() => onPick(o.key)} />) : null}
        {/* MU4 FEAT-07: on a channel the menu opens the mini guide and records the programme. */}
        {isChannel && onMiniGuide ? <ListRow icon="channels" title={i18n.t('player.live.guide')} trailingIcon="forward" hasTVPreferredFocus={first('guide')} onPress={() => { onClose(); onMiniGuide(); }} /> : null}
        {isChannel && canRecordLive && onRecordLive ? <ListRow icon="dvr" title={i18n.t('guide.record')} hasTVPreferredFocus={first('record')} onPress={() => { onClose(); onRecordLive(); }} /> : null}
        {upcoming > 0 ? <ListRow icon="queue" title={i18n.t('player.queue')} meta={String(upcoming)} trailingIcon="forward" hasTVPreferredFocus={first('queue')} onPress={() => onPick('queue')} /> : null}
        {onReport ? <ListRow icon="flag" title={i18n.t('player.reportProblem')} hasTVPreferredFocus={first('report')} onPress={() => { onClose(); onReport(); }} /> : null}
        {/* The title's chapters, and its other versions (an edition, another copy), when it has them. */}
        {hasChapters ? <ListRow icon="queue" title={i18n.t('player.opt.chapters')} meta={chapterTitle(chapterAt(engine.chapters, state.positionSeconds), engine.chapters, i18n)} trailingIcon="forward" hasTVPreferredFocus={first('chapters')} onPress={() => onPick('chapters')} /> : null}
        {hasVersions ? <ListRow icon="quality" title={i18n.t('title.version')} meta={engine.versions.list.find(v => v.id === engine.versions.playingId)?.label} trailingIcon="forward" hasTVPreferredFocus={first('version')} onPress={() => onPick('version')} /> : null}
        {/* Which player plays this title: changing it moves the title across where it stands. */}
        {engine.engineSelectable ? <ListRow icon="settings" title={i18n.t('settings.row.player')} meta={i18n.t(`settings.player.${playerInForce}`)} trailingIcon="forward" hasTVPreferredFocus={first('engine')} onPress={() => onPick('engine')} /> : null}
        {!rows.length ? closeRow : null}
      </>
    );
  } else if (option === 'engine') {
    body = engineSettings.map(value => (
      <ListRow key={value} title={i18n.t(`settings.player.${value}`)} selected={playerInForce === value} hasTVPreferredFocus={playerInForce === value} onPress={() => { engineSettingStore.setSession(value === device.preferences.playerEngine ? null : value); onClose(); }} />
    ));
  } else if (option === 'chapters') {
    const current = chapterAt(engine.chapters, state.pendingSeek?.positionSeconds ?? state.positionSeconds);
    body = engine.chapters.map((chapter, index) => (
      <ListRow key={`${index}:${chapter.startSeconds}`} {...(chapter.thumbnail ? {source: artwork(chapter.thumbnail), shape: 'landscape' as const} : {ordinal: index + 1})} title={chapterTitle(chapter, engine.chapters, i18n)} meta={formatClock(chapter.startSeconds)} selected={chapter === current} hasTVPreferredFocus={chapter === current || (!current && index === 0)} onPress={() => { engine.seekTo(chapter.startSeconds); onClose(); }} />
    ));
  } else if (option === 'version') {
    body = engine.versions.list.map(version => {
      const current = version.id === engine.versions.playingId;
      const video = version.video[0];
      return <ListRow key={version.id} title={version.label || version.edition || i18n.t('title.version')} subtitle={[version.edition && version.edition !== version.label ? version.edition : '', video?.height ? i18n.t('quality.height', {height: video.height}) : '', version.container?.toUpperCase() ?? ''].filter(Boolean).join(' · ')} selected={current} hasTVPreferredFocus={current}
        onPress={() => { if (!current) engine.versions.choose(version.id).catch(() => showToast({message: i18n.t('player.opt.versionChangeFailed'), icon: 'warning'})); onClose(); }} />;
    });
  } else if (option === 'speed') {
    body = engine.rates.map(rate => (
      <ListRow key={rate} title={rate === 1 ? i18n.t('player.opt.normalSpeed') : `${rate}×`} selected={engine.speedState.desired === rate} hasTVPreferredFocus={engine.speedState.desired === rate} disabled={engine.speedState.ready && !engine.speedState.supported.includes(rate)} onPress={() => { engine.setRate(rate); onClose(); }} />
    ));
  } else if (option === 'audio') {
    const audio = state.audio;
    const tracks = engine.state.audioTracks;
    body = (!audio.plan || audio.availability === 'unavailable') && tracks ? tracks.tracks.map(t => {
      const selected = t.streamIndex === (tracks.pending ?? tracks.selected);
      return <ListRow key={t.streamIndex} title={t.label} selected={selected} hasTVPreferredFocus={selected} onPress={() => { engine.selectAudioTrack(t.streamIndex).catch(() => showToast({message: i18n.t('player.opt.audioChangeFailed'), icon: 'warning'})); onClose(); }} />;
    }) : audio.plan ? (
      audio.plan.renditions.map(r => {
        const current = (audio.pending?.renditionId ?? audio.observedRenditionId ?? audio.plan?.defaultRenditionId) === r.id;
        const unavailable = r.unavailable || audio.unavailableRenditionIds?.includes(r.id);
        return <ListRow key={r.id} title={r.label} subtitle={unavailable ? i18n.t('player.opt.unavailable') : r.language} disabled={unavailable} selected={current} hasTVPreferredFocus={current} onPress={() => { engine.service.selectAudio(r.id); onClose(); }} />;
      })
    ) : (
      <>
        <StateView icon="audio" title={audio.availability === 'loading' ? i18n.t('player.opt.checkingAudio') : i18n.t('player.opt.oneAudioTrack')} loading={audio.availability === 'loading'} action={engine.audioSelection.canRetry ? i18n.t('action.tryAgain') : undefined} onAction={engine.audioSelection.retry} />
        {engine.audioSelection.canRetry ? null : closeRow}
      </>
    );
  } else if (option === 'subtitles') {
    body = <SubtitleChoices engine={engine} onClose={onClose} closeRow={closeRow} />;
  } else if (option === 'quality') {
    const {options, inForce, offers, choose} = engine.quality;
    // ARCH-API-08: converting is the owner's to turn off (the transcoding switch, from the offers).
    const owner = ownerPlaybackSwitches(offers);
    /* MU4 CON-26: the footer from the same delivery policy as web
     * ("Home network · up to 1080p" / "Away from home · up to 1080p"). */
    const footer = qualityNetworkFooter(offers?.deliveryPolicy);
    const footerLine = footer.network && footer.height ? i18n.t('quality.networkLimit', {network: i18n.t(footer.network === 'home' ? 'network.home' : 'network.away'), height: footer.height}) : '';
    const pick = (option: QualityOption) => {
      if (!qualityOptionSelected(option, inForce)) choose(option).catch((e: unknown) => showToast({message: qualityFailure(e, i18n), icon: 'warning'}));
      onClose();
    };
    const help = (option: QualityOption): string | undefined => {
      if (option.mode === 'original') return i18n.t('player.quality.originalHelp');
      if (!owner.transcoding) return i18n.t('player.ownerOff');
      if (option.mode === 'automatic') return inForce?.mode === 'automatic' && inForce.id ? qualityInForceLabel(inForce, i18n.t) : i18n.t('web.player.quality.automaticHelp');
      return option.maxHeight ? i18n.t('player.quality.fixedHelp', {height: option.maxHeight}) : undefined;
    };
    body = (
      <>
        {options.map(option => {
          const selected = qualityOptionSelected(option, inForce);
          return <ListRow key={option.id ?? option.mode} title={qualityName(option, i18n.t)} subtitle={help(option)} selected={selected} hasTVPreferredFocus={selected} disabled={engine.quality.busy || (option.mode !== 'original' && !owner.transcoding)} onPress={() => pick(option)} />;
        })}
        {!options.length ? <><Text variant="caption" tone="tertiary" style={{padding: space.md}}>{i18n.t('player.opt.qualityLater')}</Text>{closeRow}</> : null}
        {footerLine || (offers && !offers.transcodingEnabled) ? <Text variant="caption" tone="tertiary" style={{paddingHorizontal: space.md, paddingTop: space.sm}}>{[footerLine, offers && !offers.transcodingEnabled ? i18n.t('player.opt.conversionOff') : ''].filter(Boolean).join(' · ')}</Text> : null}
      </>
    );
  } else if (option === 'sleep') {
    const off = !state.listeningDeadlines?.sleepAtMs;
    const setSleep = (minutes: number | null) => { engine.service.setListeningDeadline('sleep', minutes).catch(() => showToast({message: i18n.t('player.opt.sleepFailed'), icon: 'warning'})); onClose(); };
    body = (
      <>
        {/* With a timer running, Off still takes focus: it's the one choice that changes something. */}
        <ListRow title={i18n.t('player.opt.off')} selected={off} hasTVPreferredFocus onPress={() => setSleep(null)} />
        {[15, 30, 45, 60].map(minutes => (
          <ListRow key={minutes} title={i18n.t('player.opt.minutes', {count: minutes})} onPress={() => setSleep(minutes)} />
        ))}
      </>
    );
  } else if (option === 'info') {
    body = <><PlaybackInfo engine={engine} />{closeRow}</>;
  } else if (option === 'queue') {
    body = <UpNext engine={engine} onClose={onClose} closeRow={closeRow} />;
  }
  return <>{back}{body}</>;
}

/** What to say when a quality could not be put in force. A connection too slow for it is said so,
 * with the quality that would fit when the server named one. */
function qualityFailure(error: unknown, i18n: ReturnType<typeof useI18n>): string {
  if (error instanceof PlaybackApiError && error.code === 'connection_too_slow') {
    const fits = (error as {reason?: unknown}).reason;
    return typeof fits === 'string' && /^\d+p$/.test(fits) ? i18n.t('player.quality.tooSlow', {quality: qualityName({mode: 'fixed', id: fits}, i18n.t)}) : i18n.t('player.quality.tooSlowAny');
  }
  return i18n.t('web.player.quality.changeFailed');
}

/** A chapter's name: its own title, or its number among the title's chapters. */
function chapterTitle(chapter: PlayerEngine['chapters'][number] | undefined, chapters: PlayerEngine['chapters'], i18n: ReturnType<typeof useI18n>): string {
  if (!chapter) return '';
  return chapter.title || i18n.t('player.chapter.numbered', {number: chapters.indexOf(chapter) + 1});
}

const captionSizes = ['small', 'medium', 'large', 'extra-large'] as const;
const captionBackgrounds = ['translucent', 'opaque', 'none'] as const;

/**
 * How the subtitles this device draws look. They start as the profile's size and background (the
 * same two settings the Settings page has); a change made here is for this playback only, and
 * the next one starts from the Settings again. Each press moves to the next choice, and the line
 * on screen follows at once.
 */
function CaptionStyleRows({run}: {run: number}) {
  const i18n = useI18n();
  const prefs = useServerPreferences();
  const has = (key: string) => !prefs.snapshot || !!prefs.snapshot.registry.fields.some(f => f.key === key);
  const [size, setSize] = usePlaybackChoice('subtitleSize', run, prefs.value<string>('playback.subtitleSize', 'medium'));
  const [background, setBackground] = usePlaybackChoice('subtitleBackground', run, prefs.value<string>('playback.subtitleBackground', 'translucent'));
  const next = <T extends string>(all: readonly T[], current: string): T => all[(Math.max(0, all.indexOf(current as T)) + 1) % all.length]!;
  return (
    <>
      {has('playback.subtitleSize') ? <ListRow title={i18n.t('settings.row.subtitleSize')} meta={i18n.t(`settings.subtitleSize.${captionSizes.find(v => v === size) ?? 'medium'}`)} accessory="value" onPress={() => setSize(next(captionSizes, size))} /> : null}
      {has('playback.subtitleBackground') ? <ListRow title={i18n.t('settings.row.subtitleBackground')} meta={i18n.t(`settings.subtitleBackground.${captionBackgrounds.find(v => v === background) ?? 'translucent'}`)} accessory="value" onPress={() => setBackground(next(captionBackgrounds, background))} /> : null}
    </>
  );
}

/** A download's own subtitle tracks: files on this device, chosen with no server. */
function OfflineSubtitleChoices({engine, onClose, closeRow}: {engine: PlayerEngine; onClose: () => void; closeRow: React.ReactNode}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const offline = engine.subtitles.offline;
  if (!offline) return null;
  const off = offline.selectedId === null;
  return (
    <>
      <ListRow title={i18n.t('player.opt.off')} selected={off} hasTVPreferredFocus={off} onPress={() => { offline.choose(null); onClose(); }} />
      {offline.tracks.map(track => {
        const selected = track.id === offline.selectedId;
        return <ListRow key={track.id} title={trackName({language: track.language, title: track.title}, i18n.locale) || track.title || track.language} subtitle={track.forced ? i18n.t('player.opt.forced') : undefined} selected={selected} hasTVPreferredFocus={selected} onPress={() => { offline.choose(track.id); onClose(); }} />;
      })}
      {!offline.tracks.length ? <><Text variant="caption" tone="tertiary" style={{padding: space.md}}>{i18n.t('player.opt.noSubtitles')}</Text>{closeRow}</> : null}
      {offline.selectedId !== null ? <CaptionStyleRows run={engine.state.playbackRun} /> : null}
    </>
  );
}

/** Subtitles: every track labelled by language and kind, an honest empty state, and provider search when the server has one. */
function SubtitleChoices({engine, onClose, closeRow}: {engine: PlayerEngine; onClose: () => void; closeRow: React.ReactNode}) {
  const {service, snapshot} = engine.subtitles;
  const i18n = useI18n();
  const {space} = useTheme();
  const plan = snapshot.plan;
  const [searching, setSearching] = useState(false);
  if (engine.subtitles.offline) return <OfflineSubtitleChoices engine={engine} onClose={onClose} closeRow={closeRow} />;
  if (!service || !plan) {
    return (
      <>
        <StateView icon="subtitles" title={snapshot.loading ? i18n.t('player.opt.loadingSubtitles') : i18n.t('player.opt.subtitles')} loading={snapshot.loading} message={snapshot.loading ? undefined : snapshot.error ? say(snapshot.error, 'playback') : i18n.t('player.opt.subtitlesLater')} />
        {closeRow}
      </>
    );
  }
  // The track on screen is the selection's, or one the engine reads from the file it is playing.
  const shownId = engine.subtitles.shownId;
  const off = shownId === null;
  const choose = (resource: (typeof plan.resources)[number] | null) => { engine.subtitles.choose(resource).catch(() => showToast({message: i18n.t('player.subtitles.changeFailed'), icon: 'warning'})); };
  const addable = plan.discovered.filter(d => !plan.resources.some(r => r.discoveryId === d.id && r.enabled));
  const provider = snapshot.catalog?.provider;
  const language = i18n.locale.split('-')[0] ?? 'en';
  const origin = (o: string, provider?: string) => (o === 'provider' && provider ? provider : i18n.t('player.opt.origin', {origin: o}));
  /* MU4 COMPAT-01: 4K/HDR facts from the pre-play read, falling back to the offers' height
   * already on the session (never a new request). */
  const cachedFacts = engine.sourceFacts(engine.identity.itemId);
  const offersHeight = Math.max(0, ...(engine.quality.offers?.sources.map(s => s.height ?? 0) ?? []), ...engine.versions.list.flatMap(v => v.video.map(x => x.height ?? 0)));
  const sourceFacts = {is4k: !!cachedFacts?.is4k || offersHeight >= 2100, isHdr: !!cachedFacts?.isHdr};
  const bitmapNote = i18n.t('player.subtitles.bitmapNote');
  const drawnNote = i18n.t('player.subtitles.drawnHere');
  // ARCH-API-08: a burned-in (bitmap) track converts the video, so the owner's transcoding switch turns it off too.
  const owner = ownerPlaybackSwitches(engine.quality.offers);
  // A track the player in use draws itself (mpv: styled and image subtitles) is not burned in, so
  // neither the owner's switch nor the conversion warning applies to it.
  const drawn = (r: (typeof plan.resources)[number]) => engine.subtitleRendering(r);
  const ownerBlocks = (r: (typeof plan.resources)[number]) => !owner.subtitleBurnIn && isBitmapResource(r) && !drawn(r);
  const chooseResource = (r: (typeof plan.resources)[number]) => {
    if (!r.enabled || snapshot.busy || ownerBlocks(r)) return;
    // A track an engine of this device draws itself is chosen as it is: the server hands over
    // the original and, on Automatic, plays the title in the engine that draws it.
    if (drawn(r)) {
      choose(r);
      onClose();
      return;
    }
    // A language with both a text and a bitmap track plays the text track.
    if (isBitmapResource(r)) {
      const text = textTrackForLanguage(plan.resources, r.language);
      if (text && text.id !== r.id) {
        choose(text);
        showToast({message: i18n.t('player.subtitles.preferredText'), icon: 'subtitles'});
        onClose();
        return;
      }
      if (bitmapWarningNeeded(r, sourceFacts, engine.isBitmapAcked(r.id))) {
        engine.requestBitmapConfirm({id: r.id, language: r.language, format: r.format, renderer: r.renderer}, () => { choose(r); onClose(); });
        return;
      }
    }
    choose(r);
    onClose();
  };
  return (
    <>
      <ListRow title={i18n.t('player.opt.off')} selected={off} hasTVPreferredFocus={off} onPress={() => { choose(null); onClose(); }} />
      {plan.resources.map(r => {
        const selected = shownId === r.id;
        return (
          <ListRow key={r.id} title={trackName(r, i18n.locale) || r.title || r.language} subtitle={[r.forced ? i18n.t('player.opt.forced') : '', origin(r.origin, r.provider), r.enabled && isBitmapResource(r) && !ownerBlocks(r) ? (drawn(r) ? drawnNote : bitmapNote) : ''].filter(Boolean).join(' · ')}
            selected={selected} hasTVPreferredFocus={selected} disabled={!r.enabled || ownerBlocks(r)} meta={!r.enabled ? i18n.t('player.opt.unavailable') : ownerBlocks(r) ? i18n.t('player.ownerOff') : undefined} onPress={() => chooseResource(r)} />
        );
      })}
      {addable.map(d => (
        <ListRow key={d.id} title={d.title || d.language} subtitle={`${d.language.toUpperCase()} · ${origin(d.origin)}`} meta={d.enabled ? i18n.t('player.opt.add') : i18n.t('player.opt.unavailable')} disabled={!d.enabled || snapshot.busy} onPress={() => { const found = plan.resources.find(r => r.discoveryId === d.id && r.sourceId === d.sourceId); if (found) choose(found); else showToast({message: subtitleReason(d.reason, i18n.t), icon: 'warning'}); onClose(); }} />
      ))}
      {!plan.resources.length && !addable.length ? <Text variant="caption" tone="tertiary" style={{padding: space.md}}>{i18n.t('player.opt.noSubtitles')}</Text> : null}
      {provider?.enabled ? (
        searching ? (
          snapshot.busy && !snapshot.candidates.length ? <StateView loading title={i18n.t('player.opt.lookingForSubtitles')} /> : snapshot.candidates.length ? snapshot.candidates.map(c => (
            <ListRow key={c.id} icon="download" title={c.title} subtitle={`${c.language.toUpperCase()} · ${c.attribution}`} disabled={snapshot.busy} onPress={() => void service.apply(c, 'personal', 'Downloaded by the viewer for personal viewing').then(() => setSearching(false), () => {})} />
          )) : <Text variant="caption" tone="tertiary" style={{padding: space.md}}>{i18n.t('player.opt.noSubtitlesFound')}</Text>
        ) :  <ListRow icon="search" title={i18n.t('player.opt.findSubtitles')} onPress={() => { setSearching(true); void service.search(language).catch(() => {}); }} />
      ) : null}
      {plan.selected ? (
        <ListRow title={i18n.t('player.opt.timing')} subtitle={i18n.t('player.opt.timingHelp')} meta={i18n.t('player.opt.offsetSeconds', {seconds: (Number(plan.offsetUs) / 1e6).toFixed(1)})} trailing={<View style={{flexDirection: 'row', gap: space.sm}}><Button size="sm" variant="outline" label="−0.5" onPress={() => void engine.subtitles.choose(plan.selected!, String(Number(plan.offsetUs) - 500000)).catch(() => {})} /><Button size="sm" variant="outline" label="+0.5" onPress={() => void engine.subtitles.choose(plan.selected!, String(Number(plan.offsetUs) + 500000)).catch(() => {})} /></View>} />
      ) : null}
      {/* The look of the line this device draws (a burned-in track is part of the picture). */}
      {/* Image subtitles mixing forced and ordinary lines: only the forced ones (foreign dialogue, signs), as on the web. */}
      {!off && engine.subtitles.forcedOnly ? <ToggleRow title={i18n.t('player.subtitles.forcedOnly')} subtitle={i18n.t('player.subtitles.forcedOnlyHelp')} value={engine.subtitles.forcedOnly.on} onChange={on => engine.subtitles.forcedOnly?.set(on)} /> : null}
      {!off && plan.renderer !== 'burn_in' ? <CaptionStyleRows run={engine.state.playbackRun} /> : null}
      {snapshot.error ? <Notice tone="warning" message={say(snapshot.error, 'playback')} /> : null}
    </>
  );
}

/** APL-PLAYER-03: how this title is reaching the screen. */
/**
 * Playback info: how the stream is delivered and why, its codecs and size, and its bitrate, by
 * client-core's one model. The session's own account is read when the panel opens. (The native
 * player does not report dropped frames or its buffer to the app, so those two rows are absent.)
 */
function PlaybackInfo({engine}: {engine: PlayerEngine}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const sessionId = engine.state.session?.id;
  // The server's own account of this presentation, as the session path holds it: it follows
  // every re-plan, so the panel is right after a change of quality, track or engine.
  const presentation = engine.presentation;
  const offers = engine.quality.offers;
  const source = offers?.sources.find(x => x.id === offers.current?.sourceId) ?? offers?.sources[0];
  const inForce = engine.quality.inForce;
  const rows = playbackInfoRows({
    ...(presentation ? {decision: presentation.decision, bitrateKbps: presentation.bitrateKbps, hdr: presentation.hdr} : {}),
    delivery: presentation ? (presentation.mode === 'stream' ? 'converted' : 'direct') : offers?.current ? (offers.current.delivery === 'hls' ? 'converted' : 'direct') : undefined,
    chosenQuality: inForce && inForce.mode !== 'original' ? qualityInForceLabel(inForce, i18n.t) : undefined,
    source: source ? {container: source.container, videoCodec: source.videoCodec, audioCodec: source.audioCodec, width: source.width, height: source.height} : undefined,
    shown: engine.engineMedia?.video ? {width: engine.engineMedia.video.width, height: engine.engineMedia.video.height} : undefined,
    audioOnly: engine.isAudio,
  }, i18n.t);
  if (!sessionId) return <Text variant="caption" tone="tertiary" style={{padding: space.md}}>{i18n.t('player.opt.detailsLater')}</Text>;
  return (
    <>
      {rows.map(row => <ListRow key={row.id} title={row.label} subtitle={row.value} subtitleLines={3} />)}
      {/* Which player is playing, where this device has more than one. */}
      {engine.engineSelectable ? <ListRow title={i18n.t('settings.row.player')} subtitle={i18n.t(engine.engineKind === 'mpv' ? 'settings.player.mpv' : 'settings.player.native')} /> : null}
      {engine.state.audioEffects.rendering && engine.state.session?.audio?.downmixed ? <Text variant="caption" tone="secondary" style={{padding: space.md}}>{i18n.t('player.opt.downmixed')}</Text> : null}
    </>
  );
}

/** The queue controller's view, or null when this playback has no queue. */
export function useQueueView(engine: PlayerEngine) {
  const queue = engine.service.getQueueController();
  const subscribe = useMemo(() => queue?.subscribe ?? (() => () => {}), [queue]);
  const snapshot = useSyncExternalStore(subscribe, () => queue?.getSnapshot() ?? null);
  return {queue, view: snapshot?.view ?? null};
}

/** Entries after the current one, in order (bounded: at most `limit`). */
export function upcomingEntries(view: ReturnType<typeof useQueueView>['view'], limit = 50) {
  const entries = view?.queue.entries ?? [];
  const at = entries.findIndex(e => e.id === view?.queue.currentEntryId);
  const out: {id: string; itemId: string; pending?: true}[] = [];
  for (let i = at + 1; i < entries.length && out.length < limit; i++) {
    const e = entries[i];
    if (e.removed) continue;
    if (!e.hidden) out.push({id: e.id, itemId: e.itemId});
    // A v1 placeholder still being snapshotted (a large queue building): a quiet row, not an error.
    else if (e.pending) out.push({id: e.id, itemId: '', pending: true});
  }
  return out;
}

/** APL-PLAYER-03 (PC-MEDIA §15.1.10): Up next, with Play now, Move earlier/later and Remove. */
function UpNext({engine, onClose, closeRow}: {engine: PlayerEngine; onClose: () => void; closeRow: React.ReactNode}) {
  const i18n = useI18n();
  const {queue, view} = useQueueView(engine);
  const {api} = useSession();
  const {space} = useTheme();
  const upcoming = upcomingEntries(view);
  const [items, setItems] = useState<Record<string, MediaItem | null>>({});
  const [chosen, setChosen] = useState<string>();
  const [error, setError] = useState('');
  const key = upcoming.filter(u => !u.pending).map(u => u.itemId).join(',');
  useEffect(() => {
    let live = true;
    for (const id of new Set(key ? key.split(',') : [])) {
      if (id in items) continue;
      api.item(id).then(item => live && setItems(prev => ({...prev, [id]: item})), () => live && setItems(prev => ({...prev, [id]: null})));
    }
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key]);
  if (!queue || !view) return <><Text variant="caption" tone="tertiary" style={{padding: space.md}}>{i18n.t('player.opt.nothingQueued')}</Text>{closeRow}</>;
  if (!upcoming.length) return <><Text variant="caption" tone="tertiary" style={{padding: space.md}}>{i18n.t('player.queueEmpty')}</Text>{closeRow}</>;
  const workspace = queue.workspace.service;
  const run = (work: Promise<unknown>) => { setError(''); work.catch(e => setError(say(e, 'playlist', 'action'))); };
  const order = view.queue.entries.filter(e => !e.removed).map(e => e.id);
  const move = (entryId: string, delta: number) => {
    const i = order.indexOf(entryId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    run(workspace.mutate({action: 'reorder', entryIds: next}));
  };
  return (
    <>
      {error ? <Notice tone="warning" message={error} style={{marginBottom: space.sm}} /> : null}
      {upcoming.map((u, index) => {
        if (u.pending) return <ListRow key={u.id} ordinal={index + 1} title={i18n.t("web.queue.pendingEntry")} disabled focusable={false} />;
        const item = items[u.itemId];
        return (
          <View key={u.id}>
            <ListRow ordinal={index + 1} title={item?.title ?? (item === null ? i18n.t('player.queueUnavailable') : '…')} subtitle={item?.year ? String(item.year) : undefined} trailingIcon={chosen === u.id ? 'chevronUp' : 'moreVertical'} hasTVPreferredFocus={index === 0} onPress={() => setChosen(chosen === u.id ? undefined : u.id)} />
            {chosen === u.id ? (
              <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingHorizontal: space.sm, paddingBottom: space.sm}}>
                <Button size="sm" variant="secondary" icon="play" label={i18n.t('player.opt.playNow')} onPress={() => { queue.playEntry(view.queue.id, u.id, view.queue.revision).catch(e => showToast({message: say(e, 'playlist', 'action'), icon: 'warning'})); onClose(); }} />
                <Button size="sm" variant="secondary" icon="chevronUp" label={i18n.t('player.opt.earlier')} disabled={index === 0} onPress={() => move(u.id, -1)} />
                <Button size="sm" variant="secondary" icon="chevronDown" label={i18n.t('player.opt.later')} disabled={index === upcoming.length - 1} onPress={() => move(u.id, 1)} />
                <Button size="sm" variant="secondary" icon="trash" label={i18n.t('player.opt.remove')} onPress={() => { setChosen(undefined); run(workspace.mutate({action: 'remove', entryId: u.id})); }} />
              </View>
            ) : null}
          </View>
        );
      })}
      {queue.saveAsPlaylist ? <SaveQueueRow engine={engine} queueId={view.queue.id} /> : null}
    </>
  );
}

/** NEW-37: Save as playlist, under the default name (rename it from the playlist). A long queue is
 * copied in the background; progress shows until it's done. */
function SaveQueueRow({engine, queueId}: {engine: PlayerEngine; queueId: string}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const [save, setSave] = useState<QueuePlaylistSave | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const queue = engine.service.getQueueController();
  const start = () => {
    if (!queue?.saveAsPlaylist || busy) return;
    setBusy(true); setFailed(false); setSave(null);
    queue.saveAsPlaylist(queueId, i18n.t('player.queueSaveDefaultName'), setSave).catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  const m = save ? queueSaveMessage(save) : null;
  const message = failed ? i18n.t('player.queueSaveFailed') : m ? (m.values ? i18n.t(m.id, {done: m.values.done.toLocaleString(), total: m.values.total.toLocaleString()}) : i18n.t(m.id)) : busy ? i18n.t('player.queueSaving') : '';
  return (
    <>
      <ListRow icon="plus" title={i18n.t('player.queueSave')} disabled={busy} onPress={start} />
      {message ? <Text variant="caption" tone={failed || save?.state === 'failed' ? 'danger' : 'tertiary'} style={{paddingHorizontal: space.md, paddingBottom: space.sm}}>{message}</Text> : null}
    </>
  );
}

/** APL-PLAYER-03: Shuffle and Repeat are durable queue settings the queue workspace owns. */
export function QueueToggle({engine, kind, size}: {engine: PlayerEngine; kind: 'shuffle' | 'repeat'; size: 'md' | 'lg'}) {
  const queue = engine.service.getQueueController();
  const workspace = queue?.workspace.service;
  const subscribe = useMemo(() => workspace?.subscribe ?? (() => () => {}), [workspace]);
  const state = useSyncExternalStore(subscribe, () => workspace?.getSnapshot() ?? null);
  const q = state?.queue;
  if (!workspace || !q) return null;
  const repeat = q.repeat;
  const active = kind === 'shuffle' ? q.shuffled : repeat !== 'off';
  const next = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off';
  const label = defaultI18n.t(kind === 'shuffle' ? (q.shuffled ? 'player.opt.shuffleOn' : 'player.opt.shuffleOff') : repeat === 'off' ? 'player.opt.repeatOff' : repeat === 'one' ? 'player.opt.repeatOne' : 'player.opt.repeatAll');
  return (
    // TV-PLAYER-02: the transport size, like the other controls in the row (`size` is kept for callers).
    <Button variant="ghost" transport="control" round icon={kind} iconNumber={kind === 'repeat' && repeat === 'one' ? 1 : undefined} size={size} selected={active} accessibilityLabel={label} disabled={state?.phase !== 'ready'}
      onPress={() => void workspace.mutate(kind === 'shuffle' ? {action: 'shuffle', shuffled: !q.shuffled} : {action: 'repeat', repeat: next}).catch(() => {})} />
  );
}
