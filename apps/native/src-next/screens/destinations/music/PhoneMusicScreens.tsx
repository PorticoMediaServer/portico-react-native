import React, {useRef, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, type View as NativeView} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {cardText} from '../../../../../../packages/client-core/src/presentation/kit-model';
import {AmbientArt, Artwork, ArtistCircle} from '../../../kit/artwork';
import {Button, Focusable} from '../../../kit/controls';
import {SquareCard} from '../../../kit/cards';
import {Icon} from '../../../kit/Icon';
import {alpha, browseType} from '../../../kit/browse/presentation';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeEntryActions} from '../entry-actions';
import type {NativeTVMusicController, MusicAlbumRow} from './model';
import {MusicErrorView} from './MusicErrorView';
import {MusicFormatBadges} from './MusicFormatBadges';

const t = defaultI18n.t;
type Actions = Pick<NativeEntryActions, 'menu'>;

/** phone-app#13 and #15b, in pt. The two drawn phone music pages: an album with
 * its own tracks, and an artist with Top songs and its release list. */
export const phoneMusicGeometry = Object.freeze({
  albumTop: 104, albumCover: 232, albumCoverRadius: 12, albumTitle: 30, albumArtist: 16,
  meta: 13, actionHeight: 46, actionRadius: 10, actionGap: 10,
  trackHeight: 54, trackPaddingLeft: 20, trackPaddingRight: 12, trackGap: 14, trackNumberWidth: 18,
  trackTitle: 15.5, trackNumber: 14, trackDuration: 13.5, trackMoreWidth: 34,
  artistTop: 98, artistCircle: 164, artistTitle: 30, sectionLabel: 13.5, albumCard: 132,
});

function usePlayback(runtime: NativeShellRuntime) {
  const adapter = runtime.playback;
  return useSyncExternalStore(adapter?.subscribe ?? (() => () => {}), adapter?.getSnapshot ?? (() => undefined));
}

/** The floating back/More header the phone music frames draw over the wash. */
function PhoneHeader({title, onBack, onMore, moreRef}: {title: string; onBack: () => void; onMore: () => void; moreRef: React.RefObject<NativeView | null>}) {
  const theme = useTheme(), insets = useSafeAreaInsets();
  return <View style={{position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: insets.top, height: 50 + insets.top, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center'}}>
    <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack} style={{height: 44, width: 44}}/>
    <View style={{flex: 1}}/>
    <Button ref={moreRef} variant="icon" icon="i-more" iconOnly accessibilityLabel={t('card.more', {title})} onPress={onMore} style={{height: 44, width: 44}}/>
  </View>;
}

/** The cover's colours spread behind the page and fade down (phone-app#13 .amb-l). */
function Wash({runtime, path}: {runtime: NativeShellRuntime; path: string | undefined}) {
  const theme = useTheme(), source = runtime.ambient(path);
  return <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: 760, overflow: 'hidden'}}>
    <View style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}/>
    {source ? <AmbientArt source={source} treatment="title" style={{position: 'absolute', inset: 0}}/> : null}
    <View style={{position: 'absolute', inset: 0, backgroundColor: alpha(theme.colors.ink, .45)}}/>
    <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 320, backgroundColor: alpha(theme.colors.ink, .55)}}/>
  </View>;
}

