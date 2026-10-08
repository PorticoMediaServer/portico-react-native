import React, {useEffect, useRef, useState} from 'react';
import {View} from 'react-native';
import type {HttpLocalApi, LocalSession, PlaybackService} from '../../../../packages/client-core/src/index';
import {PlayerOffersService} from '../../../../packages/client-core/src/player-offers';
import type {SegmentMarker, SegmentMarkerSet} from '../../../../packages/client-core/src/segment-markers';
import {useI18n} from '../app/i18n';
import {Button, useTheme} from '../ui';

export type SkipMode = 'ask' | 'auto' | 'off';

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
 * ask, skip automatically, or stay quiet. A skip seeks past the segment and
 * records the action against the session (spec §4.2).
 */
export function SkipPrompt({markers, position, sessionId, modes, onSeek, onSkipped, bottom}: {markers: SegmentMarkerSet | null; position: number; sessionId?: string; modes: Record<string, SkipMode>; onSeek: (seconds: number) => void; onSkipped: (markerId: string, mode: 'automatic' | 'manual', positionSeconds: number) => void; bottom: number}) {
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const skipped = useRef<Set<string>>(new Set());
  useEffect(() => {
    setDismissed(new Set());
    skipped.current = new Set();
  }, [sessionId, markers?.revision]);
  const active = markers?.markers.find(m => position >= m.startSeconds && position < m.endSeconds - 0.5 && !dismissed.has(m.id) && (modes[m.kind] ?? 'ask') !== 'off');
  const skip = (marker: SegmentMarker, mode: 'automatic' | 'manual') => {
    skipped.current.add(marker.id);
    setDismissed(prev => new Set(prev).add(marker.id));
    onSkipped(marker.id, mode, position);
    onSeek(marker.endSeconds);
  };
  useEffect(() => {
    if (!active) return;
    if ((modes[active.kind] ?? 'ask') === 'auto' && active.automaticSafe && !skipped.current.has(active.id)) skip(active, 'automatic');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);
  if (!active) return null;
  return (
    <View pointerEvents="box-none" style={{position: 'absolute', right: isTV ? 80 : space.lg, bottom, flexDirection: 'row', gap: space.sm}}>
      {/* On TV the prompt takes focus when it appears (once per segment: keyed by marker), so Select skips. */}
      <Button key={active.id} variant="secondary" icon="forward" label={i18n.t('player.skip', {kind: active.kind})} hasTVPreferredFocus={isTV} onPress={() => skip(active, 'manual')} />
    </View>
  );
}
