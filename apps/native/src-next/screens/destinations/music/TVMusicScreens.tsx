import React, {useCallback, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, type View as NativeView} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {cardText} from '../../../../../../packages/client-core/src/presentation/kit-model';
import {artistReleaseGroups} from '../../../../../../packages/client-core/src/presentation/library-tabs';
import {AmbientArt, Artwork, ArtistCircle} from '../../../kit/artwork';
import {Button, Chip} from '../../../kit/controls';
import {SquareCard} from '../../../kit/cards';
import {TrackRow, type TrackRowData, type TrackSelection} from '../../../kit/browse';
import {browseType} from '../../../kit/browse/presentation';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeEntryActions} from '../entry-actions';
import type {NativeTVMusicController, MusicAlbumRow} from './model';
import {MusicErrorView} from './MusicErrorView';
import {MusicFormatBadges} from './MusicFormatBadges';

type Actions = Pick<NativeEntryActions, 'menu' | 'isMenuOpen'>;
type DetailRow = Readonly<{id: string; label: string; value: string}>;
const factLine = (text: string) => Object.freeze([{id: 'caption', text, role: 'value' as const}]);
const noSelection: TrackSelection = {active: false, isSelected: () => false, onToggle: () => {}, onEnter: () => {}, renderControl: () => null};
const t = defaultI18n.t;

function DetailRows({rows, testID}: {rows: readonly DetailRow[]; testID?: string}) {
  const theme = useTheme();
  return <View testID={testID} style={{width: 900, marginTop: 16}}>
    {rows.map((row, index) => <View key={row.id} style={{flexDirection: 'row', alignItems: 'baseline', gap: 24, paddingVertical: 14,
      borderTopWidth: index ? 1 : 0, borderColor: theme.colors.line}}>
      <Text style={[browseType(theme, 22, 600), {width: 220, color: theme.colors.textTertiary}]}>{row.label}</Text>
      <Text style={[browseType(theme, 22, 400), {flex: 1, color: theme.colors.text}]}>{row.value}</Text>
    </View>)}
  </View>;
}

function usePlayback(runtime: NativeShellRuntime) {
  const adapter = runtime.playback;
  const snapshot = useSyncExternalStore(adapter?.subscribe ?? (() => () => {}), adapter?.getSnapshot ?? (() => undefined));
  return snapshot;
}

function Backdrop({runtime, path, accent}: {runtime: NativeShellRuntime; path: string | undefined; accent?: boolean}) {
  const source = runtime.ambient(path);
  return <View pointerEvents="none" style={{position: 'absolute', inset: 0, backgroundColor: '#071018', overflow: 'hidden'}}>
    {source ? <AmbientArt source={source} treatment="title" style={{position: 'absolute', inset: 0}}/> : null}
    <View style={{position: 'absolute', inset: 0, backgroundColor: accent ? 'rgba(7,16,24,.42)' : 'rgba(7,16,24,.58)'}}/>
    <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 520, backgroundColor: 'rgba(7,16,24,.5)'}}/>
  </View>;
}

function SectionHeading({title, detail, left, top, width}: {title: string; detail?: string; left?: number; top?: number; width?: number}) {
  const theme = useTheme();
  return <View style={{position: top === undefined ? 'relative' : 'absolute', left: top === undefined ? undefined : left, top: top === undefined ? undefined : top, width,
    flexDirection: 'row', alignItems: 'baseline', gap: 16, zIndex: 2}}>
    <Text style={[browseType(theme, 32, 700, -.019), {color: theme.colors.text}]}>{title}</Text>
    {detail ? <Text style={[browseType(theme, 22, 600), {color: theme.colors.textTertiary}]}>{detail}</Text> : null}
  </View>;
}

