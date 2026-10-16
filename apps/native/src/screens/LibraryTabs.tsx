import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {parseBrowseResult} from '../../../../packages/client-core/src/browse';
import {SavedService, type PlaylistCard, type PlaylistListFilter, type SavedSnapshot} from '../../../../packages/client-core/src/saved';
import {PlaylistControls} from './PlaylistControls';
import {useArtwork, viewerScope} from '../app/content';
import {viewerKey} from '../app/viewer-scope';
import {requestId} from '../app/detail';
import {useI18n} from '../app/i18n';
import {songCountLabel} from '../app/browse-count';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {Card, Divider, ListRow, Notice, Skeleton, StateView, useTheme} from '../ui';

/**
 * The tabs of a library that are not a grid of titles: Music's genres (each a card that opens
 * Albums filtered to it) and the viewer's playlists.
 */

/** A genre's cover, read once per genre for the cards on screen (the grid mounts only those). */
const covers = new Map<string, string | undefined>();

export function GenreCard({libraryId, entry, width, onPress}: {libraryId: string; entry: ContentEntry; width?: number; onPress: () => void}) {
  const {api, session} = useSession();
  const i18n = useI18n();
  const artwork = useArtwork();
  // A cover is the newest album this viewer may see in the genre: it is kept for this viewer only.
  const key = `${viewerKey(session, api)}:${libraryId}:${entry.title}`;
  const [cover, setCover] = useState<string | undefined>(entry.artworkPaths?.[0] ?? covers.get(key));
  useEffect(() => {
    if (cover || covers.has(key)) return;
    let live = true;
    api.request<unknown>(`/v1/libraries/${encodeURIComponent(libraryId)}/browse`, 'POST', {pivot: 'albums', query: {all: [{field: 'genre', operator: 'in', value: [entry.title]}]}, sort: [{field: 'added', direction: 'desc'}], limit: 1}).then(
      raw => {
        const found = parseBrowseResult(raw).entries[0]?.posterUrl;
        covers.set(key, found);
        // Bounded: the oldest covers go first.
        while (covers.size > 400) covers.delete(covers.keys().next().value as string);
        if (live) setCover(found);
      },
      () => {},
    );
    return () => { live = false; };
  }, [api, libraryId, entry.title, key, cover]);
  return <Card title={entry.title} subtitle={entry.count ? songCountLabel(i18n.t, entry.count, entry.countIsLowerBound) : undefined} source={artwork(cover)} shape="square" width={width} icon={cover ? undefined : 'category'} onPress={onPress} />;
}

/** The viewer's playlists, as on Saved, with their sorts and their groups (mine, shared, pinned). */
export function LibraryPlaylists() {
  const {api, session} = useSession();
  const i18n = useI18n();
  const {space} = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new SavedService({api, scope, requestId}), [api, scope]);
  const [snapshot, setSnapshot] = useState<SavedSnapshot>(service.getSnapshot());
  const [choice, setChoice] = useState<{sort?: string; direction?: 'asc' | 'desc'; filter?: PlaylistListFilter}>({});
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => { unsubscribe(); service.dispose(); };
  }, [service]);
  useEffect(() => {
    Promise.resolve().then(() => service.select({view: 'playlists', ...(choice.sort ? {sort: choice.sort, direction: choice.direction} : {}), ...(choice.filter ? {filter: choice.filter} : {})})).catch(() => {});
  }, [service, choice]);
  const cards = (snapshot.projection?.sections ?? []).flatMap(section => section.entries).filter((e): e is PlaylistCard => e.kind === 'playlist');
  if (snapshot.phase === 'error' && !cards.length) return <Notice tone="error" message={i18n.t('library.playlists.loadFailed')} action={i18n.t('action.tryAgain')} onAction={() => void service.retry().catch(() => {})} style={{marginHorizontal: space.page}} />;
  if (snapshot.phase === 'loading' && !cards.length && !snapshot.projection) return <View style={{paddingHorizontal: space.page}}><Skeleton width={280} height={56} /></View>;
  const projection = snapshot.projection;
  const controls = projection ? <PlaylistControls sorts={projection.sorts} filters={projection.filters} sort={choice.sort ?? projection.query.sort} direction={choice.direction ?? (projection.query.direction === 'desc' ? 'desc' : 'asc')} filter={choice.filter} onSort={(sort, direction) => setChoice(c => ({...c, sort, direction}))} onFilter={filter => setChoice(c => ({...c, filter}))} /> : null;
  if (!cards.length) return <>{controls}{choice.filter ? <StateView icon="filter" title={i18n.t('playlists.filter.none')} action={i18n.t('web.saved.showAll')} onAction={() => setChoice(c => ({...c, filter: undefined}))} /> : <StateView icon="queue" title={i18n.t('web.saved.empty.playlists')} message={i18n.t('web.saved.empty.playlistsBody')} />}</>;
  return (
    <>
      {controls}
      <View style={{paddingHorizontal: space.page - space.sm}}>
        {cards.map((card, index) => (
          <View key={card.id}>
            {index > 0 ? <Divider inset={space.sm} /> : null}
            <ListRow title={card.title} subtitle={card.subtitle} meta={card.count !== undefined ? i18n.t('count.items', {count: card.count}) : undefined} icon="queue" trailingIcon="forward" onPress={() => navigation.push('Playlist', {playlistId: card.navigation.entityId, title: card.title})} />
          </View>
        ))}
      </View>
    </>
  );
}
