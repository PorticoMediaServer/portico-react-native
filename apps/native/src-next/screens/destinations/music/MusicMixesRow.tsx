import React, {useEffect, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {ScrollView, StyleSheet, Text, View} from 'react-native';
import Svg, {Defs, RadialGradient, Rect, Stop} from 'react-native-svg';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Artwork} from '../../../kit/artwork';
import {Focusable} from '../../../kit/controls';
import {useTheme} from '../../../kit/theme';
import {browseType} from '../../../kit/browse/presentation';
import type {NativeMusicMixRow, NativeMusicMixesCaller, NativeMusicMixesPort} from './mixes';

const t = defaultI18n.t;
/** music-plus 15: three covers fanned at the top right, each a little smaller than the card's
 * half, with the mix's own style set large inside the cover and its name below. */
const fanAngles = [-12, -1, 11] as const, fanLefts = [0, .22, .44] as const, fanTops = [.1, 0, .08] as const;

export function MusicMixCard({row, artwork, width = 186, onPlay}: {
  row: NativeMusicMixRow; artwork: (path: string | undefined) => React.ComponentProps<typeof Artwork>['source']; width?: number; onPlay: () => void;
}) {
  const theme = useTheme(), tv = theme.isTV, phone = theme.platform === 'phone';
  const radius = tv ? 14 : 12, fanWidth = width * .62, fanHeight = width * .52, cover = fanWidth * .56;
  const styleSize = tv ? 32 : phone ? 18 : 26, nameSize = tv ? 22 : phone ? 12.5 : 13.5;
  const at = tv ? {left: 18, right: 18, bottom: 16} : phone ? {left: 10, right: 10, bottom: 9} : {left: 14, right: 14, bottom: 12};
  const gradient = `mix${row.id.replace(/[^a-zA-Z0-9]/g, '')}`;
  const artists = defaultI18n.list([...row.artists.map(artist => artist.name), ...(row.more ? [t('next.watch.andMore', {count: 1})] : [])], 'and');
  return <Focusable focusId={`music-mix:${row.id}`} testID={`music-mix:${row.id}`} focusKind="card" focusRadius={radius}
    accessibilityRole="button" accessibilityLabel={t('music.mix.name', {name: row.name})} onPress={onPlay} style={{width, marginRight: tv ? 28 : 14}}>
    <View style={{width, height: width, borderRadius: radius, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      <Svg width={width} height={width} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs><RadialGradient id={gradient} cx="100%" cy="0%" rx="130%" ry="120%"><Stop offset="0" stopColor={row.tint}/><Stop offset=".72" stopColor={row.tint} stopOpacity={0}/></RadialGradient></Defs>
        <Rect width="100%" height="100%" fill={`url(#${gradient})`}/>
      </Svg>
      <View pointerEvents="none" style={{position: 'absolute', right: 12, top: 14, width: fanWidth, height: fanHeight}}>
        {row.covers.slice(0, 3).map((coverAt, index) => {
          const source = artwork(coverAt.posterUrl);
          if (!source) return null;
          return <View key={coverAt.id} style={{position: 'absolute', left: fanWidth * fanLefts[index]!, top: fanHeight * fanTops[index]!, width: cover, height: cover,
            borderRadius: 6, overflow: 'hidden', zIndex: index, borderWidth: 1, borderColor: 'rgba(237,245,250,.16)',
            transform: [{rotate: `${fanAngles[index]}deg`}], shadowColor: theme.colors.shadow, shadowOpacity: .85, shadowRadius: 22, shadowOffset: {width: 0, height: 12}}}>
            <Artwork source={source} width={cover} height={cover}/>
          </View>;
        })}
      </View>
      <Text numberOfLines={2} style={[browseType(theme, styleSize, 800, -.035, styleSize), {position: 'absolute', left: at.left, right: at.right, bottom: at.bottom,
        color: theme.colors.white, textShadowColor: 'rgba(7,16,24,.6)', textShadowOffset: {width: 0, height: 2}, textShadowRadius: 18}]}>{row.name}</Text>
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, {borderRadius: radius, borderWidth: 1, borderColor: 'rgba(237,245,250,.08)'}]}/>
    </View>
    <Text numberOfLines={2} style={[browseType(theme, nameSize, 700), {marginTop: tv ? 14 : 8, color: theme.colors.textSecondary}]}>{t('music.mix.name', {name: row.name})}</Text>
    <Text numberOfLines={2} style={[browseType(theme, tv ? 20 : phone ? 11.5 : 12.5, 400, 0, (tv ? 20 : phone ? 11.5 : 12.5) * 1.35),
      {marginTop: 3, minHeight: (tv ? 20 : phone ? 11.5 : 12.5) * 1.35 * 2, color: theme.colors.textTertiary}]}>{artists}</Text>
  </Focusable>;
}

/** Mixes for you: the server's own profile row, absent until it has something real to draw. */
export function MusicMixesRow({port, artwork, reportError, title = t('music.mixesForYou'), onOpen, marginHorizontal, active = true}: {
  port: NativeMusicMixesPort; artwork: (path: string | undefined) => React.ComponentProps<typeof Artwork>['source'];
  reportError: (error: unknown) => void; title?: string; onOpen?: () => void; marginHorizontal?: number; active?: boolean;
}) {
  const theme = useTheme(), snapshot = useSyncExternalStore(port.subscribe, port.getSnapshot);
  const revision = useSyncExternalStore(port.subscribeRevision, port.getRevision);
  const [caller, setCaller] = useState<NativeMusicMixesCaller | null>(null);
  // The row holds the route and revision that committed it. A push or Back renews the lease,
  // and while the route is not Home or Discover no lease exists, so a retained hidden card
  // can never borrow the new route's caller.
  useLayoutEffect(() => {
    const captured = active ? port.captureCaller() : undefined;
    setCaller(captured ?? null);
    return () => {captured?.dispose();};
  }, [port, revision, active]);
  useEffect(() => {if (snapshot.phase === 'idle') void port.load().catch(() => {});}, [port, snapshot.phase]);
  if (snapshot.phase !== 'ready' || !snapshot.rows.length) return null;
  const play = (row: NativeMusicMixRow) => {
    if (!caller) return;
    void port.play(row, caller.lifetime).catch(error => reportError(error));
  };
  const heading = theme.isTV ? theme.type.rowHeading : browseType(theme, 20, 800, -.02);
  return <View testID="music-mixes-row" style={{marginTop: theme.isTV ? 30 : theme.layoutMode === 'phone' ? 28 : 26}}>
    {onOpen ? <Focusable focusId="music-mixes-open" testID="music-mixes-open" accessibilityRole="button" accessibilityLabel={title} onPress={onOpen}
      style={{marginHorizontal: marginHorizontal ?? (theme.isTV ? 96 : 16), marginBottom: 12}}>
      <Text style={[heading, {color: theme.colors.text}]}>{title}</Text>
    </Focusable> : <Text style={[heading, {marginHorizontal: theme.isTV ? 96 : 16, marginBottom: 12, color: theme.colors.text}]}>{title}</Text>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{paddingHorizontal: marginHorizontal ?? (theme.isTV ? 96 : 16)}}>
      {snapshot.rows.map(row => <MusicMixCard key={row.id} row={row} artwork={artwork} width={theme.isTV ? 300 : theme.platform === 'tablet' ? 210 : 186} onPlay={() => play(row)}/>)}
    </ScrollView>
  </View>;
}
