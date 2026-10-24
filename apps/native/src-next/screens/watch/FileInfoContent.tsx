import React from 'react';
import {ScrollView, Text, View} from 'react-native';
import type {FactPart, FileInfoModel, ManageAction} from '../../../../../packages/client-core/src/presentation/kit-model';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {nativeType, useTheme} from '../../kit/theme';
import type {NativeFileInfoLocation} from './file-info';

export type NativeFileInfoContentProps = Readonly<{
  /** Constructed from the real lazy File info projection, never DetailProjection.files. */
  model: FileInfoModel;
  /** Physical paths retain exact member IDs beneath their authoritative version group. */
  locations?: readonly NativeFileInfoLocation[];
  onManage: (action: ManageAction['id'], fileId?: string) => void;
}>;
const words = (parts: readonly FactPart[]) => parts.map(part => part.text).join('');
function Parts({parts, comma = false}: {parts: readonly FactPart[]; comma?: boolean}) {
  const theme = useTheme();
  return <Text style={{color: theme.colors.text, fontFamily: theme.type.body.fontFamily, fontSize: theme.isTV ? 22 : 12.5, lineHeight: theme.isTV ? 32 : 19}}>{comma ? words(parts) : parts.map(part => part.text).join(' ')}</Text>;
}

/** Informational version cards; no radio, Play button, grants or synthesized file count. */
export function NativeFileInfoContent({model, locations, onManage}: NativeFileInfoContentProps) {
  const theme = useTheme(), t = defaultI18n.t;
  const label = {color: theme.colors.textTertiary, fontFamily: theme.type.body.fontFamily, fontSize: theme.isTV ? 22 : 12.5};
  const value = {color: theme.colors.text, fontFamily: theme.type.bodyStrong.fontFamily, fontSize: theme.isTV ? 22 : 12.5};
  const headings = [t('title.version'), t('next.kit.resolution'), t('next.kit.video'), t('next.kit.audio'), t('next.kit.size'), t('next.kit.length')];
  return <ScrollView testID="watch-file-info-content" contentContainerStyle={{gap: theme.isTV ? 0 : 10, paddingBottom: 24}}>
    {theme.isTV ? <>
      <View style={{flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.colors.line, paddingVertical: 14}}>{headings.map((heading, index) => <Text key={heading} style={[label, {flex: index === 2 || index === 3 ? 1.4 : 1}]}>{heading}</Text>)}</View>
      {model.files.map(file => <View key={file.id} style={{flexDirection: 'row', paddingVertical: 16, borderBottomWidth: 1, borderColor: theme.colors.line}}>
        <Text style={[value, {flex: 1}]}>{file.display.heading.text}</Text>
        <View style={{flex: 1}}><Parts parts={file.rows.find(row => row.id === 'resolution')?.parts ?? []}/></View>
        <View style={{flex: 1.4}}><Parts parts={file.display.video.filter(part => part.id === 'codec' || part.id === 'codec-profile')}/></View>
        <View style={{flex: 1.4}}>{file.display.audio.map(audio => <Parts key={audio.id} parts={audio.parts}/>)}</View>
        <View style={{flex: 1}}><Parts parts={file.rows.find(row => row.id === 'size')?.parts ?? []}/></View>
        <View style={{flex: 1}}><Parts parts={file.rows.find(row => row.id === 'length')?.parts ?? []}/></View>
      </View>)}
    </> : model.files.map(file => <View key={file.id} style={{backgroundColor: '#172e3c', borderRadius: 14, padding: 14}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12}}>
        <View style={{paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: '#244555'}}><Text style={[label, {fontSize: 11, color: theme.colors.accentStrong}]}>{file.display.heading.text}</Text></View>
        <Text style={[value, {fontSize: 15, flex: 1}]}>{file.display.summary.map(part => part.text).join(' ')}</Text>
      </View>
      {(['resolution', 'video', 'audio', 'subtitles', 'size', 'length'] as const).map(id => {
        const row = file.rows.find(value => value.id === id);
        const parts = id === 'video' ? file.display.video : id === 'subtitles' ? file.display.subtitles : row?.parts;
        if (id === 'audio' && !file.display.audio.length || id !== 'audio' && !parts?.length) return null;
        return <View key={id} style={{flexDirection: 'row', gap: 10, marginBottom: 5}}>
          <Text style={[label, {width: 70}]}>{id === 'audio' ? t('next.kit.audio') : id === 'subtitles' ? t('next.kit.subtitles') : row?.label}</Text>
          <View style={{flex: 1}}>{id === 'audio' ? file.display.audio.map(audio => <Parts key={audio.id} parts={audio.parts} comma/>) : <Parts parts={parts ?? []} comma={id === 'video' || id === 'subtitles'}/>}</View>
        </View>;
      })}
    </View>)}
    <Text style={[label, {fontSize: theme.isTV ? 21 : 12.5, lineHeight: theme.isTV ? 29 : 19, marginTop: theme.isTV ? 16 : 2}]}>{t('next.overlays.native.fileInfoNote')}</Text>
    {model.owner && <View style={{marginTop: theme.isTV ? 26 : 16, borderWidth: 1, borderColor: theme.colors.line, borderRadius: 16, overflow: 'hidden'}}>
      <View style={{flexDirection: 'row', alignItems: 'center', padding: theme.isTV ? 24 : 14, gap: 12, backgroundColor: '#153140'}}>
        <Icon name="i-server" size={theme.isTV ? 26 : 20} color={theme.colors.textSecondary}/>
        <Text style={[nativeType({size: theme.isTV ? 25 : 16, weight: 800, tracking: -.015, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text, flex: 1}]}>{model.owner.heading}</Text>
        <Text style={[label, {fontSize: theme.isTV ? 18 : 11}]}>{t('next.overlays.native.ownerOnly')}</Text>
      </View>
      <View style={{padding: theme.isTV ? 24 : 14, gap: 12}}>
        {(locations ?? model.owner.locations.map(location => ({...location, versionId: location.id}))).map(location => <View key={location.id} style={{gap: 8, borderBottomWidth: 1, borderColor: theme.colors.line, paddingBottom: 14}}>
          <Text style={label}>{model.files.find(file => file.id === location.versionId)?.display.heading.text}</Text>
          {location.path && <Text selectable style={[label, {lineHeight: theme.isTV ? 30 : 19}]}>{location.path}</Text>}
          {location.actions.map(action => <Button key={action.id} focusId={`watch-file-${location.id}-${action.id}`} testID={`watch-file-${location.id}-${action.id}`} variant="glass" size="small" icon="i-trash" onPress={() => onManage(action.id, location.id)} textStyle={{color: theme.colors.record}}>{action.label}</Button>)}
        </View>)}
        {model.owner.actions.filter(action => !theme.isTV || action.id !== 'merge-title').map(action => <Button key={action.id} focusId={`watch-file-owner-${action.id}`} testID={`watch-file-owner-${action.id}`} variant="glass" size="small" onPress={() => onManage(action.id)}>{action.label}</Button>)}
      </View>
    </View>}
  </ScrollView>;
}
