import {retryable} from './lyrics-retry';
import React, {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {Pressable, ScrollView, View} from 'react-native';
import {LyricsService, activeLyricLine, lyricSeekPosition} from '../../../../packages/client-core/src/lyrics';
import {viewerScope} from '../app/content';
import {say} from '../app/errors';
import {useSession} from '../app/session';
import {Button, Text, useTheme} from '../ui';
import type {PlayerEngine} from './usePlayer';
import {useI18n} from '../app/i18n';

/**
 * APL-AUDIO-01: synced lyrics for the song playing. The current line is highlighted and kept in
 * the upper third of the panel as the song plays; a line can be pressed to jump to it.
 */
export function Lyrics({engine}: {engine: PlayerEngine}) {
  const i18n = useI18n();
  const {api, session} = useSession();
  const {state, identity} = engine;
  const {space, isTV} = useTheme();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const sessionId = state.session?.id;
  const generation = state.session?.generation;
  const reader = useMemo(
    () => (sessionId && generation !== undefined && state.itemId && identity.libraryId ? new LyricsService(api, scope, {libraryId: identity.libraryId, itemId: state.itemId, sessionId, sessionGeneration: generation}) : null),
    [api, scope, identity.libraryId, state.itemId, sessionId, generation],
  );
  const phase = useRef(state.phase);
  phase.current = state.phase;
  useEffect(() => {
    if (!reader) return;
    const refresh = () => { if (!['ended', 'error', 'idle'].includes(phase.current)) void reader.refresh(); };
    refresh();
    const timer = setInterval(refresh, 30000);
    return () => { clearInterval(timer); reader.dispose(); };
  }, [reader]);
  const data = useSyncExternalStore(reader?.subscribe ?? (() => () => {}), reader?.getSnapshot ?? (() => null));
  const selected = data?.data?.selection.resource;
  const doc = selected?.document;
  const source = data?.data?.source;
  const current = doc ? activeLyricLine(doc, state.positionSeconds, selected?.offsetMs ?? 0, source?.startSeconds ?? 0) : -1;
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef(new Map<number, number>());
  const [height, setHeight] = React.useState(0);
  useEffect(() => {
    const y = offsets.current.get(current);
    if (y !== undefined) scroller.current?.scrollTo({y: Math.max(0, y - height / 3), animated: true});
  }, [current, height]);
  if (!reader) return null;
  return (
    <ScrollView ref={scroller} accessibilityLabel={i18n.t('player.lyrics')} onLayout={e => setHeight(e.nativeEvent.layout.height)} style={{flex: 1, alignSelf: 'stretch'}} contentContainerStyle={{paddingHorizontal: space.lg, paddingVertical: space.xl, gap: space.xs}}>
      {data?.error ? <View style={{alignItems: 'center', gap: space.sm}}><Text variant="caption" tone="secondary" align="center">{say(data.error, 'playback')}</Text>{retryable(data.error) ? <Button variant="ghost" label={i18n.t('action.tryAgain')} onPress={() => void reader.refresh()} /> : null}</View> : null}
      {!doc && !data?.busy && !data?.error ? <Text variant="body" tone="secondary" align="center">{data?.data?.resources.length ? i18n.t('player.chooseLyrics') : i18n.t('player.noLyrics')}</Text> : null}
      {!doc ? data?.data?.resources.filter(r => !r.deleted).map(r => <Button key={r.id} variant="ghost" label={r.provenance.label || r.language} onPress={() => void reader.choose(r)} />) : null}
      {doc?.lines.map((line, i) => {
        const seek = source ? lyricSeekPosition(line, selected?.offsetMs ?? 0, source) : null;
        const active = current >= 0 && line.atMs === doc.lines[current].atMs;
        return (
          <Pressable key={i} onLayout={e => offsets.current.set(i, e.nativeEvent.layout.y)} disabled={seek === null} accessibilityRole="button" accessibilityState={{selected: active, disabled: seek === null}} onPress={() => { if (seek !== null) engine.seekTo(seek); }} style={{paddingVertical: space.xs, opacity: active ? 1 : 0.5}}>
            <Text variant={isTV ? 'heading' : 'subheading'} align="center">{line.text || '♪'}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

