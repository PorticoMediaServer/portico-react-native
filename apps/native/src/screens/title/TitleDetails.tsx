import React from 'react';
import {View} from 'react-native';
import type {TitleFile} from '../../../../../packages/client-core/src/detail';
import {titleFileLines} from '../../../../../packages/client-core/src/presentation/index';
import {useI18n} from '../../app/i18n';
import {Button, ListRow, Surface, Text, useTheme} from '../../ui';
import {fileHeadings} from './file-heading';
import {useLanguageName} from './language';

/**
 * Details, the section that closes a title page (Spec — Page Content §0.3): the facts that do not
 * belong in the hero line, then Files — per file what it is ("4K · HEVC · Dolby Vision · MKV"),
 * its size and bitrate, every audio and subtitle track, and where it lives (owners only). A title
 * can hold several files: each says which version it is, which part where the title is split
 * across files, and its edition where it has one. The lines come from the shared model. Rows are readable stops on television, so the remote can
 * reach the bottom of the page.
 */
export function TitleDetails({rows, files, genres}: {rows: readonly (readonly [string, string])[]; files?: readonly TitleFile[]; /** Genres as buttons: each opens the library filtered to it. */ genres?: Readonly<{names: readonly string[]; onPress: (name: string) => void}>}) {
  const {space, isTV} = useTheme();
  const i18n = useI18n();
  const name = useLanguageName();
  if (!rows.length && !files?.length && !genres?.names.length) return null;
  const headings = fileHeadings(files ?? []);
  return (
    <View style={{paddingHorizontal: space.page, marginBottom: space.xl, gap: space.md}}>
      <Text variant="heading">{i18n.t('title.details')}</Text>
      {rows.length ? (
        <Surface padded={false}>
          {rows.map(([label, value]) => <ListRow key={label} title={label} subtitle={value} subtitleLines={3} readable={isTV} />)}
        </Surface>
      ) : null}
      {genres?.names.length ? (
        <View style={{gap: space.sm}}>
          <Text variant="label" tone="tertiary">{i18n.t('title.genres')}</Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
            {genres.names.map(name => <Button key={name} size="sm" variant="secondary" label={name} onPress={() => genres.onPress(name)} />)}
          </View>
        </View>
      ) : null}
      {files?.length ? (
        <View style={{gap: space.sm}}>
          <Text variant="label" tone="tertiary">{i18n.t('title.files')}</Text>
          {files.map((file, index) => {
            const lines = titleFileLines(file, (id, values) => i18n.t(id, values), name);
            const body = [
              lines.facts.join(' · '),
              ...lines.audio.map((line, i) => (i === 0 ? `${i18n.t('mediaInfo.audio')}: ${line}` : line)),
              ...lines.subtitles.map((line, i) => (i === 0 ? `${i18n.t('mediaInfo.subtitles')}: ${line}` : line)),
              lines.path ? `${i18n.t('mediaInfo.location')}: ${lines.path}` : '',
              lines.available ? '' : i18n.t('mediaInfo.unavailable'),
            ].filter(Boolean).join('\n');
            return (
              <Surface key={file.id} padded={false}>
                <ListRow icon="film" title={[headings[index]?.part ? i18n.t('mediaInfo.part', {number: headings[index]!.part!}) : '', headings[index]?.version ? i18n.t('mediaInfo.version', {number: headings[index]!.version!}) : '', lines.summary, headings[index]?.edition ?? ''].filter(Boolean).join(' · ')} subtitle={body} subtitleLines={12} readable={isTV} />
              </Surface>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
