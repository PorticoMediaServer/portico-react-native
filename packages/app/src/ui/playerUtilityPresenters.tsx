import React, {useRef} from 'react';
import {FlatList, ScrollView, StyleSheet, Text, TVFocusGuideView, View} from 'react-native';
import {PorticoIcon, type PorticoIconId} from '@portico-react-native/icons';
import type {TVLogicalFocusContainer} from '@portico-react-native/tv-focus';
import type {PlaybackResponse, PortableSleepTimer} from '@porticomediaserver/client-core';
import {formatPlayerTime} from '@portico-react-native/player';
import type {PrototypePlatform} from '../ui-compat/contract';
import {Focusable, TVLogicalFocusContainerBoundary} from './primitives';
import {productText} from './productCopy';
import {queueOccurrenceKey} from './queueNavigation';
import {color, font} from './tokens';
import type {PlayerPanelId} from './uiState';
import {TV_PLAYER_FOCUS} from './playerFocusTopology';

export function PlayerUtilityDock({
  allowChapterSeeking,
  allowPlaybackRate,
  allowStreamSelection,
  hasLyrics,
  focusContainer,
  onPictureInPicture,
  onPanelToggle,
  onRepeat,
  onShuffle,
  panel,
  playback,
  queueCount,
  platform,
  repeatMode,
  showPictureInPicture,
  showMusicQueueControls,
  showSleepTimer,
}: {
  allowChapterSeeking: boolean;
  allowPlaybackRate: boolean;
  allowStreamSelection: boolean;
  hasLyrics: boolean;
  focusContainer?: TVLogicalFocusContainer;
  onPictureInPicture(): void;
  onPanelToggle(value: Exclude<PlayerPanelId, null>): void;
  onRepeat(): void;
  onShuffle(): void;
  panel: PlayerPanelId;
  playback: PlaybackResponse;
  queueCount: number;
  platform: PrototypePlatform;
  repeatMode: PlaybackResponse['repeatMode'];
  showPictureInPicture: boolean;
  showMusicQueueControls: boolean;
  showSleepTimer: boolean;
}) {
  const television = platform === 'tv';
  const qualities = playback.qualities.filter(
    quality => quality.available !== false && quality.id,
  );
  const actions: Array<{
    id: Exclude<PlayerPanelId, null>;
    icon: PorticoIconId;
    label: string;
  }> = [
    ...(television
      ? [{id: 'volume' as const, icon: 'playback.volume' as const, label: 'Volume'}]
      : []),
    ...(allowStreamSelection &&
    (playback.audioStreams.length > 1 || playback.subtitleStreams.length > 0)
      ? [
          {
            id: 'subtitles' as const,
            icon: 'playback.subtitles' as const,
            label: productText('playback.menu-subtitles'),
          },
        ]
      : []),
    ...(playback.streamFormat === 'hls' && qualities.length > 1
      ? [
          {
            id: 'quality' as const,
            icon: 'playback.quality' as const,
            label: productText('playback.setting-quality'),
          },
        ]
      : []),
    ...(!television && allowChapterSeeking && playback.chapters.length
      ? [
          {
            id: 'chapters' as const,
            icon: 'playback.chapters' as const,
            label: productText('playback.menu-chapters'),
          },
        ]
      : []),
    ...(allowPlaybackRate
      ? [
          {
            id: 'speed' as const,
            icon: 'playback.speed' as const,
            label: productText('playback.setting-speed'),
          },
        ]
      : []),
    ...(!television && hasLyrics
      ? [
          {
            id: 'lyrics' as const,
            icon: 'playback.lyrics' as const,
            label: productText('playback.menu-lyrics'),
          },
        ]
      : []),
    ...(showSleepTimer
      ? [
          {
            id: 'sleep' as const,
            icon: 'metadata.time' as const,
            label: productText('playback.setting-sleep-timer'),
          },
        ]
      : []),
    ...(queueCount
      ? [
          {
            id: 'queue' as const,
            icon: 'playback.queue' as const,
            label: productText('playback.menu-queue'),
          },
        ]
      : []),
  ];
  const dock = <ScrollView contentContainerStyle={styles.utilityDockContent} horizontal showsHorizontalScrollIndicator={false} style={[styles.utilityDock, television && styles.utilityDockTv]} testID={television ? TV_PLAYER_FOCUS.utilities : undefined}>
      {!television && showMusicQueueControls && queueCount > 1 ? (
        <PlayerDockButton
          icon="playback.shuffle"
          label={productText('action.shuffle')}
          onPress={onShuffle}
          platform={platform}
          selected={false}
        />
      ) : null}
      {!television && showMusicQueueControls ? (
        <PlayerDockButton
          icon={repeatMode === 'one' ? 'playback.repeat-one' : 'playback.repeat'}
          label={productText(
            repeatMode === 'off'
              ? 'action.repeat-off'
              : repeatMode === 'one'
                ? 'action.repeat-one'
                : 'action.repeat-all',
          )}
          onPress={onRepeat}
          platform={platform}
          selected={repeatMode !== 'off'}
        />
      ) : null}
      {actions.map((action, index) => (
        <PlayerDockButton
          icon={action.icon}
          key={action.id}
          label={action.label}
          onPress={() => onPanelToggle(action.id)}
          platform={platform}
          selected={panel === action.id}
          tvFocusId={`player:utility:${action.id}`}
          tvFocusOrder={index}
        />
      ))}
      {showPictureInPicture ? (
        <PlayerDockButton
          icon="playback.picture-in-picture"
          label={productText('action.picture-in-picture')}
          onPress={onPictureInPicture}
          platform={platform}
          selected={false}
        />
      ) : null}
    </ScrollView>;
  return television && focusContainer
    ? <TVLogicalFocusContainerBoundary container={focusContainer}>{dock}</TVLogicalFocusContainerBoundary>
    : dock;
}