function ActionBar({controller, entry, runtime, actions, focusId, style, onPlaylist}: {controller: NativeTVMusicController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions; focusId: string; style: React.ComponentProps<typeof View>['style']; onPlaylist?: () => void}) {
  const theme = useTheme(), play = useRef<NativeView>(null), more = useRef<NativeView>(null);
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const run = (work: Promise<unknown>) => { void work.catch(runtime.reportError); };
  const label = entry.kind === 'album' ? t('music.playAlbum', {album: entry.title}) : t('music.playArtist', {artist: entry.title});
  const shuffleLabel = entry.kind === 'album' ? t('title.shuffle') : t('music.shuffleArtist', {artist: entry.title});
  return <View style={[{flexDirection: 'row', alignItems: 'center', gap: 18, zIndex: 3}, style]}>
    <Button ref={play} testID={`music-play-${encodeURIComponent(entry.id)}`} focusId={focusId} hasTVPreferredFocus variant="primary" icon="i-play" onPress={() => run(controller.play())} accessibilityLabel={label}>{t('entry.play')}</Button>
    <Button testID={`music-shuffle-${encodeURIComponent(entry.id)}`} variant="glass" icon="i-shuffle" onPress={() => run(controller.play(undefined, true))} accessibilityLabel={shuffleLabel}>{t('title.shuffle')}</Button>
    <Button testID={`music-favorite-${encodeURIComponent(entry.id)}`} variant="glass" iconOnly icon={snapshot.favorite ? 'i-heart-f' : 'i-heart'} accessibilityLabel={t(snapshot.favorite ? 'entry.removeFromFavorites' : 'entry.addToFavorites')}
      accessibilityState={{checked: snapshot.favorite}} onPress={() => run(controller.toggleFavorite())}/>
    {onPlaylist && <Button testID={`music-playlist-${encodeURIComponent(entry.id)}`} variant="glass" iconOnly icon="i-listplus" accessibilityLabel={t('entry.addToPlaylist')} onPress={onPlaylist}/>}
    <Button ref={more} testID={`music-more-${encodeURIComponent(entry.id)}`} variant="glass" iconOnly icon="i-more" accessibilityLabel={t('card.more', {title: entry.title})}
      accessibilityState={{expanded: actions.isMenuOpen(entry)}} onPress={() => actions.menu(entry, more)}/>
  </View>;
}

function songRow(entry: ContentEntry, index: number, runtime: NativeShellRuntime, playingId: string | undefined): TrackRowData {
  const text = cardText({id: entry.id, kind: 'song', title: entry.displayTitle ?? entry.title, artist: entry.artist?.name, album: entry.album?.name, durationSeconds: entry.duration}, 'song-row', runtime.text);
  const artwork = runtime.artwork(entry.posterUrl);
  return Object.freeze({id: entry.id, text, number: entry.trackNumber ?? index + 1, playing: playingId === entry.id,
    // tv-more6 draws a filled heart on the row of a song this viewer favorited.
    ...(entry.favorite === true ? {favorite: true} : {}),
    artwork: artwork ? <Artwork source={artwork} width={56} height={56} style={{borderRadius: 8, overflow: 'hidden'}}/> : undefined});
}

function TrackList({songs, runtime, controller, actions, playingId, variant, style}: {songs: readonly ContentEntry[]; runtime: NativeShellRuntime; controller: NativeTVMusicController; actions: Actions; playingId?: string; variant: 'album' | 'top-songs'; style?: React.ComponentProps<typeof View>['style']}) {
  const run = (work: Promise<unknown>) => { void work.catch(runtime.reportError); };
  return <View style={style}>
    {songs.map((song, index) => <TrackRow key={song.id} row={songRow(song, index, runtime, playingId)} variant={variant} selection={noSelection}
      onPlay={() => run(controller.play(song.id))} onMore={() => actions.menu(song)}/>)}
  </View>;
}

function AlbumCard({album, runtime, actions, openEntry, width = 200, caption}: {album: MusicAlbumRow; runtime: NativeShellRuntime; actions: Actions; openEntry: (entry: ContentEntry) => void; width?: number; caption: string}) {
  const anchor = useRef<NativeView>(null);
  const artwork = runtime.artwork(album.posterUrl);
  const entry: ContentEntry = useMemo(() => Object.freeze({id: album.id, libraryId: album.libraryId, kind: 'album', title: album.title,
    ...(album.artist ? {artist: album.artist} : {}), ...(album.year ? {year: album.year} : {})}), [album]);
  return <SquareCard width={width} title={album.title} caption={factLine(caption)} artwork={artwork} menuAnchorRef={anchor}
    onNavigate={() => openEntry(entry)} onMore={() => actions.menu(entry, anchor)} moreExpanded={actions.isMenuOpen(entry)}/>;
}

