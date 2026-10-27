import React from 'react';
import {View, type NativeScrollEvent} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls';
import {MusicErrorView} from './MusicErrorView';
import type {MusicSection} from './paging';

/** Called only by real scroll/focus events, never by a mount/response loop. */
export function musicNearEnd(event: NativeScrollEvent, horizontal = false): boolean {
  return horizontal ? event.contentOffset.x + event.layoutMeasurement.width >= event.contentSize.width - 240
    : event.contentOffset.y + event.layoutMeasurement.height >= event.contentSize.height - 320;
}
export function MusicSectionControls<T>({section, next, previous, retry, refresh, id}: {
  section: MusicSection<T>; next: () => void; previous: () => void; retry: () => void; refresh: () => void; id: string;
}) {
  return <View testID={`music-pages-${id}`} style={{gap: 12, marginTop: 12}}>
    {section.phase === 'error' || section.phase === 'refresh-required'
      ? <MusicErrorView error={section.error} onRetry={section.phase === 'refresh-required' ? refresh : retry}/> : null}
    <View style={{flexDirection: 'row', gap: 16}}>
      {section.canPrevious ? <Button testID={`music-previous-${id}`} focusId={`music-previous-${id}`} disabled={section.phase === 'loading'} variant="text" onPress={previous}>{defaultI18n.t('next.layout.previousItems')}</Button> : null}
      {section.canNext ? <Button testID={`music-next-${id}`} focusId={`music-next-${id}`} disabled={section.phase === 'loading'} variant="text" onPress={next}>{defaultI18n.t('next.layout.nextItems')}</Button> : null}
    </View>
  </View>;
}
