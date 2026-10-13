import React from 'react';
import {View} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {iconFor, lengthFor, useArtwork} from '../../app/content';
import {usePlayingItemId} from '../../app/player-actions';
import {useI18n} from '../../app/i18n';
import {Button, Divider, ListRow, Text, useTheme} from '../../ui';

/**
 * A numbered list of playable rows on a title page: an album's tracks, an artist's songs, a
 * book's chapters or parts, a playlist's entries. Pressing a row plays from it (APL-AUDIO-03);
 * long-press opens the entry menu. Album tracks have no artwork (the album art is in the hero,
 * APL-AUDIO-04); mixed lists (an artist's songs, a playlist) show a small square or poster.
 */
export function TrackList({title, entries, ordinal, subtitle, art = false, highlightId, total, onPlay, onMore, onShowMore, loadingMore, style}: {
  title?: string;
  entries: readonly ContentEntry[];
  /** The number shown at the start of a row (track number, chapter or position); none when it returns undefined. */
  ordinal?: (entry: ContentEntry, index: number) => number | undefined;
  /** The second line; none by default (an album's tracks need only their titles). */
  subtitle?: (entry: ContentEntry) => string | undefined;
  art?: boolean;
  /** The row to mark (the chapter a book resumes in). */
  highlightId?: string;
  total?: number;
  onPlay: (index: number) => void;
  onMore?: (entry: ContentEntry) => void;
  onShowMore?: () => void;
  loadingMore?: boolean;
  style?: object;
}) {
  const {space} = useTheme();
  const playing = usePlayingItemId();
  const i18n = useI18n();
  const artwork = useArtwork();
  if (!entries.length) return null;
  const partial = total !== undefined && total > entries.length;
  return (
    <View style={[{marginBottom: space.xl}, style]}>
      {title ? (
        <View style={{flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: space.page, marginBottom: space.sm}}>
          <Text variant="heading" lines={1}>{title}</Text>
          {partial ? <Text variant="caption" tone="tertiary">{i18n.t('title.shownOfTotal', {shown: entries.length, total: total!})}</Text> : null}
        </View>
      ) : null}
      <View style={{paddingHorizontal: space.page - space.sm}}>
        {entries.map((entry, index) => {
          const n = ordinal?.(entry, index);
          const unavailable = entry.available === false || !entry.playback;
          return (
            <View key={`${entry.id}:${index}`}>
              {index > 0 ? <Divider inset={space.sm} /> : null}
              <ListRow
                ordinal={n}
                title={entry.title}
                subtitle={subtitle?.(entry)}
                meta={lengthFor(entry)}
                source={art ? artwork(entry.posterUrl ?? entry.backdropUrl) : undefined}
                shape={entry.kind === 'song' || entry.kind === 'album' ? 'square' : 'poster'}
                icon={art && !entry.posterUrl && !entry.backdropUrl ? iconFor(entry.kind) : undefined}
                selected={entry.id === (highlightId ?? playing)}
                watched={entry.watched === true && entry.kind !== 'song'}
                unavailable={entry.available === false}
                disabled={unavailable && !entry.navigation}
                onPress={() => onPlay(index)}
                onLongPress={onMore ? () => onMore(entry) : undefined}
              />
            </View>
          );
        })}
      </View>
      {onShowMore ? (
        <View style={{alignItems: 'center', paddingTop: space.md}}>
          <Button variant="secondary" label={i18n.t('action.showMore')} loading={loadingMore} onPress={onShowMore} />
        </View>
      ) : null}
    </View>
  );
}
