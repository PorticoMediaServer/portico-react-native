import React from 'react';
import {View} from 'react-native';
import {ProfileFace, type ArtworkSource} from '../../../kit/artwork';
import {SessionCard} from '../../../kit/cards';
import {OwnerCalm, OwnerSection} from './parts';
import type {OwnerStreamView, Translate} from './model';

export type OwnerStreamEntry = Readonly<{view: OwnerStreamView; artwork?: ArtworkSource}>;

const faceColors = ['mint', 'violet', 'gold', 'blue', 'slate', 'rose', 'sky'] as const;

/** The frame's initial circle: the stream's own person, tinted by its place in the list. */
function face(index: number, name: string) {
  return <ProfileFace initial={(name.trim()[0] ?? '?').toUpperCase()} color={faceColors[index % faceColors.length]} size={20} scaleOnFocus={false}/>;
}

/** Now playing as the frames draw it at ten streams or fewer: one authorized card per stream. */
export function OwnerNowPlaying({streams, people, loading, error, onRetry, onStop, onMenu, t}: {
  streams: readonly OwnerStreamEntry[];
  people?: string;
  loading: boolean;
  error?: unknown;
  onRetry: () => void;
  onStop: (view: OwnerStreamView) => void;
  onMenu: (view: OwnerStreamView) => void;
  t: Translate;
}) {
  return <OwnerSection title={t('settings.server.nowPlaying')} sub={people}>
    {error !== undefined && !streams.length ? <OwnerCalm icon="i-warn" tone="error" title={t('next.shell.activityError')} action={{label: t('next.shell.tryAgain'), onPress: onRetry}}/> : null}
    {!loading && error === undefined && !streams.length ? <OwnerCalm icon="i-play" title={t('web.nowPlaying.empty')} body={t('next.dashboard.calmStreamsBody')}/> : null}
    {streams.map((entry, index) => <View key={entry.view.id} style={{marginBottom: 12}}>
      <SessionCard testID={`owner-stream-${entry.view.id}`} title={entry.view.title} identity={entry.view.identity} facts={[...entry.view.facts, ...(entry.view.state ? [entry.view.state] : []), ...(entry.view.position ? [entry.view.position] : [])]}
        viewer={entry.view.viewer} viewerBadge={face(index, entry.view.viewer.username || entry.view.viewer.name)} artwork={entry.artwork} progress={entry.view.progress} paused={entry.view.paused}
        primaryAction="play" onPlay={() => onMenu(entry.view)} onStop={() => onStop(entry.view)} onMore={() => onMenu(entry.view)} accessibilityLabel={`${entry.view.title}, ${entry.view.viewer.username || entry.view.viewer.name}, ${entry.view.viewer.device}`} menuVisibility="always"/>
    </View>)}
  </OwnerSection>;
}