/** tv-more6: the album page at ten feet. Header facts and track order are the server's; the queue is the album's own. */
export function TVAlbumScreen({controller, entry, runtime, actions, openEntry, onPlaylist}: {controller: NativeTVMusicController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions; openEntry: (entry: ContentEntry) => void; onPlaylist?: () => void}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot), playback = usePlayback(runtime), theme = useTheme();
  const playingId = playback?.playback.itemId;
  const art = runtime.artwork(entry.posterUrl);
  const minutes = snapshot.songDurationSeconds === undefined ? undefined : Math.max(1, Math.round(snapshot.songDurationSeconds / 60));
  const facts = [entry.artist?.name, entry.year === undefined ? undefined : defaultI18n.number(entry.year, {useGrouping: false}),
    snapshot.songTotal === undefined ? undefined : minutes === undefined ? t('title.songCount', {count: snapshot.songTotal})
      : t('music.songCountAndDuration', {songs: snapshot.songTotal, minutes})].filter((value): value is string => !!value);
  // tv-more6: a multi-disc album draws a Disc chip row above the list; the chips are the album's
  // own discs, and the list shows the chosen one. A single-disc album draws no row.
  const discs = useMemo(() => [...new Set(snapshot.songs.flatMap(song => song.discNumber === undefined ? [] : [song.discNumber]))].sort((left, right) => left - right), [snapshot.songs]);
  const [disc, setDisc] = useState<number>();
  const chosen = disc !== undefined && discs.includes(disc) ? disc : discs[0];
  const songs = discs.length > 1 ? snapshot.songs.filter(song => (song.discNumber ?? discs[0]) === chosen) : snapshot.songs;
  return <View testID="native-tv-album" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <Backdrop runtime={runtime} path={entry.posterUrl ?? entry.backdropUrl}/>
    <ScrollView contentContainerStyle={{paddingBottom: 64}} showsVerticalScrollIndicator={false}>
      <View style={{width: 1920, height: 1320}}>
        <View style={{position: 'absolute', left: 200, top: 150, width: 480, height: 480, borderRadius: 18, overflow: 'hidden', backgroundColor: theme.colors.raised, zIndex: 2}}>
          {art ? <Artwork source={art} width={480} height={480} priority/> : null}
        </View>
        <Text style={[browseType(theme, 22, 700), {position: 'absolute', left: 760, top: 150, color: theme.colors.textSecondary, zIndex: 2}]}>{t('search.kind.album')}</Text>
        <Text numberOfLines={2} style={[browseType(theme, 120, 800, -.045, 117.6), {position: 'absolute', left: 760, top: 186, width: 1000, color: theme.colors.text, zIndex: 2}]}>{entry.displayTitle ?? entry.title}</Text>
        <View style={{position: 'absolute', left: 760, top: 336, maxWidth: 1000, flexDirection: 'row', alignItems: 'center', gap: 26, zIndex: 2}}>
          {facts.map((fact, index) => <Text key={`${fact}-${index}`} numberOfLines={1} style={[browseType(theme, 24, index === 0 ? 700 : 400), {flexShrink: index === 0 ? 1 : 0, color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
          <MusicFormatBadges badges={snapshot.albumDetails?.badges} size="tv"/>
        </View>
        <ActionBar controller={controller} entry={entry} runtime={runtime} actions={actions} focusId={`music-play-${entry.id}`} onPlaylist={onPlaylist} style={{position: 'absolute', left: 760, top: 410}}/>
        {snapshot.phase === 'error' && <MusicErrorView error={snapshot.error} onRetry={() => {void controller.load();}} style={{position: 'absolute', left: 760, top: 520, width: 1000, zIndex: 3}}/>}
        <View style={{position: 'absolute', left: 724, top: 520, width: 1118, zIndex: 2}}>
          {discs.length > 1 && <View style={{flexDirection: 'row', gap: 14, marginBottom: 14}}>{discs.map(value => <Chip key={value} focusId={`music-disc-${value}`} selected={chosen === value}
            accessibilityRole="radio" accessibilityState={{checked: chosen === value}} onPress={() => setDisc(value)}>{t('title.disc', {number: defaultI18n.number(value, {useGrouping: false})})}</Chip>)}</View>}
          <TrackList songs={songs} runtime={runtime} controller={controller} actions={actions} playingId={playingId} variant="album"/>
        </View>
        <SectionHeading title={t('music.moreLikeThis')} detail={t('music.moreLikeThisHint')} left={200} top={896}/>
        <View style={{position: 'absolute', left: 200, top: 954, flexDirection: 'row', gap: 32, zIndex: 2}}>
          {snapshot.similar.filter(value => value.kind === 'album').slice(0, 7).map(value => <SquareCard key={value.id} width={200} title={value.displayTitle ?? value.title}
            caption={factLine(value.artist?.name ?? '')} artwork={runtime.artwork(value.posterUrl)} onNavigate={() => openEntry(value)} onMore={() => actions.menu(value)} moreExpanded={actions.isMenuOpen(value)}/>)}
        </View>
      </View>
    </ScrollView>
  </View>;
}

/** tv-more8/9: the artist page, its circle cut from up to four covers, and the server's release lists. */
export function TVArtistScreen({controller, entry, runtime, actions, openEntry}: {controller: NativeTVMusicController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions; openEntry: (entry: ContentEntry) => void}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot), playback = usePlayback(runtime), theme = useTheme();
  const playingId = playback?.playback.itemId;
  const covers = snapshot.albums.flatMap(album => {const source = runtime.artwork(album.posterUrl); return source ? [source] : [];});
  const artist = snapshot.artistDetails ?? entry;
  const years = artist.activeBeginYear === undefined ? undefined : artist.activeEndYear !== undefined ? `${artist.activeBeginYear}–${artist.activeEndYear}` : t('title.activeSince', {year: artist.activeBeginYear});
  const facts = [artist.genres?.[0] ?? entry.genres?.[0], artist.country, years,
    snapshot.albums.length || snapshot.songTotal ? t('music.onServer', {albums: snapshot.albums.length, songs: snapshot.songTotal ?? 0}) : undefined].filter((value): value is string => !!value);
  const releases = artistReleaseGroups(snapshot.albums);
  const albums = releases.find(group => group.id === 'albums')?.entries ?? [];
  const otherReleases = releases.filter(group => group.id !== 'albums');
  const allSongs = snapshot.allSongs;
  const detailFacts: readonly DetailRow[] = [
    ...(artist.country ? [{id: 'country', label: t('title.country'), value: artist.country}] : []),
    ...(years ? [{id: 'activeYears', label: t('title.activeYears'), value: years}] : []),
    {id: 'type', label: t('title.albumType'), value: artist.artistType ?? t('title.kind', {kind: 'artist'})},
  ];
  return <View testID="native-tv-artist" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <Backdrop runtime={runtime} path={snapshot.albums[0]?.posterUrl ?? entry.posterUrl ?? entry.backdropUrl}/>
    <ScrollView contentContainerStyle={{paddingBottom: 64}} showsVerticalScrollIndicator={false}>
      <View style={{width: 1920, height: 1040}}>
        <View style={{position: 'absolute', left: 1280, top: 150, zIndex: 2}}>
          <ArtistCircle covers={covers} rings={[40, 80]} initials={[...entry.title.trim()][0] ?? ''} alt={entry.title} size={360} visible/>
        </View>
        <Text style={[browseType(theme, 22, 700), {position: 'absolute', left: 200, top: 170, color: theme.colors.textSecondary, zIndex: 2}]}>{t('search.kind.artist')}</Text>
        <Text numberOfLines={2} style={[browseType(theme, 120, 800, -.045, 117.6), {position: 'absolute', left: 200, top: 206, width: 1000, color: theme.colors.text, zIndex: 2}]}>{entry.title}</Text>
        <View style={{position: 'absolute', left: 200, top: 352, flexDirection: 'row', alignItems: 'center', gap: 26, flexWrap: 'wrap', width: 940, zIndex: 2}}>
          {facts.map((fact, index) => <Text key={`${fact}-${index}`} style={[browseType(theme, 24, index === 0 ? 700 : 400), {color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
        </View>
        <ActionBar controller={controller} entry={entry} runtime={runtime} actions={actions} focusId={`music-play-${entry.id}`} style={{position: 'absolute', left: 200, top: 420}}/>
        <SectionHeading title={t('music.topSongs')} left={200} top={612}/>
        <TrackList songs={snapshot.songs} runtime={runtime} controller={controller} actions={actions} playingId={playingId} variant="top-songs" style={{position: 'absolute', left: 182, top: 666, width: 900, zIndex: 2}}/>
        <SectionHeading title={t('music.albums')} left={1240} top={612}/>
        <View style={{position: 'absolute', left: 1240, top: 672, width: 584, flexDirection: 'row', flexWrap: 'wrap', gap: 32, zIndex: 2}}>
          {albums.map(album => <AlbumCard key={album.id} album={album} runtime={runtime} actions={actions} openEntry={openEntry} width={240} caption={album.year === undefined ? '' : defaultI18n.number(album.year, {useGrouping: false})}/>)}
        </View>
      </View>
      <View style={{width: 1624, marginLeft: 200, paddingTop: 40, gap: 34}}>
        {otherReleases.map(group => <View key={group.id}>
          <SectionHeading title={t(group.label)}/>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 32, marginTop: 18}}>
            {group.entries.map(album => <AlbumCard key={album.id} album={album} runtime={runtime} actions={actions} openEntry={openEntry} width={240} caption={album.year === undefined ? '' : defaultI18n.number(album.year, {useGrouping: false})}/>)}
          </View>
        </View>)}
        <View>
          <SectionHeading title={t('music.similarArtists')}/>
          <View style={{flexDirection: 'row', gap: 40, marginTop: 24}}>
            {snapshot.similar.filter(value => value.kind === 'artist').slice(0, 8).map(value => {
              const albumCovers = (value.artworkPaths ?? []).flatMap(path => {const source = runtime.artwork(path); return source ? [source] : [];});
              return <View key={value.id} style={{width: 200, alignItems: 'center', gap: 12}}>
                <ArtistCircle covers={albumCovers} initials={[...value.title.trim()][0] ?? ''} alt={value.title} size={200} visible/>
                <Text numberOfLines={1} style={[browseType(theme, 22, 700), {color: theme.colors.text, textAlign: 'center'}]}>{value.displayTitle ?? value.title}</Text>
              </View>;
            })}
          </View>
        </View>
        <View>
          <SectionHeading title={t('title.details')}/>
          <DetailRows rows={detailFacts} testID={`music-artist-details-${encodeURIComponent(entry.id)}`}/>
          {artist.overview ? <View style={{marginTop: 22, width: 900}}>
            <Text style={[browseType(theme, 22, 400, 0), {color: theme.colors.textSecondary, lineHeight: 34}]}>{artist.overview}</Text>
            {artist.overviewSource ? <Text style={[browseType(theme, 19, 500), {color: theme.colors.textTertiary, marginTop: 8}]}>{t('title.fromSource', {source: artist.overviewSource})}</Text> : null}
          </View> : null}
          <View style={{marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 20}}>
            {allSongs.phase === 'ready'
              ? <SectionHeading title={t('music.allSongs')} detail={allSongs.total === undefined ? undefined : t('title.songCount', {count: allSongs.total})}/>
              : <Button variant="text" icon="i-music" disabled={allSongs.phase === 'loading'} onPress={() => {void controller.loadAllSongs();}}
                accessibilityLabel={t('music.allSongs')}>{t('music.allSongs')}</Button>}
          </View>
          {allSongs.phase === 'loading' && <Text style={[browseType(theme, 22, 600), {color: theme.colors.textSecondary, marginTop: 14}]}>{t('music.loading')}</Text>}
          {allSongs.phase === 'error' && <MusicErrorView error={allSongs.error} onRetry={() => {void controller.loadAllSongs();}} style={{marginTop: 16, width: 900}}/>}
          {allSongs.phase === 'ready' && <TrackList songs={allSongs.songs} runtime={runtime} controller={controller} actions={actions} playingId={playingId} variant="top-songs" style={{marginTop: 12, width: 1118}}/>}
        </View>
      </View>
    </ScrollView>
  </View>;
}