function PlayerDockButton({
  icon,
  label,
  onPress,
  platform,
  selected,
  tvFocusId,
  tvFocusOrder,
}: {
  icon: PorticoIconId;
  label: string;
  onPress(): void;
  platform: PrototypePlatform;
  selected: boolean;
  tvFocusId?: string;
  tvFocusOrder?: number;
}) {
  const television = platform === 'tv';
  return (
    <Focusable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      platform={platform}
      style={[
        styles.dockButton,
        television && styles.dockButtonTv,
        selected && styles.dockButtonSelected,
      ]}
      focusedStyle={styles.dockButtonFocused}
      pressedStyle={styles.dockButtonPressed}
      tvFocusId={tvFocusId}
      tvFocusOrder={tvFocusOrder}
      tvFocusBoundaryDirections={television ? ['down', 'up'] : undefined}
    >
      <PorticoIcon
        color={selected ? color.screenBlueStrong : color.silver}
        id={icon}
        size={television ? 25 : 20}
        strokeWidth={2}
      />
    </Focusable>
  );
}

export function PlayerUtilityPanel({
  allowChapterSeeking,
  allowPlaybackRate,
  allowStreamSelection,
  busy,
  focusContainer,
  lyrics,
  onChapter,
  onQueueItem,
  onQuality,
  onPlaybackRate,
  onSelectAudio,
  onSelectSubtitle,
  onSleepTimer,
  onVolume,
  panel,
  playback,
  queueItems,
  queueSelectionAllowed,
  playbackRate,
  platform,
  sleepTimer,
  volume,
}: {
  allowChapterSeeking: boolean;
  allowPlaybackRate: boolean;
  allowStreamSelection: boolean;
  busy: boolean;
  focusContainer?: TVLogicalFocusContainer;
  lyrics?: ReadonlyArray<{active: boolean; text: string}>;
  onChapter(seconds: number): void;
  onQueueItem(index: number): void;
  onQuality(id: string): void;
  onPlaybackRate(rate: number): void;
  onSelectAudio(id: string): void;
  onSelectSubtitle(id: string): void;
  onSleepTimer(mode: 'off' | 'end-of-item' | 15 | 30 | 45 | 60): void;
  onVolume(volume: number): void;
  panel: Exclude<PlayerPanelId, null>;
  playback: PlaybackResponse;
  queueItems: ReadonlyArray<{id: string; title: string}>;
  queueSelectionAllowed(index: number): boolean;
  playbackRate: number;
  platform: PrototypePlatform;
  sleepTimer: PortableSleepTimer;
  volume: number;
}) {
  const television = platform === 'tv';
  const panelListRef = useRef<FlatList<{active?: boolean; id: string; label: string; onPress?: () => void}>>(null);
  const rows: Array<{active?: boolean; id: string; label: string; onPress?: () => void}> =
    panel === 'volume'
      ? [0, 0.25, 0.5, 0.75, 1].map(level => ({
          id: `volume-${Math.round(level * 100)}`,
          label: level === volume ? `Volume ${Math.round(level * 100)} percent · Selected` : `Volume ${Math.round(level * 100)} percent`,
          onPress: () => onVolume(level),
        }))
      : panel === 'quality'
      ? playback.qualities
          .filter(quality => quality.available !== false && quality.id)
          .map(quality => ({
            id: quality.id!,
            label: productText('playback.quality-option', {
              option: quality.label ?? quality.id,
            }),
            onPress: () => onQuality(quality.id!),
          }))
      : panel === 'subtitles' && allowStreamSelection
        ? [
            ...playback.audioStreams.map(stream => ({
              id: `audio-${stream.id}`,
              label: productText('playback.audio-option', {
                option: stream.displayTitle ?? stream.language ?? stream.codec,
              }),
              onPress: () => onSelectAudio(stream.id),
            })),
            ...(playback.subtitleStreams.length
              ? [
                  {
                    id: 'subtitle-off',
                    label: productText('playback.subtitle-option', {
                      option: productText('playback.subtitles-off'),
                    }),
                    onPress: () => onSelectSubtitle('sub_none'),
                  },
                ]
              : []),
            ...playback.subtitleStreams.map(stream => ({
              id: `subtitle-${stream.id}`,
              label: productText('playback.subtitle-option', {
                option: stream.displayTitle ?? stream.language ?? stream.codec,
              }),
              onPress: () => onSelectSubtitle(stream.id),
            })),
          ]
        : panel === 'chapters' && allowChapterSeeking
          ? playback.chapters.map((chapter, index) => ({
              id: chapter.id ?? `chapter-${index}`,
              label: productText('playback.chapter-option', {
                chapter:
                  chapter.title ??
                  formatPlayerTime(chapter.startSeconds ?? 0),
                number: index + 1,
              }),
              onPress: () => onChapter(chapter.startSeconds ?? 0),
            }))
          : panel === 'queue'
            ? queueItems.map((entry, index) => ({
                id: entry.id,
                label: `${productText(
                  index === 0
                    ? 'playback.queue-up-next'
                    : 'playback.queue-then',
                )} · ${entry.title}`,
                onPress:
                  queueSelectionAllowed(index)
                    ? () => onQueueItem(index)
                    : undefined,
              }))
            : panel === 'speed' && allowPlaybackRate
              ? [0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => ({
                  id: `speed-${rate}`,
                  label: productText(
                    rate === playbackRate
                      ? 'playback.selected-option'
                      : 'playback.speed-option',
                    {
                      option: productText('playback.speed-option', {rate}),
                      rate,
                    },
                  ),
                  onPress: () => onPlaybackRate(rate),
                }))
              : panel === 'lyrics' && lyrics
                ? lyrics.map((line, index) => ({active: line.active, id: `lyrics-${index}`, label: line.text}))
                : panel === 'sleep'
                  ? ([
                      ['off', productText('playback.sleep-off')],
                      ['end-of-item', productText('playback.sleep-end')],
                      [15, productText('playback.sleep-15-minutes')],
                      [30, productText('playback.sleep-30-minutes')],
                      [45, productText('playback.sleep-45-minutes')],
                      [60, productText('playback.sleep-60-minutes')],
                    ] as const).map(([mode, label]) => ({
                      id: `sleep-${mode}`,
                      label: sleepTimerModeSelected(sleepTimer, mode)
                        ? productText('playback.selected-option', {
                            option: label,
                          })
                        : label,
                      onPress: () => onSleepTimer(mode),
                    }))
            : [];
  const renderPanelRow = ({item: row, index}: {item: {active?: boolean; id: string; label: string; onPress?: () => void}; index: number}) =>
    row.onPress ? (
      <Focusable
        accessibilityLabel={row.label}
        accessibilityRole="button"
        disabled={busy}
        onFocus={() => panelListRef.current?.scrollToIndex({animated: true, index, viewPosition: 0.5})}
        onPress={row.onPress}
        platform={platform}
        style={styles.utilityPanelRow}
        focusedStyle={styles.utilityPanelRowFocused}
        pressedStyle={styles.utilityPanelRowPressed}
        tvFocusBoundaryDirections={television && index === 0 ? ['up'] : undefined}
        tvFocusId={`player-panel:${panel}:occurrence:${index}:${row.id}`}
        tvFocusOrder={index}>
        <Text style={television ? styles.utilityPanelRowTv : styles.utilityPanelRowMobile}>{row.label}</Text>
      </Focusable>
    ) : (
      <View accessibilityLabel={row.label} accessibilityRole="text" style={[styles.utilityPanelRow, styles.lyricRow]}>
        {row.active ? <PorticoIcon color={color.screenBlueStrong} id="playback.play" size={16} /> : <View style={styles.lyricIconSpacer} />}
        <Text style={[television ? styles.utilityPanelRowTv : styles.utilityPanelRowMobile, styles.lyricText]}>{row.label}</Text>
      </View>
    );
  const panelView = <TVFocusGuideView autoFocus testID={TV_PLAYER_FOCUS.panel} trapFocusDown trapFocusLeft trapFocusRight trapFocusUp style={[styles.utilityPanel, television && styles.utilityPanelTv]}>
      <Text
        style={
          television
            ? styles.utilityPanelTitleTv
            : styles.utilityPanelTitleMobile
        }
      >
        {panel === 'volume' ? 'Volume' : productText(
          panel === 'sleep'
            ? 'playback.setting-sleep-timer'
            : panel === 'speed'
              ? 'playback.setting-speed'
              : panel === 'quality'
                ? 'playback.setting-quality'
                : panel === 'subtitles'
                  ? 'playback.menu-subtitles'
                  : panel === 'chapters'
                    ? 'playback.menu-chapters'
                    : panel === 'queue'
                      ? 'playback.menu-queue'
                      : 'playback.menu-lyrics',
        )}
      </Text>
      <FlatList
        data={rows}
        initialNumToRender={8}
        keyExtractor={(row, index) => queueOccurrenceKey(panel, index, row.id)}
        maxToRenderPerBatch={8}
        onScrollToIndexFailed={({index}) => panelListRef.current?.scrollToOffset({animated: false, offset: index * (television ? 66 : 52)})}
        ref={panelListRef}
        renderItem={renderPanelRow}
        showsVerticalScrollIndicator={false}
        windowSize={5}
      />
    </TVFocusGuideView>;
  return television && focusContainer
    ? <TVLogicalFocusContainerBoundary container={focusContainer}>{panelView}</TVLogicalFocusContainerBoundary>
    : panelView;
}

