import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {View, TVFocusGuideView} from 'react-native';
import {useI18n} from '../app/i18n';
import {useOffline} from '../app/downloads';
import {nextDownloadedEpisode} from '../app/offline-next';
import {usePlayerActions} from '../app/player-actions';
import {useServerPreferences} from '../app/server-preferences';
import type {OfflineEntry} from '../bridge/offline-downloads';
import {Button, Text, alpha, showToast, useTheme} from '../ui';
import type {PlayerEngine} from './usePlayer';


const noSubscribe = () => () => {};
const noSnapshot = () => null;

/**
 * End-of-item card for video. The queue player holds a finished item until
 * the viewer or the countdown decides; the server's post-play policy provides
 * the countdown, autoplay and passout check. Three states: Up Next, Still
 * watching?, and Finished (replay or leave).
 *
 * A download plays with no server queue: when a downloaded episode ends, Up Next is the next
 * downloaded episode of the same show (`nextDownloadedEpisode`), counted down under the viewer's
 * own Autoplay and countdown settings (as last read from the server), so a series watched offline
 * carries on.
 */
export function PostPlay({engine}: {engine: PlayerEngine}) {
  const {colors, space, metrics, isTV} = useTheme();
  const i18n = useI18n();
  const queue = engine.service.getQueueController();
  const queueState = useSyncExternalStore(queue?.subscribe ?? noSubscribe, queue?.getSnapshot ?? noSnapshot);
  const held = queueState?.completion ?? null;
  const next = held?.nextEntryId ? queueState?.view?.items.find(i => i.entryId === held.nextEntryId) : undefined;
  const countdownSeconds = held?.postPlay.countdownSeconds ?? 10;
  const autoplay = held?.postPlay.autoplay ?? true;
  const passoutDue = held?.postPlay.passoutCheckDue ?? false;
  const [remaining, setRemaining] = useState<number>(countdownSeconds);
  const counting = !!held?.nextAvailable && autoplay && !passoutDue;
  const advance = useRef(engine.advance);
  advance.current = engine.advance;
  // Offline: the download playing now (held while it plays, so a download removed once watched
  // still names its place in the show), and the next downloaded episode after it.
  const offline = useOffline();
  const {playLocal} = usePlayerActions();
  const serverPreferences = useServerPreferences();
  const offlineAutoplay = serverPreferences.value<boolean>('playback.autoplayNext', true);
  const offlineCountdown = Math.max(0, serverPreferences.value<number>('playback.upNextCountdownSeconds', 10));
  const offlineItem = engine.identity.offline ? engine.identity.itemId ?? engine.state.itemId : undefined;
  const playingDownload = useRef<OfflineEntry | undefined>(undefined);
  const found = offlineItem ? offline.entries.find(e => e.itemId === offlineItem && e.state === 'ready') : undefined;
  if (!offlineItem) playingDownload.current = undefined;
  else if (found) playingDownload.current = found;
  const ended = engine.state.phase === 'ended';
  const offlineNext = ended && offlineItem && playingDownload.current?.itemId === offlineItem ? nextDownloadedEpisode(offline.entries, playingDownload.current) : undefined;
  const [offlineCancelled, setOfflineCancelled] = useState<string>();
  const offlineCounting = !!offlineNext && offlineAutoplay && offlineCancelled !== offlineItem;
  const playDownload = useRef<(entry: OfflineEntry) => void>(() => {});
  playDownload.current = entry => { if (playLocal) void playLocal(entry).catch(() => showToast({message: i18n.t('player.post.advanceFailed'), icon: 'warning'})); };
  useEffect(() => {
    if (!offlineCounting || !offlineNext) return;
    setRemaining(offlineCountdown);
    const started = Date.now();
    const id = setInterval(() => {
      const left = offlineCountdown - Math.floor((Date.now() - started) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        playDownload.current(offlineNext);
      }
    }, 250);
    return () => clearInterval(id);
  }, [offlineCounting, offlineNext, offlineCountdown]);
  useEffect(() => {
    setRemaining(countdownSeconds);
    if (!counting) return;
    const started = Date.now();
    const id = setInterval(() => {
      const left = countdownSeconds - Math.floor((Date.now() - started) / 1000);
      setRemaining(Math.max(0, left));
      if (left <= 0) {
        clearInterval(id);
        void advance.current('automatic').catch(() => {});
      }
    }, 250);
    return () => clearInterval(id);
  }, [counting, countdownSeconds, held?.sessionId]);
  if (engine.state.phase !== 'ended') return null;
  // TV-PLAYER-01: seeking a finished item back to 0 left the native item at its end, so the
  // Finished card came straight back. Replay starts the same item again from the beginning.
  const replay = () => {
    // A download plays again from its own file.
    if (engine.identity.offline && playingDownload.current) { playDownload.current(playingDownload.current); return; }
    queue?.releaseCompletion();
    const {itemId, title, posterUrl, backdropUrl, kind, libraryId} = engine.identity;
    const id = itemId ?? engine.state.itemId;
    if (!id) { engine.seekTo(0); engine.service.resume(); return; }
    engine.play(id, 0, {id, title, posterUrl, backdropUrl, libraryId, kind: (kind ?? 'movie') as never});
  };
  const card = (title: string, body: React.ReactNode, buttons: React.ReactNode) => (
    <View pointerEvents="box-none" style={{position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: space.xl}}>
      <TVFocusGuideView autoFocus trapFocusUp trapFocusDown trapFocusLeft trapFocusRight style={{width: '100%', alignItems: 'center'}}>
      <View style={{width: '100%', maxWidth: isTV ? 640 : 480, padding: isTV ? space.xl : space.lg, gap: space.md, borderRadius: metrics.radius.panel, backgroundColor: alpha(colors.ink, 0.86), borderWidth: 1, borderColor: alpha(colors.white, 0.12)}}>
        <Text variant="label" tone="tertiary">{title}</Text>
        {body}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>{buttons}</View>
      </View>
      </TVFocusGuideView>
    </View>
  );
  if (offlineNext) {
    return card(
      i18n.t('player.post.upNext'),
      <View style={{gap: 4}}>
        <Text variant={isTV ? 'heading' : 'subheading'} lines={2}>{offlineNext.title}</Text>
        {offlineNext.subtitle ? <Text variant="caption" tone="secondary" lines={1}>{offlineNext.subtitle}</Text> : null}
        <Text variant="caption" tone="secondary">{offlineCounting ? i18n.t('player.post.playingIn', {seconds: remaining}) : i18n.t('player.post.ready')}</Text>
      </View>,
      <>
        <Button variant="primary" icon="play" label={i18n.t('player.post.playNow')} hasTVPreferredFocus onPress={() => playDownload.current(offlineNext)} />
        {offlineCounting ? <Button variant="outline" label={i18n.t('player.post.cancel')} onPress={() => setOfflineCancelled(offlineItem)} /> : null}
        <Button variant="ghost" icon="refresh" label={i18n.t('player.post.replay')} onPress={replay} />
        <Button variant="ghost" label={i18n.t('player.post.close')} onPress={engine.leave} />
      </>,
    );
  }
  if (held?.nextAvailable && next) {
    const go = () => { engine.advance(passoutDue ? 'still-watching' : 'manual').catch(() => showToast({message: i18n.t('player.post.advanceFailed'), icon: 'warning'})); };
    return card(
      passoutDue ? i18n.t('player.post.stillWatching') : i18n.t('player.post.upNext'),
      <View style={{gap: 4}}>
        <Text variant={isTV ? 'heading' : 'subheading'} lines={2}>{next.title}</Text>
        <Text variant="caption" tone="secondary">{passoutDue ? i18n.t('player.post.pausedAfterEpisodes') : counting ? i18n.t('player.post.playingIn', {seconds: remaining}) : i18n.t('player.post.ready')}</Text>
      </View>,
      <>
        <Button variant="primary" icon="play" label={passoutDue ? i18n.t('player.post.stillWatchingAction') : i18n.t('player.post.playNow')} hasTVPreferredFocus onPress={go} />
        {counting ? <Button variant="outline" label={i18n.t('player.post.cancel')} onPress={() => queue?.releaseCompletion()} /> : null}
        <Button variant="ghost" icon="refresh" label={i18n.t('player.post.replay')} onPress={replay} />
        <Button variant="ghost" label={i18n.t('player.post.close')} onPress={engine.leave} />
      </>,
    );
  }
  return card(
    i18n.t('player.post.finished'),
    <View style={{gap: 4}}>
      <Text variant={isTV ? 'heading' : 'subheading'} lines={2}>{engine.identity.title}</Text>
      {held && !held.nextAvailable && held.reason === 'unavailable' ? <Text variant="caption" tone="secondary">{i18n.t('player.post.nextUnavailable')}</Text> : null}
    </View>,
    <>
      <Button variant="primary" icon="refresh" label={i18n.t('player.post.replay')} hasTVPreferredFocus onPress={replay} />
      <Button variant="outline" label={i18n.t('player.post.close')} onPress={engine.leave} />
    </>,
  );
}
