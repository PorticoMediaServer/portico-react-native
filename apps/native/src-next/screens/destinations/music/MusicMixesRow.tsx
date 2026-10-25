import React, {useEffect, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Artwork} from '../../../kit/artwork';
import {Focusable} from '../../../kit/controls';
import {useTheme} from '../../../kit/theme';
import {browseType} from '../../../kit/browse/presentation';
import type {NativeMusicMixRow, NativeMusicMixesPort} from './mixes';

const t = defaultI18n.t;

/** music-plus 16/18: the drawn mix card — a tint from the first album, three covers fanned and
 * the name set large. Only the server's own covers and tint are used. */
export function MusicMixCard({row, artwork, width = 186, onPlay}: {
  row: NativeMusicMixRow; artwork: (path: string | undefined) => React.ComponentProps<typeof Artwork>['source']; width?: number; onPlay: () => void;
}) {
  const theme = useTheme();
  return <Focusable focusId={`music-mix:${row.id}`} testID={`music-mix:${row.id}`} focusKind="card" focusRadius={12}
    accessibilityRole="button" accessibilityLabel={row.name} onPress={onPlay} style={{width, marginRight: 14}}>
    <View style={{width, height: width, borderRadius: 12, overflow: 'hidden', backgroundColor: row.tint}}>
      {row.covers.slice(0, 3).map((cover, index) => {
        const source = artwork(cover.posterUrl);
        if (!source) return null;
        const shift = (index - 1) * Math.round(width * .17);
        return <View key={cover.id} style={{position: 'absolute', left: Math.round(width * .12) + shift, top: Math.round(width * .16) + Math.abs(index - 1) * 6,
          width: Math.round(width * .62), height: Math.round(width * .62), borderRadius: 8, overflow: 'hidden',
          transform: [{rotate: `${(index - 1) * 7}deg`}], shadowColor: theme.colors.shadow, shadowOpacity: .5, shadowRadius: 12, shadowOffset: {width: 0, height: 8}}}>
          <Artwork source={source} width="100%" height="100%"/>
        </View>;
      })}
      <View style={{position: 'absolute', left: 12, right: 12, bottom: 12}}>
        <Text numberOfLines={2} style={[browseType(theme, 20, 800, -.03), {color: theme.colors.white}]}>{row.name}</Text>
      </View>
    </View>
    <Text numberOfLines={2} style={[browseType(theme, 12.5, 500), {marginTop: 8, color: theme.colors.textSecondary}]}>
      {[...row.artists.map(artist => artist.name), ...(row.more ? [t('next.watch.andMore', {count: 1})] : [])].join(', ')}
    </Text>
  </Focusable>;
}

/** Mixes for you: the server's own profile row, absent until it has something real to draw. */
export function MusicMixesRow({port, artwork, reportError, title = t('music.mixesForYou')}: {
  port: NativeMusicMixesPort; artwork: (path: string | undefined) => React.ComponentProps<typeof Artwork>['source'];
  reportError: (error: unknown) => void; title?: string;
}) {
  const theme = useTheme(), snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot);
  useEffect(() => {if (snapshot.phase === 'idle') void port.load().catch(() => {});}, [port, snapshot.phase]);
  if (snapshot.phase !== 'ready' || !snapshot.rows.length) return null;
  const play = (row: NativeMusicMixRow) => {void port.play(row).catch(error => reportError(error));};
  return <View testID="music-mixes-row" style={{marginTop: theme.isTV ? 30 : theme.layoutMode === 'phone' ? 28 : 26}}>
    <Text style={[browseType(theme, 20, 800, -.02), {marginHorizontal: theme.isTV ? 96 : 16, marginBottom: 12, color: theme.colors.text}]}>{title}</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: theme.isTV ? 96 : 16}}>
      {snapshot.rows.map(row => <MusicMixCard key={row.id} row={row} artwork={artwork} width={theme.isTV ? 300 : theme.platform === 'tablet' ? 210 : 186} onPlay={() => play(row)}/>)}
    </ScrollView>
  </View>;
}
