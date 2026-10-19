import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import type {HttpLocalApi, LocalSession, PlaybackService} from '../../../../packages/client-core/src/index';
import {PlayerOffersService} from '../../../../packages/client-core/src/player-offers';
import type {SegmentMarker, SegmentMarkerSet} from '../../../../packages/client-core/src/segment-markers';
import {activeSegment, skipsAutomatically, skipTarget, UNDO_SECONDS, type SkipMode} from '../../../../packages/client-core/src/segment-skip';
import {useI18n} from '../app/i18n';
import {Button, Text, useTheme} from '../ui';

export type {SkipMode};

type Undo = Readonly<{marker: SegmentMarker; from: number}>;

/** Segment markers for the current session, read from the playback offer. */
export function usePlayerMarkers(service: PlaybackService, api: HttpLocalApi, viewer: LocalSession | undefined, libraryId: string | undefined, itemId: string | undefined, sessionId: string | undefined): SegmentMarkerSet | null {
  const [markers, setMarkers] = useState<SegmentMarkerSet | null>(null);
  const serverId = viewer?.viewer.serverId ?? 'signed-out';
  const viewerId = JSON.stringify([viewer?.viewer.authority, viewer?.viewer.accountId, viewer?.viewer.profileId]);
  useEffect(() => {
    setMarkers(null);
    if (!sessionId || !itemId || !libraryId) return;
    const offers = new PlayerOffersService({api, scope: {serverId, viewerId}});
    let active = true;
    offers.select({libraryId, itemId, sessionId}).then(() => {
      if (!active) return;
      const data = offers.getSnapshot().data;
      if (data?.current?.sessionId === sessionId) setMarkers(data.markers);
    }).catch(() => {});
    return () => {
      active = false;
      offers.dispose();
    };
  }, [api, serverId, viewerId, libraryId, itemId, sessionId, service]);
  return markers;
}

/**
 * Skip prompt for detected segments. The server decides which markers exist
 * and which are safe unattended; the viewer's preference decides whether to
 * ask, skip automatically, or stay quiet (the shared rules in segment-skip.ts).
 * An intro skip lands a moment before the intro ends; credits land on the
 * scene after them. An unattended skip leaves a short "Skipped intro · Undo"
 * note; undoing goes back to where the skip happened without skipping again.
 * Every skip is recorded against the session (spec §4.2).
 */
export function SkipPrompt({markers, position, duration, sessionId, modes, onSeek, onSkipped, bottom}: {markers: SegmentMarkerSet | null; position: number; duration?: number; sessionId?: string; modes: Record<string, SkipMode>; onSeek: (seconds: number) => void; onSkipped: (markerId: string, mode: 'automatic' | 'manual', positionSeconds: number) => void; bottom: number}) {
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const [undo, setUndo] = useState<Undo | null>(null);
  const skipped = useRef<Set<string>>(new Set());
  useEffect(() => {
    setDismissed(new Set());
    setUndo(null);
    skipped.current = new Set();
  }, [sessionId, markers?.revision]);
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_SECONDS * 1000);
    return () => clearTimeout(id);
  }, [undo]);
  const active = activeSegment(markers?.markers, position, modes, dismissed);
  const skip = (marker: SegmentMarker, mode: 'automatic' | 'manual') => {
    skipped.current.add(marker.id);
    setDismissed(prev => new Set(prev).add(marker.id));
    onSkipped(marker.id, mode, position);
    if (mode === 'automatic') setUndo({marker, from: position});
    onSeek(skipTarget(marker, duration));
  };
  useEffect(() => {
    if (active && skipsAutomatically(active, modes) && !skipped.current.has(active.id)) skip(active, 'automatic');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  const style = {position: 'absolute' as const, right: isTV ? 80 : space.lg, bottom, flexDirection: 'row' as const, alignItems: 'center' as const, gap: space.sm};
  if (undo) {
    return (
      <View pointerEvents="box-none" style={style} accessibilityLiveRegion="polite">
        <Text variant="caption" tone="secondary">{i18n.t('player.skipped', {kind: undo.marker.kind})}</Text>
        {/* On TV the note's Undo takes focus while it shows, so Select goes back. */}
        <Button key={`undo:${undo.marker.id}`} variant="secondary" icon="back" label={i18n.t('action.undo')} hasTVPreferredFocus={isTV} onPress={() => { const from = undo.from; setUndo(null); onSeek(from); }} />
      </View>
    );
  }
  if (!active) return null;
  return (
    <View pointerEvents="box-none" style={style}>
      {/* On TV the prompt takes focus when it appears (once per segment: keyed by marker), so Select skips. */}
      <Button key={active.id} variant="secondary" icon="forward" label={i18n.t('player.skip', {kind: active.kind})} hasTVPreferredFocus={isTV} onPress={() => skip(active, 'manual')} />
    </View>
  );
}
