import React from 'react';
import {View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ReadingReadMark} from '../../../../../packages/client-core/src';
import {Button, ResumeButton} from '../../kit/controls';
import {useTheme} from '../../kit/theme';

const {t} = defaultI18n;

/** phone-read 3/41a: the drawn action row is the book's real Read/Resume
 * offer, the original finished mark when this page was offered one, and its
 * real Download offer. The primary keeps the first weight; the round controls
 * take the authored 46 pt phone size. The retained menu keeps the same mark
 * object and handler, so a later page cannot lend this row its authority. */
export function BookDetailActions({saved, readMark, canDownload, onRead, onReadMark, onDownload, downloadRef, horizontalPadding = 20, roundSize = 46}: {
  saved?: number;
  readMark?: ReadingReadMark;
  canDownload: boolean;
  onRead: () => void;
  onReadMark: (mark: ReadingReadMark) => void;
  onDownload: () => void;
  downloadRef: React.RefObject<View | null>;
  horizontalPadding?: number;
  roundSize?: number;
}) {
  const theme = useTheme();
  return <View style={{paddingHorizontal: horizontalPadding, paddingTop: 18}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
      {saved === undefined
        ? <Button icon="i-book" onPress={onRead} style={{flex: 1}}>{t('next.reader.read')}</Button>
        : <ResumeButton progress={saved} onPress={onRead} style={{flex: 1}}>{t('next.cards.read')}</ResumeButton>}
      {readMark ? <Button variant="icon" icon="i-check" iconOnly
        accessibilityState={{selected: readMark.read}}
        accessibilityLabel={t(readMark.read ? 'next.reader.markUnread' : 'next.reader.markRead')}
        iconColor={readMark.read ? theme.colors.accentStrong : undefined}
        onPress={() => onReadMark(readMark)} style={{height: roundSize, width: roundSize}}/> : null}
      <Button ref={downloadRef} variant="icon" icon="i-dl" iconOnly disabled={!canDownload}
        accessibilityLabel={t('action.download')} onPress={onDownload} style={{height: roundSize, width: roundSize}}/>
    </View>
  </View>;
}
