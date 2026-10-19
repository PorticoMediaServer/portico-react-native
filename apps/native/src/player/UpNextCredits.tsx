import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import type {SegmentMarkerSet} from '../../../../packages/client-core/src/segment-markers';
import {upNextCountdown, upNextOffer, type UpNextOffer} from '../../../../packages/client-core/src/up-next';
import {followedByScene} from '../../../../packages/client-core/src/segment-skip';
import {formatClock, useArtwork} from '../app/content';
import {useI18n} from '../app/i18n';
import {Artwork, Button, Text, alpha, useTheme} from '../ui';
import type {SkipMode} from './SkipPrompt';
import type {PlayerEngine} from './usePlayer';

const noSubscribe = () => () => {};
const noSnapshot = () => null;

/**
 * The next title, offered while the closing credits run (the same rules as web: `upNextOffer`).
 * Its card stands in for the "Skip credits" button. "Play now" goes straight to the next title;
 * "Watch credits" puts the card away for this title. Nothing starts before the title ends unless
 * the viewer turned on "Start the next episode during the credits" (off by default), autoplay is
 * on and the server is sure of the credits marker (`upNextCountdown`); then the viewer's post-play
 * countdown runs on the card and the next title starts when it reaches zero, as an automatic
 * advance the server counts toward "Still watching?".
 */
export function useUpNextDuringCredits(engine: PlayerEngine, markers: SegmentMarkerSet | null, mode: SkipMode, enabled: boolean) {
  const {state} = engine;
  const queue = engine.service.getQueueController();
  const snapshot = useSyncExternalStore(queue?.subscribe ?? noSubscribe, queue?.getSnapshot ?? noSnapshot);
  const view = snapshot?.view ?? null;
  const [dismissed, setDismissed] = useState<string | null>(null);
  useEffect(() => { setDismissed(null); }, [state.session?.id]);
  const next = view?.next.entryId ? view.items.find(item => item.entryId === view.next.entryId) : undefined;
  const offer = enabled && state.phase === 'ready' && next
    ? upNextOffer({markers: markers?.markers, positionSeconds: state.positionSeconds, durationSeconds: state.duration, kind: engine.identity.kind, mode, nextAvailable: !!view?.next.available, passoutDue: !!view?.postPlay.passoutCheckDue})
    : null;
  const shown = offer && dismissed !== offer.id ? offer : null;
  return {offer: shown, next, postPlay: view?.postPlay, dismiss: () => { if (offer) setDismissed(offer.id); }};
}

type NextTitle = Readonly<{title: string; kind: string; posterUrl?: string; stillUrl?: string}>;

