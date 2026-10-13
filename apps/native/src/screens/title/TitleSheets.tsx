import React from 'react';
import {View} from 'react-native';
import type {DetailSource} from '../../../../../packages/client-core/src/detail';
import {formatDuration} from '../../app/content';
import {useI18n} from '../../app/i18n';
import {Button, ListRow, Sheet, useTheme} from '../../ui';
import {factsLine} from './facts';

/**
 * APL-DETAIL-01: "Rate…" asks for a value before anything is written. Whole stars (the caller
 * keeps them as a whole number from 0 to 10, two to a star), plus "Clear rating" when there is one. On TV the stars are one row:
 * Left/Right moves, Select rates.
 */
export function RateSheet({open, title, value, onRate, onClose}: {open: boolean; title: string; value: number | null | undefined; onRate: (value: number | null) => void; onClose: () => void}) {
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const current = value ?? 0;
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('title.rate', {title})} kind="picker" placement={isTV ? 'center' : 'auto'}>
      <View style={{flexDirection: 'row', justifyContent: 'center', gap: space.sm, paddingVertical: space.md}}>
        {[1, 2, 3, 4, 5].map(stars => (
          <Button
            key={stars}
            variant="ghost"
            round
            size="lg"
            icon={stars <= current ? 'starFilled' : 'star'}
            selected={stars === current}
            hasTVPreferredFocus={isTV && stars === Math.max(1, Math.round(current))}
            accessibilityLabel={i18n.t('title.stars', {count: stars})}
            onPress={() => { onRate(stars); onClose(); }}
          />
        ))}
      </View>
      {value != null ? (
        <View style={{alignItems: 'center', paddingBottom: space.md}}>
          <Button variant="ghost" size="sm" label={i18n.t('title.clearRating')} onPress={() => { onRate(null); onClose(); }} />
        </View>
      ) : null}
    </Sheet>
  );
}

/** APL-DETAIL-01: the file facts, read-only, one row per version (not on the consumer page). Done gives TV focus a place to land. */
export function MediaInfoSheet({open, title, sources, onClose}: {open: boolean; title: string; sources: readonly DetailSource[]; onClose: () => void}) {
  const {isTV} = useTheme();
  const i18n = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('title.mediaInformation')} subtitle={title} kind="form" cancelLabel={null} primary={{label: i18n.t('action.done'), onPress: onClose}} placement={isTV ? 'side' : 'auto'}>
      {sources.map((s, index) => (
        <ListRow
          key={s.id}
          icon="info"
          title={factsLine([s.width && s.height ? `${s.width}×${s.height}` : undefined, s.videoCodec?.toUpperCase()]) || `${index + 1}`}
          subtitle={factsLine([s.audioCodec?.toUpperCase(), s.container?.toUpperCase(), s.duration ? formatDuration(s.duration) : undefined])}
          subtitleLines={2}
        />
      ))}
    </Sheet>
  );
}
