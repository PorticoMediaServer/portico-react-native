import React from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';
import {defaultI18n, type MessageId} from '../../../../../../packages/i18n/src';
import type {SignalTranslate} from '../../../../../../packages/client-core/src/music-signal';
import type {MusicSignalInput} from '../../../../../../packages/client-core/src/music-signal';
import {Icon} from '../../../kit/Icon';
import {Focusable} from '../../../kit/controls';
import {useTheme} from '../../../kit/theme';
import {nativeType} from '../../../kit/theme';
import {nativeSignalPath, type NativeSignalPath} from './signal-path-model';

const t = defaultI18n.t;
const translate: SignalTranslate = (key: MessageId, values) => t(key, values as never);

export type MusicSignalView = Readonly<{input: MusicSignalInput; path: NativeSignalPath}>;

/** music-plus (MC-8) 3/5: the one line under the title. TV takes the caption size and a
 * chevron; a phone rests on a faint chip because touch has no hover. */
export function MusicSignalLine({view, onPress}: {view: MusicSignalView; onPress?: () => void}) {
  const theme = useTheme(), tv = theme.isTV, path = view.path;
  const colour = path.healthy ? theme.colors.healthy : theme.colors.textTertiary;
  const body = <View style={{flexDirection: 'row', alignItems: 'center', gap: tv ? 14 : 7, minWidth: 0}}>
    <Icon name="i-pulse" size={tv ? 26 : 15} color={colour}/>
    {path.source ? <Text numberOfLines={1} ellipsizeMode="clip" style={[nativeType({size: tv ? 22 : 12, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text, flexShrink: 0}]}>{path.source}</Text> : null}
    {path.state ? <Text numberOfLines={1} ellipsizeMode="tail" style={[nativeType({size: tv ? 22 : 12, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textSecondary, flexShrink: 1}]}>{path.state}</Text> : null}
    {tv && <Icon name="i-right" size={20} color={theme.colors.textTertiary}/>}
  </View>;
  const label = path.accessibleName ?? [path.source, path.state].filter(Boolean).join('. ');
  if (!onPress) return <View accessible accessibilityLabel={label} style={{maxWidth: tv ? 556 : 342}}>{body}</View>;
  if (tv) return <Focusable focusId="music-signal-line" testID="music-signal-line" accessibilityRole="button" accessibilityLabel={label} focusRadius={10}
    onPress={onPress} style={{maxWidth: 556, paddingVertical: 4, paddingRight: 6}}>{body}</Focusable>;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} testID="music-signal-line"
    style={{maxWidth: 342, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: 'rgba(237,245,250,.07)'}}>{body}</Pressable>;
}

function Row({label, value, note, changed}: {label: string; value?: string; note?: string; changed: boolean}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', alignItems: 'flex-start', gap: theme.isTV ? 18 : 10, paddingVertical: theme.isTV ? 10 : 7}}>
    <View style={{width: theme.isTV ? 12 : 9, height: theme.isTV ? 12 : 9, borderRadius: 6, marginTop: theme.isTV ? 9 : 5,
      backgroundColor: changed ? theme.colors.text : theme.colors.healthy}}/>
    <Text style={[nativeType({size: theme.isTV ? 22 : 13.5, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {width: theme.isTV ? 250 : 108, color: theme.colors.textSecondary}]}>{label}</Text>
    <View style={{flex: 1, minWidth: 0}}>
      {value ? <Text style={[nativeType({size: theme.isTV ? 22 : 13.5, weight: changed ? 800 : 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{value}</Text> : null}
      {note ? <Text style={[nativeType({size: theme.isTV ? 18 : 12, weight: 500, tracking: 0, lineHeight: 'normal'}, theme.textScale), {marginTop: 2, color: theme.colors.textTertiary}]}>{note}</Text> : null}
    </View>
  </View>;
}

/** music-plus 3b/6: the same rows as the desktop popover, as a phone sheet or a TV side sheet.
 * The pill names the output only; the steps say what each part of the path did. */
export function MusicSignalSheet({view, onClose}: {view: MusicSignalView; onClose: () => void}) {
  const theme = useTheme(), tv = theme.isTV, path = view.path;
  return <View style={{flex: 1, backgroundColor: tv ? 'rgba(7,16,24,.96)' : theme.colors.ink, paddingTop: tv ? 64 : 54, paddingHorizontal: tv ? 56 : 20}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 14}}>
      <Text style={[nativeType({size: tv ? 30 : 20, weight: 800, tracking: -.02, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{t('player.signal.title')}</Text>
      <View style={{paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, backgroundColor: path.healthy ? 'rgba(134,207,179,.16)' : 'rgba(237,245,250,.1)'}}>
        <Text style={[nativeType({size: tv ? 19 : 12.5, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: path.healthy ? theme.colors.healthy : theme.colors.textSecondary}]}>{view.path.pill}</Text>
      </View>
      <View style={{flex: 1}}/>
      <Focusable focusId="music-signal-done" testID="music-signal-done" accessibilityRole="button" accessibilityLabel={t('action.done')}
        hasTVPreferredFocus={tv} onPress={onClose} style={{paddingHorizontal: tv ? 26 : 14, paddingVertical: tv ? 12 : 8, borderRadius: 10, backgroundColor: theme.colors.text}}>
        <Text style={[nativeType({size: tv ? 21 : 13.5, weight: 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.ink}]}>{t('action.done')}</Text>
      </Focusable>
    </View>
    <ScrollView style={{marginTop: tv ? 26 : 16}} showsVerticalScrollIndicator={false}>
      {path.steps.map(step => <Row key={step.id} label={step.label} value={step.value} note={step.note} changed={step.changed}/>)}
    </ScrollView>
  </View>;
}

/** The projection the host renders: one call, no store. */
export function musicSignalView(input: MusicSignalInput): MusicSignalView {
  return Object.freeze({input, path: nativeSignalPath(input, translate)});
}