export function UpNextCredits({engine, offer, next, postPlay, bottom, onDismiss}: {engine: PlayerEngine; offer: UpNextOffer; next: NextTitle; postPlay?: Readonly<{autoplay: boolean; countdownSeconds: number; startDuringCredits?: boolean}>; bottom: number; onDismiss: () => void}) {
  const {colors, space, metrics, isTV} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const {state} = engine;
  // Seconds of this offer spent playing: a pause holds the count where it is.
  const [elapsed, setElapsed] = useState(0);
  const playing = state.intent === 'playing' && !state.pendingSeek;
  useEffect(() => { setElapsed(0); }, [offer.id]);
  useEffect(() => {
    if (!playing) return;
    let last = Date.now();
    const id = setInterval(() => { const now = Date.now(); setElapsed(e => e + (now - last) / 1000); last = now; }, 250);
    return () => clearInterval(id);
  }, [playing, offer.id]);
  const rate = engine.speedState.effective || engine.speedState.desired || 1;
  const countdown = upNextCountdown({offer, positionSeconds: state.positionSeconds, durationSeconds: state.duration, rate, autoplay: postPlay?.autoplay ?? true, countdownSeconds: postPlay?.countdownSeconds ?? 10, startDuringCredits: postPlay?.startDuringCredits === true, elapsedSeconds: elapsed});
  const moved = useRef('');
  const leave = (automatic: boolean) => {
    if (moved.current === offer.id) return;
    moved.current = offer.id;
    // Leaving during the credits is a skip of them, recorded like the skip button's.
    if (offer.marker) engine.service.markerSkipped(offer.marker.id, automatic ? 'automatic' : 'manual', engine.state.positionSeconds);
    const queue = engine.service.getQueueController();
    const view = queue?.getSnapshot()?.view;
    if (automatic && view && queue?.advanceFromCredits) void queue.advanceFromCredits(view.queue.id, view.queue.revision).catch(() => {});
    else engine.step('next');
  };
  const due = countdown?.automatic && countdown.seconds <= 0;
  useEffect(() => { if (due) leave(true); }); // eslint-disable-line react-hooks/exhaustive-deps
  const episode = next.kind === 'episode';
  const art = next.stillUrl ?? next.posterUrl;
  const landscape = !!next.stillUrl || (!art && episode);
  const total = Math.max(1, postPlay?.countdownSeconds ?? 10);
  const artWidth = isTV ? 200 : 112;
  return (
    <View pointerEvents="box-none" style={{position: 'absolute', right: isTV ? 80 : space.lg, bottom, maxWidth: isTV ? 560 : 360}}>
      <View accessibilityRole="summary" accessibilityLabel={i18n.t('player.upNext.duringCredits')} style={{padding: isTV ? space.lg : space.md, gap: space.sm, borderRadius: metrics.radius.panel, backgroundColor: alpha(colors.ink, 0.86), borderWidth: 1, borderColor: alpha(colors.white, 0.12)}}>
        <View style={{flexDirection: 'row', gap: space.md, alignItems: 'center'}}>
          <Artwork source={art ? artwork(art) : undefined} shape={landscape ? 'landscape' : 'poster'} width={landscape ? artWidth : artWidth * 0.5} title={next.title} icon={episode ? 'tv' : 'film'} radius={metrics.radius.card} />
          <View style={{flexShrink: 1, gap: 2}}>
            <Text variant="label" tone="tertiary">{i18n.t('player.upNext.duringCredits')}</Text>
            <Text variant={isTV ? 'subheading' : 'body'} lines={2}>{next.title}</Text>
            {countdown ? <Text variant="caption" tone="secondary">{countdown.automatic ? i18n.t('player.post.playingIn', {seconds: countdown.seconds}) : i18n.t('player.upNext.startsIn', {time: formatClock(countdown.seconds)})}</Text> : null}
          </View>
        </View>
        {countdown?.automatic ? (
          <View style={{height: 3, borderRadius: 2, backgroundColor: alpha(colors.white, 0.16), overflow: 'hidden'}}>
            <View style={{height: 3, width: `${Math.min(100, (elapsed / total) * 100)}%`, backgroundColor: colors.white}} />
          </View>
        ) : null}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
          {/* On TV the card takes focus when it appears (once per offer), so Select plays the next title. */}
          <Button key={offer.id} variant="primary" icon="play" label={i18n.t('player.upNext.playNow')} hasTVPreferredFocus={isTV} onPress={() => leave(false)} />
          {/* A scene after the credits: skipping them goes to it instead of the next title. */}
          {offer.marker && followedByScene(offer.marker, state.duration) ? <Button variant="secondary" icon="forward" label={i18n.t('player.skip', {kind: offer.marker.kind})} onPress={() => { const marker = offer.marker!; engine.service.markerSkipped(marker.id, 'manual', engine.state.positionSeconds); onDismiss(); engine.seekTo(marker.endSeconds); }} /> : null}
          <Button variant="ghost" label={i18n.t(offer.marker ? 'player.upNext.watchCredits' : 'player.upNext.notNow')} onPress={onDismiss} />
        </View>
      </View>
    </View>
  );
}