/** The drawn meta line: the strong first fact, then quiet ones, centred. */
function Facts({facts, strongFirst = true}: {facts: readonly string[]; strongFirst?: boolean}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 12, rowGap: 6, marginTop: 8, paddingHorizontal: 20}}>
    {facts.map((fact, index) => <Text key={`${fact}-${index}`} style={[browseType(theme, phoneMusicGeometry.meta, strongFirst && index === 0 ? 700 : 400),
      {color: strongFirst && index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
  </View>;
}

/** Play and Shuffle are the drawn wide pair; the round slot carries the drawn More on an artist. */
function MusicActions({controller, entry, runtime, actions, moreRef, roundMore, download}: {
  controller: NativeTVMusicController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions; moreRef: React.RefObject<NativeView | null>; roundMore: boolean; download?: (entry: ContentEntry) => void;
}) {
  const theme = useTheme();
  const run = (work: Promise<unknown>) => {void work.catch(runtime.reportError);};
  const label = entry.kind === 'album' ? t('music.playAlbum', {album: entry.title}) : t('music.playArtist', {artist: entry.title});
  const shuffle = entry.kind === 'album' ? t('title.shuffle') : t('music.shuffleArtist', {artist: entry.title});
  const action = {height: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius, paddingHorizontal: 20, gap: 8};
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: phoneMusicGeometry.actionGap}}>
    <Button style={[action, {flex: 1}]} icon="i-play" textStyle={browseType(theme, 15, 700)} accessibilityLabel={label} onPress={() => run(controller.play())}>{t('entry.play')}</Button>
    <Button variant="glass" style={[action, {flex: 1}]} icon="i-shuffle" textStyle={browseType(theme, 15, 700)} accessibilityLabel={shuffle} onPress={() => run(controller.play(undefined, true))}>{t('title.shuffle')}</Button>
    {download ? <Button variant="glass" iconOnly icon="i-dl" style={{height: phoneMusicGeometry.actionHeight, width: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius}}
      accessibilityLabel={t('next.cards.download')} onPress={() => download(entry)}/> : roundMore ? <Button ref={moreRef} variant="glass" iconOnly icon="i-more" style={{height: phoneMusicGeometry.actionHeight, width: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius}}
      accessibilityLabel={t('card.more', {title: entry.title})} onPress={() => actions.menu(entry, moreRef)}/> : null}
  </View>;
}

/** A still three-bar mark, the same drawn playing state the kit rows use. */
function LevelBars() {
  const theme = useTheme();
  return <View accessible={false} style={{height: 14, width: 18, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 2}}>
    {[8, 14, 10].map((height, index) => <View key={index} style={{height, width: 3, borderRadius: 1, backgroundColor: theme.colors.accentStrong}}/>)}
  </View>;
}

/** One drawn album track: number (or the playing mark), title, duration, More. */
function SongLine({song, index, runtime, controller, actions, playingId}: {
  song: ContentEntry; index: number; runtime: NativeShellRuntime; controller: NativeTVMusicController; actions: Actions; playingId?: string;
}) {
  const theme = useTheme();
  const title = song.displayTitle ?? song.title;
  const model = cardText({id: song.id, kind: 'song', title, artist: song.artist?.name, album: song.album?.name, durationSeconds: song.duration}, 'song-row', runtime.text);
  const duration = model.detail.find(part => part.id === 'duration')?.text;
  const playing = playingId === song.id;
  return <Focusable accessibilityRole="button" accessibilityLabel={t('next.browse.native.play', {title})} focusKind="row" focusRadius={10}
    onPress={() => {void controller.play(song.id).catch(runtime.reportError);}} style={{height: phoneMusicGeometry.trackHeight, paddingLeft: phoneMusicGeometry.trackPaddingLeft,
      paddingRight: phoneMusicGeometry.trackPaddingRight, flexDirection: 'row', alignItems: 'center', gap: phoneMusicGeometry.trackGap}}>
    <View style={{width: phoneMusicGeometry.trackNumberWidth, alignItems: 'center'}}>{playing ? <LevelBars/> : <Text style={[browseType(theme, phoneMusicGeometry.trackNumber, 600), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{song.trackNumber ?? index + 1}</Text>}</View>
    <Text numberOfLines={1} style={[browseType(theme, phoneMusicGeometry.trackTitle, 600, 0), {flex: 1, color: playing ? theme.colors.accentStrong : theme.colors.text}]}>{title}</Text>
    {duration ? <Text style={[browseType(theme, phoneMusicGeometry.trackDuration, 400), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{duration}</Text> : null}
    <Focusable accessibilityRole="button" accessibilityLabel={t('next.browse.native.moreFor', {title})} onPress={() => actions.menu(song)} focusRadius={17}
      style={{width: phoneMusicGeometry.trackMoreWidth, height: phoneMusicGeometry.trackMoreWidth, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-more" size={20} color={theme.colors.textTertiary}/></Focusable>
  </Focusable>;
}

function SongLines({songs, runtime, controller, actions, playingId}: {songs: readonly ContentEntry[]; runtime: NativeShellRuntime; controller: NativeTVMusicController; actions: Actions; playingId?: string}) {
  return <View>{songs.map((song, index) => <SongLine key={song.id} song={song} index={index} runtime={runtime} controller={controller} actions={actions} playingId={playingId}/>)}</View>;
}

function AlbumCard({album, runtime, actions, openEntry}: {album: MusicAlbumRow; runtime: NativeShellRuntime; actions: Actions; openEntry: (entry: ContentEntry) => void}) {
  const entry: ContentEntry = {id: album.id, libraryId: album.libraryId, kind: 'album', title: album.title, ...(album.artist ? {artist: album.artist} : {}), ...(album.year ? {year: album.year} : {})};
  return <SquareCard width={phoneMusicGeometry.albumCard} title={album.title} caption={Object.freeze([{id: 'caption', text: album.year === undefined ? '' : defaultI18n.number(album.year, {useGrouping: false}), role: 'value' as const}])}
    artwork={runtime.artwork(album.posterUrl)} onNavigate={() => openEntry(entry)} onMore={() => actions.menu(entry)}/>;
}

/** phone-app#13: the album body. The canonical controller owns the server lists;
 * this file only draws them at phone size. */
export function PhoneAlbumScreen({controller, entry, runtime, actions, openEntry, onBack, download, onPlaylist}: {
  controller: NativeTVMusicController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions; openEntry: (entry: ContentEntry) => void; onBack: () => void; download?: (entry: ContentEntry) => void; onPlaylist?: () => void;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot), playback = usePlayback(runtime);
  const art = runtime.artwork(entry.posterUrl), more = useRef<NativeView>(null);
  const minutes = snapshot.songDurationSeconds === undefined ? undefined : Math.max(1, Math.round(snapshot.songDurationSeconds / 60));
  const facts = [
    entry.year === undefined ? undefined : defaultI18n.number(entry.year, {useGrouping: false}),
    entry.genres?.[0],
    snapshot.songTotal === undefined ? undefined : minutes === undefined ? t('title.songCount', {count: snapshot.songTotal})
      : t('music.songCountAndDuration', {songs: snapshot.songTotal, minutes}),
  ].filter((value): value is string => !!value);
  const title = entry.displayTitle ?? entry.title, tablet = theme.platform !== 'phone';
  if (tablet) {
    const date = (value: string | undefined) => value ? new Intl.DateTimeFormat(runtime.text.locale ?? 'en-US', {dateStyle: 'medium'}).format(new Date(value)) : undefined;
    const details = [[t('title.year'), entry.year === undefined ? undefined : defaultI18n.number(entry.year, {useGrouping: false})],
      [t('title.releaseDate'), date(entry.releaseDate)], [t('title.label'), entry.label], [t('title.albumType'), entry.albumType],
      [t('title.genres'), entry.genres?.join(', ')], [t('title.added'), date(entry.addedAt ?? undefined)]].filter(([, value]) => !!value) as [string, string][];
    const round = {height: phoneMusicGeometry.actionHeight, width: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius};
    return <View testID="native-tablet-album" style={{flex: 1, backgroundColor: theme.colors.ink}}>
      <Wash runtime={runtime} path={entry.posterUrl ?? entry.backdropUrl}/>
      <ScrollView contentContainerStyle={{paddingTop: 56, paddingBottom: 100}} showsVerticalScrollIndicator={false}>
        <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 40, paddingHorizontal: 32}}>
          <View style={{width: 300, height: 300, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.raised, shadowColor: theme.colors.shadow, shadowOffset: {width: 0, height: 30}, shadowOpacity: .9, shadowRadius: 30}}>
            {art ? <Artwork source={art} width={300} height={300} priority/> : null}
          </View>
          <View style={{flex: 1, minWidth: 0}}>
            <Text style={[browseType(theme, 15, 600), {color: theme.colors.textSecondary, marginBottom: 10}]}>{t('next.browse.native.album')}</Text>
            <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, 58, 800, -.04, 61), {color: theme.colors.text}]}>{title}</Text>
            {entry.artist?.name ? <Text numberOfLines={1} style={[browseType(theme, 16, 700), {color: theme.colors.accentStrong, marginTop: 4}]}>{entry.artist.name}</Text> : null}
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap'}}>
              {facts.length ? <Facts facts={facts}/> : null}
              <MusicFormatBadges badges={snapshot.albumDetails?.badges} size="tablet"/>
            </View>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20}}>
              <Button style={{height: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius, paddingHorizontal: 24}} icon="i-play" textStyle={browseType(theme, 15, 700)} onPress={() => {void controller.play().catch(runtime.reportError);}}>{t('entry.play')}</Button>
              <Button variant="glass" style={{height: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius, paddingHorizontal: 24}} icon="i-shuffle" textStyle={browseType(theme, 15, 700)} onPress={() => {void controller.play(undefined, true).catch(runtime.reportError);}}>{t('title.shuffle')}</Button>
              <Button variant="glass" iconOnly icon={snapshot.favorite ? 'i-heart-f' : 'i-heart'} style={round} accessibilityLabel={t(snapshot.favorite ? 'next.browse.native.unfavorite' : 'next.browse.native.favorite')} onPress={() => {void controller.toggleFavorite().catch(runtime.reportError);}}/>
              {onPlaylist ? <Button variant="glass" iconOnly icon="i-list-plus" style={round} accessibilityLabel={t('next.selection.addToPlaylist')} onPress={onPlaylist}/> : null}
              <Button ref={more} variant="glass" iconOnly icon="i-more" style={round} accessibilityLabel={t('card.more', {title})} onPress={() => actions.menu(entry, more)}/>
            </View>
          </View>
        </View>
        <View style={{flexDirection: 'row', gap: 40, paddingHorizontal: 32, marginTop: 34}}>
          <View style={{flex: 1, minWidth: 0}}>
            <View style={{flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line}}>
              <Text style={[browseType(theme, 11, 700), {width: 36, color: theme.colors.textTertiary}]}>#</Text>
              <Text style={[browseType(theme, 11, 700), {flex: 1, color: theme.colors.textTertiary}]}>{t('next.browse.native.title')}</Text>
              <Text style={[browseType(theme, 11, 700), {width: 62, textAlign: 'right', color: theme.colors.textTertiary}]}>{t('next.browse.native.plays')}</Text>
              <Text style={[browseType(theme, 11, 700), {width: 70, textAlign: 'right', color: theme.colors.textTertiary}]}>{t('next.browse.duration')}</Text>
              <View style={{width: 44}}/>
            </View>
            {snapshot.songs.map((song, index) => <TabletSongLine key={song.id} song={song} index={index} runtime={runtime} controller={controller} actions={actions} playingId={playback?.playback.itemId}/>)}
          </View>
          {details.length ? <View style={{width: 250}}>
            <Text style={[browseType(theme, 19, 700), {color: theme.colors.text, marginBottom: 8}]}>{t('title.details')}</Text>
            {details.map(([label, value]) => <View key={label} style={{flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line}}>
              <Text style={[browseType(theme, 13, 400), {width: 76, color: theme.colors.textTertiary}]}>{label}</Text><Text style={[browseType(theme, 13, 500), {flex: 1, color: theme.colors.text}]}>{value}</Text></View>)}
          </View> : null}
        </View>
        {snapshot.similar.length ? <View style={{marginTop: 30, paddingHorizontal: 32}}>
          <Text style={[browseType(theme, 19, 700), {color: theme.colors.text, marginBottom: 10}]}>{t('next.controls.moreLikeThis')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 14}}>
            {snapshot.similar.flatMap(value => {
              if (!value.libraryId) return [];
              const album: MusicAlbumRow = {id: value.id, libraryId: value.libraryId, title: value.title,
                ...(value.artist?.id && value.artist.name ? {artist: {id: value.artist.id, name: value.artist.name}} : {}),
                ...(value.year ? {year: value.year} : {}), ...(value.posterUrl ? {posterUrl: value.posterUrl} : {})};
              return [<AlbumCard key={value.id} album={album} runtime={runtime} actions={actions} openEntry={openEntry}/>];
            })}
          </ScrollView>
        </View> : null}
      </ScrollView>
    </View>;
  }
  return <View testID="native-phone-album" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <Wash runtime={runtime} path={entry.posterUrl ?? entry.backdropUrl}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(phoneMusicGeometry.albumTop, insets.top + 56), paddingBottom: 40}} showsVerticalScrollIndicator={false}>
      <View style={{alignItems: 'center', paddingHorizontal: 20}}>
        <View style={{width: phoneMusicGeometry.albumCover, height: phoneMusicGeometry.albumCover, borderRadius: phoneMusicGeometry.albumCoverRadius, overflow: 'hidden', backgroundColor: theme.colors.raised,
          shadowColor: theme.colors.shadow, shadowOffset: {width: 0, height: 30}, shadowOpacity: .9, shadowRadius: 30}}>
          {art ? <Artwork source={art} width={phoneMusicGeometry.albumCover} height={phoneMusicGeometry.albumCover} priority/> : null}
        </View>
        <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, phoneMusicGeometry.albumTitle, 800, -.035), {color: theme.colors.text, textAlign: 'center', marginTop: 20}]}>{title}</Text>
        {entry.artist?.name ? <Text numberOfLines={1} style={[browseType(theme, phoneMusicGeometry.albumArtist, 700), {color: theme.colors.accentStrong, marginTop: 4}]}>{entry.artist.name}</Text> : null}
        {facts.length ? <Facts facts={facts}/> : null}
        <MusicFormatBadges badges={snapshot.albumDetails?.badges} size="phone"/>
      </View>
      <View style={{paddingHorizontal: 20, marginTop: 18}}><MusicActions controller={controller} entry={entry} runtime={runtime} actions={actions} moreRef={more} roundMore={false} download={download}/></View>
      {snapshot.phase === 'error' ? <MusicErrorView error={snapshot.error} onRetry={() => {void controller.load();}} style={{margin: 20}}/> : null}
      {snapshot.songs.length ? <View style={{marginTop: 16}}><SongLines songs={snapshot.songs} runtime={runtime} controller={controller} actions={actions} playingId={playback?.playback.itemId}/></View> : null}
    </ScrollView>
    <PhoneHeader title={title} onBack={onBack} onMore={() => actions.menu(entry, more)} moreRef={more}/>
  </View>;
}