function sleepTimerModeSelected(
  timer: PortableSleepTimer,
  mode: 'off' | 'end-of-item' | 15 | 30 | 45 | 60,
): boolean {
  if (mode === 'off' || mode === 'end-of-item') return timer.mode === mode;
  if (timer.mode !== 'deadline') return false;
  return Math.ceil((timer.deadlineAt - Date.now()) / 60_000) === mode;
}

const styles = StyleSheet.create({
  utilityDock: {alignItems: 'center', backgroundColor: 'rgba(7,11,16,0.78)', borderColor: color.line, borderRadius: 32, borderWidth: 1, flexDirection: 'row', gap: 2, maxWidth: '88%', padding: 4, position: 'absolute', right: 16, top: 58, zIndex: 5},
  utilityDockContent: {alignItems: 'center', flexDirection: 'row', gap: 2},
  utilityDockTv: {bottom: 42, right: 72, top: undefined},
  dockButton: {alignItems: 'center', borderColor: color.transparent, borderRadius: 999, borderWidth: 2, height: 40, justifyContent: 'center', width: 40},
  dockButtonTv: {height: 52, width: 52},
  dockButtonSelected: {backgroundColor: color.raisedSlate},
  dockButtonFocused: {backgroundColor: color.brightSlate, borderColor: color.focus},
  dockButtonPressed: {backgroundColor: color.recess},
  utilityPanel: {backgroundColor: 'rgba(10,16,23,0.96)', borderColor: color.line, borderRadius: 10, borderWidth: 1, maxHeight: 420, padding: 14, position: 'absolute', right: 16, top: 108, width: 270, zIndex: 5},
  utilityPanelTv: {bottom: 106, maxHeight: 620, right: 72, top: undefined, width: 420},
  utilityPanelTitleMobile: {color: color.silver, fontFamily: font.demi, fontSize: 16, marginBottom: 8},
  utilityPanelTitleTv: {color: color.silver, fontFamily: font.demi, fontSize: 23, marginBottom: 12},
  utilityPanelRow: {borderColor: color.transparent, borderRadius: 6, borderWidth: 2, paddingHorizontal: 8},
  utilityPanelRowFocused: {backgroundColor: color.raisedSlate, borderColor: color.focus},
  utilityPanelRowPressed: {backgroundColor: color.brightSlate},
  lyricIconSpacer: {width: 16},
  lyricRow: {alignItems: 'center', flexDirection: 'row', gap: 8},
  lyricText: {flex: 1},
  utilityPanelRowMobile: {borderTopColor: color.lineSoft, borderTopWidth: 1, color: color.softSilver, fontFamily: font.regular, fontSize: 13, lineHeight: 18, paddingVertical: 8},
  utilityPanelRowTv: {borderTopColor: color.lineSoft, borderTopWidth: 1, color: color.softSilver, fontFamily: font.regular, fontSize: 18, lineHeight: 25, paddingVertical: 11},
});
