import React from 'react';
import {endedCopy} from './ended-copy';
import {View} from 'react-native';
import {useArtwork} from '../app/content';
import {Artwork, Button, Focusable, ProgressLine, Text, alpha, useTheme} from '../ui';
import type {PlayerEngine} from './usePlayer';
import {upcomingEntries, useQueueView} from './PlayerOptions';
import {useI18n} from '../app/i18n';
import {activeI18n} from '../app/errors';

/**
 * Handheld audio mini bar: one compact row of smoked glass above the tab bar
 * with square art, bounded identity, play/pause, next and close. No timeline.
 */
export function MiniBar({engine}: {engine: PlayerEngine}) {
  const i18n = useI18n();
  const {colors, space, metrics} = useTheme();
  const artwork = useArtwork();
  const playing = engine.state.intent === 'playing' && engine.state.phase === 'ready';
  const {view} = useQueueView(engine);
  const canNext = upcomingEntries(view, 1).length > 0;
  const entries = view?.queue.entries ?? [];
  const canPrevious = entries.findIndex(e => e.id === view?.queue.currentEntryId) > 0;
  const played = engine.state.duration > 0 ? engine.state.positionSeconds / engine.state.duration : 0;
  return (
    <View style={{paddingHorizontal: space.sm, paddingBottom: space.xs}}>
      <Focusable accessibilityRole="button" accessibilityLabel={activeI18n().t('player.nowPlayingTitle', {title: engine.identity.title})} radius={metrics.radius.control} scale={1} onPress={engine.expand} style={{alignSelf: 'stretch'}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: metrics.radius.control, backgroundColor: alpha(colors.material, 0.96), borderWidth: 1, borderColor: alpha(colors.lineStrong, 0.5)}}>
          <Artwork source={artwork(engine.identity.posterUrl)} shape="square" width={44} radius={6} title={engine.identity.title} icon="music" priority />
          <View style={{flex: 1, minWidth: 0}}>
            <Text variant="captionStrong" lines={1}>{engine.identity.title}</Text>
            <Text variant="micro" tone="tertiary" lines={1}>{engine.state.ended ? endedCopy(engine.state.ended, i18n.t).short : [engine.identity.artist, engine.identity.album].filter(Boolean).join(' · ') || engine.identity.subtitle || (engine.state.phase === 'starting' ? i18n.t('player.miniStarting') : i18n.t('player.miniPlaying'))}</Text>
          </View>
          <Button variant="ghost" round icon="previous" accessibilityLabel={i18n.t('player.previous')} disabled={!canPrevious || !!engine.state.ended} onPress={() => void engine.service.systemListeningAction('previous').catch(() => {})} />
          <Button variant="ghost" round icon={playing ? 'pause' : 'play'} accessibilityLabel={playing ? i18n.t('action.pause') : i18n.t('action.play')} disabled={!!engine.state.ended} onPress={engine.toggle} />
          <Button variant="ghost" round icon="next" accessibilityLabel={i18n.t('player.next')} disabled={!canNext || !!engine.state.ended} onPress={() => void engine.service.systemListeningAction('next').catch(() => {})} />
          <Button variant="ghost" round icon="close" accessibilityLabel={i18n.t('action.stop')} onPress={engine.leave} />
          {/* How far in, along the bar's lower edge; the scrubber itself is one tap away in Now Playing. */}
          <ProgressLine value={played} style={{height: 2, left: space.sm, right: space.sm}} />
        </View>
      </Focusable>
    </View>
  );
}

/**
 * Television now-playing indicator: a compact focusable pill in the top-right
 * safe area while audio continues in the background.
 */
export function NowPlayingPill({engine}: {engine: PlayerEngine}) {
  const {colors, space, metrics} = useTheme();
  const artwork = useArtwork();
  const playing = engine.state.intent === 'playing' && engine.state.phase === 'ready';
  return (
    <View pointerEvents="box-none" style={{position: 'absolute', top: 60, right: 80, zIndex: 30}}>
      <Focusable accessibilityRole="button" accessibilityLabel={activeI18n().t('player.nowPlayingTitle', {title: engine.identity.title})} radius={metrics.radius.pill} onPress={engine.expand}>
        {({focused}) => (
          <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: space.xs, paddingRight: space.lg, paddingVertical: space.xs, borderRadius: metrics.radius.pill, backgroundColor: focused ? colors.raisedHigh : alpha(colors.material, 0.95), borderWidth: 1, borderColor: alpha(colors.lineStrong, 0.5), maxWidth: 520}}>
            <Artwork source={artwork(engine.identity.posterUrl)} shape="square" width={48} radius={24} title={engine.identity.title} icon="music" />
            <View style={{minWidth: 0, flexShrink: 1}}>
              <Text variant="captionStrong" lines={1}>{engine.identity.title}</Text>
              <Text variant="micro" tone="tertiary" lines={1}>{engine.state.ended ? endedCopy(engine.state.ended, activeI18n().t).short : [activeI18n().t(playing ? 'web.nowPlaying.state.playing' : 'web.nowPlaying.state.paused'), engine.identity.artist].filter(Boolean).join(' · ')}</Text>
            </View>
          </View>
        )}
      </Focusable>
    </View>
  );
}