function TabletSongLine({song, index, runtime, controller, actions, playingId}: {
  song: ContentEntry; index: number; runtime: NativeShellRuntime; controller: NativeTVMusicController; actions: Actions; playingId?: string;
}) {
  const theme = useTheme(), title = song.displayTitle ?? song.title, playing = playingId === song.id;
  const model = cardText({id: song.id, kind: 'song', title, artist: song.artist?.name, album: song.album?.name, durationSeconds: song.duration}, 'song-row', runtime.text);
  const duration = model.detail.find(part => part.id === 'duration')?.text;
  return <Focusable accessibilityRole="button" accessibilityLabel={t('next.browse.native.play', {title})} focusKind="row" focusRadius={10}
    onPress={() => {void controller.play(song.id).catch(runtime.reportError);}} style={{height: 52, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors.line}}>
    <View style={{width: 36, alignItems: 'center'}}>{playing ? <LevelBars/> : <Text style={[browseType(theme, 14, 600), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{song.trackNumber ?? index + 1}</Text>}</View>
    <Text numberOfLines={1} style={[browseType(theme, 15.5, 600), {flex: 1, color: playing ? theme.colors.accentStrong : theme.colors.text}]}>{title}</Text>
    {song.plays !== undefined ? <Text style={[browseType(theme, 13, 400), {width: 62, textAlign: 'right', color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{song.plays}</Text> : <View style={{width: 62}}/>}
    {duration ? <Text style={[browseType(theme, 13, 400), {width: 70, textAlign: 'right', color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{duration}</Text> : <View style={{width: 70}}/>}
    <Focusable accessibilityRole="button" accessibilityLabel={t('next.browse.native.moreFor', {title})} onPress={() => actions.menu(song)} focusRadius={17}
      style={{width: 44, height: 44, alignItems: 'center', justifyContent: 'center'}}><Icon name="i-more" size={20} color={theme.colors.textTertiary}/></Focusable>
  </Focusable>;
}

/** phone-app#15b: the artist body, with the drawn circle, Top songs and Albums. */
export function PhoneArtistScreen({controller, entry, runtime, actions, openEntry, onBack}: {
  controller: NativeTVMusicController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions; openEntry: (entry: ContentEntry) => void; onBack: () => void;
}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot), playback = usePlayback(runtime);
  const more = useRef<NativeView>(null);
  const covers = snapshot.albums.flatMap(album => {const source = runtime.artwork(album.posterUrl); return source ? [source] : [];});
  const facts = [
    snapshot.albums.length ? t('title.albumCount', {count: snapshot.albums.length}) : undefined,
    snapshot.songTotal ? t('title.songCount', {count: snapshot.songTotal}) : undefined,
    entry.genres?.[0],
  ].filter((value): value is string => !!value);
  if (theme.platform !== 'phone') {
    const round = {height: phoneMusicGeometry.actionHeight, width: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius};
    const years = entry.activeBeginYear || entry.activeEndYear ? `${entry.activeBeginYear ?? ''}–${entry.activeEndYear ?? ''}` : undefined;
    const details = [[t('title.genres'), entry.genres?.join(', ')], [t('title.country'), entry.country], [t('title.year'), years]].filter(([, value]) => !!value) as [string, string][];
    return <View testID="native-tablet-artist" style={{flex: 1, backgroundColor: theme.colors.ink}}>
      <Wash runtime={runtime} path={snapshot.albums[0]?.posterUrl ?? entry.posterUrl ?? entry.backdropUrl}/>
      <ScrollView contentContainerStyle={{paddingTop: 56, paddingBottom: 100}} showsVerticalScrollIndicator={false}>
        <View style={{alignItems: 'center', paddingHorizontal: 32}}>
          <ArtistCircle covers={covers} rings={[3]} initials={[...entry.title.trim()][0] ?? ''} alt={entry.title} size={220} visible/>
          <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, 58, 800, -.04, 61), {color: theme.colors.text, textAlign: 'center', marginTop: 20}]}>{entry.title}</Text>
          {facts.length ? <Facts facts={facts} strongFirst={false}/> : null}
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20}}>
            <Button style={{height: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius, paddingHorizontal: 24}} icon="i-play" textStyle={browseType(theme, 15, 700)} onPress={() => {void controller.play().catch(runtime.reportError);}}>{t('entry.play')}</Button>
            <Button variant="glass" style={{height: phoneMusicGeometry.actionHeight, borderRadius: phoneMusicGeometry.actionRadius, paddingHorizontal: 24}} icon="i-shuffle" textStyle={browseType(theme, 15, 700)} onPress={() => {void controller.play(undefined, true).catch(runtime.reportError);}}>{t('title.shuffle')}</Button>
            <Button variant="glass" iconOnly icon={snapshot.favorite ? 'i-heart-f' : 'i-heart'} style={round} accessibilityLabel={t(snapshot.favorite ? 'next.browse.native.unfavorite' : 'next.browse.native.favorite')} onPress={() => {void controller.toggleFavorite().catch(runtime.reportError);}}/>
            <Button ref={more} variant="glass" iconOnly icon="i-more" style={round} accessibilityLabel={t('card.more', {title: entry.title})} onPress={() => actions.menu(entry, more)}/>
          </View>
        </View>
        {snapshot.songs.length ? <View style={{marginTop: 32, paddingHorizontal: 32}}>
          <Text style={[browseType(theme, 19, 700), {color: theme.colors.text, marginBottom: 8}]}>{t('music.topSongs')}</Text>
          <View style={{flexDirection: 'row', alignItems: 'center', height: 30, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line}}>
            <Text style={[browseType(theme, 11, 700), {width: 36, color: theme.colors.textTertiary}]}>#</Text>
            <Text style={[browseType(theme, 11, 700), {flex: 1, color: theme.colors.textTertiary}]}>{t('next.browse.native.title')}</Text>
            <Text style={[browseType(theme, 11, 700), {width: 62, textAlign: 'right', color: theme.colors.textTertiary}]}>{t('next.browse.native.plays')}</Text>
            <Text style={[browseType(theme, 11, 700), {width: 70, textAlign: 'right', color: theme.colors.textTertiary}]}>{t('next.browse.duration')}</Text>
            <View style={{width: 44}}/>
          </View>
          {snapshot.songs.map((song, index) => <TabletSongLine key={song.id} song={song} index={index} runtime={runtime} controller={controller} actions={actions} playingId={playback?.playback.itemId}/>)}
        </View> : null}
        {snapshot.albums.length ? <View style={{marginTop: 28, paddingHorizontal: 32}}>
          <Text style={[browseType(theme, 19, 700), {color: theme.colors.text, marginBottom: 10}]}>{t('music.albums')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 14}}>
            {snapshot.albums.map(album => <AlbumCard key={album.id} album={album} runtime={runtime} actions={actions} openEntry={openEntry}/>)}
          </ScrollView>
        </View> : null}
        {details.length ? <View style={{paddingHorizontal: 32, marginTop: 28, width: 340}}>
          <Text style={[browseType(theme, 19, 700), {color: theme.colors.text, marginBottom: 8}]}>{t('title.details')}</Text>
          {details.map(([label, value]) => <View key={label} style={{flexDirection: 'row', gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.colors.line}}>
            <Text style={[browseType(theme, 13, 400), {width: 96, color: theme.colors.textTertiary}]}>{label}</Text><Text style={[browseType(theme, 13, 500), {flex: 1, color: theme.colors.text}]}>{value}</Text></View>)}
        </View> : null}
      </ScrollView>
    </View>;
  }
  return <View testID="native-phone-artist" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <Wash runtime={runtime} path={snapshot.albums[0]?.posterUrl ?? entry.posterUrl ?? entry.backdropUrl}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(phoneMusicGeometry.artistTop, insets.top + 56), paddingBottom: 40}} showsVerticalScrollIndicator={false}>
      <View style={{alignItems: 'center', paddingHorizontal: 20}}>
        <ArtistCircle covers={covers} rings={[3]} initials={[...entry.title.trim()][0] ?? ''} alt={entry.title} size={phoneMusicGeometry.artistCircle} visible/>
        <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, phoneMusicGeometry.artistTitle, 800, -.035), {color: theme.colors.text, textAlign: 'center', marginTop: 18}]}>{entry.title}</Text>
        {facts.length ? <Facts facts={facts} strongFirst={false}/> : null}
      </View>
      <View style={{paddingHorizontal: 20, marginTop: 18}}><MusicActions controller={controller} entry={entry} runtime={runtime} actions={actions} moreRef={more} roundMore/></View>
      {snapshot.phase === 'error' ? <MusicErrorView error={snapshot.error} onRetry={() => {void controller.load();}} style={{margin: 20}}/> : null}
      {snapshot.songs.length ? <View style={{marginTop: 18}}>
        <Text style={[browseType(theme, phoneMusicGeometry.sectionLabel, 700), {color: theme.colors.textTertiary, marginHorizontal: 20, marginBottom: 8}]}>{t('music.topSongs')}</Text>
        <SongLines songs={snapshot.songs} runtime={runtime} controller={controller} actions={actions} playingId={playback?.playback.itemId}/>
      </View> : null}
      {snapshot.albums.length ? <View style={{marginTop: 14}}>
        <Text style={[browseType(theme, 19, 700), {color: theme.colors.text, marginHorizontal: 20, marginBottom: 10}]}>{t('music.albums')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 12, paddingHorizontal: 20}}>
          {snapshot.albums.map(album => <AlbumCard key={album.id} album={album} runtime={runtime} actions={actions} openEntry={openEntry}/>)}
        </ScrollView>
      </View> : null}
    </ScrollView>
    <PhoneHeader title={entry.title} onBack={onBack} onMore={() => actions.menu(entry, more)} moreRef={more}/>
  </View>;
}
