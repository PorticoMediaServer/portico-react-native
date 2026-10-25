import React, {useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {durationText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeDiscTitlePlayController} from './disc-title-play-controller';

/** The read/prepare half of an alternate disc title: the facts the server published
 * for that one title, then the prepare it is doing. It draws no Play control, and no
 * caller can offer one: the native runtime is queue-required while the server
 * refuses a disc title with a queue, so no admission exists yet. The host adds its
 * Play once one does, from the same selection. */
export function NativeDiscTitlePlayPanel({controller, renderError}: {
  controller: NativeDiscTitlePlayController;
  renderError: (error: unknown, retry: () => void) => React.ReactNode;
}) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (!state) return null;
  const {selection} = state;
  const subjects = [selection.main ? t('next.overlays.discMainTitle') : undefined,
    t('next.overlays.discChapters', {count: selection.chapterCount}),
    durationText(Math.round(selection.durationMs / 1000), t)].filter(Boolean).join(' · ');
  return <View testID="watch-disc-title-play" style={{gap: theme.isTV ? 8 : 5}}>
    <Text numberOfLines={1} style={[nativeType({size: theme.isTV ? 24 : 15.5, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale),
      {color: theme.colors.text}]}>{t('next.overlays.discTitle', {number: selection.number})}</Text>
    <Text numberOfLines={2} style={[nativeType({size: theme.isTV ? 19 : 13, weight: 500, tracking: 0, lineHeight: theme.isTV ? 27 : 18.2}, theme.textScale),
      {color: theme.colors.textTertiary}]}>{subjects}</Text>
    {state.phase === 'preparing' && <Text style={[nativeType({size: theme.isTV ? 20 : 13.5, weight: 500, tracking: 0, lineHeight: 'normal'}, theme.textScale),
      {color: theme.colors.textTertiary}]}>{t('next.browse.native.markAllPreparing')}</Text>}
    {!!state.error && <View style={{marginTop: theme.isTV ? 8 : 6}}>{renderError(state.error, () => {void controller.prepareSelected();})}</View>}
  </View>;
}
