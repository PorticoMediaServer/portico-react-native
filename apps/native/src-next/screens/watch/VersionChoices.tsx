import React from 'react';
import {Text, View} from 'react-native';
import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import {versionModels, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {Focusable} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {useTheme} from '../../kit/theme';

export type NativeVersionChoicesProps = Readonly<{
  options: PlaybackOptions;
  itemId: string;
  selectedVersionId?: string;
  text: TextEnvironment;
  onChoose: (id: string) => void;
}>;

export function nativeVersionChoices(options: PlaybackOptions, itemId: string, text: TextEnvironment) {
  if (options.itemId !== itemId || options.versions.length < 2 || new Set(options.versions.map(version => version.id)).size !== options.versions.length) return [];
  return versionModels(options.versions.map(version => ({id: version.id, name: version.label, edition: version.edition, container: version.container,
    height: version.video[0]?.height, videoCodec: version.video[0]?.codec, dynamicRange: version.video[0]?.hdr, bitRate: version.bitrateKbps === undefined ? undefined : version.bitrateKbps * 1000, sizeBytes: version.sizeBytes})), text);
}

/** Only the context-menu's real grouped MediaVersion IDs reach the fenced start command. */
export function NativeVersionChoices({options, itemId, selectedVersionId, text, onChoose}: NativeVersionChoicesProps) {
  const theme = useTheme(), rows = nativeVersionChoices(options, itemId, text);
  return <View>{rows.map(row => <Focusable key={row.id} focusId={row.id} testID={`watch-version-${row.id}`} accessibilityRole="radio" accessibilityState={{checked: row.id === selectedVersionId}}
    onPress={() => onChoose(row.id)} style={{minHeight: theme.isTV ? 72 : 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: theme.colors.line}}>
    <View style={{flex: 1}}><Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{row.name.map(part => part.text).join(' ')}</Text>
      {row.detail.length > 0 && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{row.detail.map(part => part.text).join(' ')}</Text>}
    </View>
    {row.id === selectedVersionId && <Icon name="i-check" size={theme.isTV ? 24 : 18} color={theme.colors.accentStrong}/>}
  </Focusable>)}</View>;
}
