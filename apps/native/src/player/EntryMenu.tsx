import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {queueItemInput} from '../../../../packages/client-core/src/queue-controller';
import {SavedService, type PlaylistCard, type SavedSnapshot} from '../../../../packages/client-core/src/saved';
import {entryActions, type EntryActionId} from '../../../../packages/client-core/src/presentation/index';
import {announceMark, containerKindFor, useContainerState} from '../app/container-state';
import type {DownloadRequestKind} from '../../../../packages/client-core/src/download-requests';
import {PersonalSavedService, type PersonalSavedSnapshot} from '../../../../packages/client-core/src/personal-saved';
import {viewerScope} from '../app/content';
import {requestId, useDetail} from '../app/detail';
import {useDownloads} from '../app/downloads';
import {useGroupActions} from '../app/together';
import {repairTargetFor, useMetadataEditor} from '../app/metadata-editor';
import {useSession} from '../app/session';
import {Button, ConfirmSheet, Divider, Field, ListRow, Menu, Notice, Sheet, StateView, Surface, showToast, useTheme, type MenuItem} from '../ui';
import {separateArtist} from '../../../../packages/client-core/src/title-identity';
import type {usePlayerEngine} from './usePlayer';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import type {EntryOrigin} from '../app/player-actions';
import {continueScope, removeFromContinueWatching} from '../app/continue-watching';
import {markNotInterested} from '../app/not-interested';
import {emitPlaybackChange} from '../app/playback-events';

type Engine = ReturnType<typeof usePlayerEngine>;

/**
 * The long-press menu for any title, from the shared model (client-core `entryActions`, CON-24):
 * the same order, groups, words and glyphs as the web's ⋯ menu. Playing and opening need nothing
 * from the server. What the viewer may do to the title personally comes from the title's own
 * detail (an item) or its container state (a show, season, album, book or artist: the watched
 * default, Watchlist and Favorite), read only while the menu is open.
 */
export function EntryMenu({entry, origin, engine, onClose, onOpen, onTogether}: {entry: ContentEntry | null; /** X-12: where the card sits. */ origin?: EntryOrigin; engine: Engine; onClose: () => void; onOpen: (entry: ContentEntry) => void; onTogether: () => void}) {
  const i18n = useI18n();
  const {isTV} = useTheme();
  const {session, api} = useSession();
  const editor = useMetadataEditor();
  const downloads = useDownloads();
  const together = useGroupActions();
  const target = useMemo(() => (entry?.libraryId && entry.id ? {libraryId: entry.libraryId, itemId: entry.id} : null), [entry?.libraryId, entry?.id]);
  const {snapshot, mutate} = useDetail(target);
  const [playlistFor, setPlaylistFor] = useState<ContentEntry | null>(null);
  const [separating, setSeparating] = useState<ContentEntry | null>(null);
  const containerKind = entry?.navigation?.entityId ? containerKindFor(entry.kind) : undefined;
  const containerId = containerKind ? entry!.navigation!.entityId! : undefined;
  const container = useContainerState(api, entry ? containerKind : undefined, entry ? containerId : undefined);
  // The detail service keeps the last title it read; only trust it for the entry on screen.
  const data = snapshot.data && entry && snapshot.data.scope.itemId === entry.id ? snapshot.data : undefined;
  const personal = data?.personal;
  // Editing is the owner's, however they signed in: the server authorises a Portico Account
  // owner exactly as it does a direct one.
  const canEdit = !isTV && session?.viewer.role === 'owner';
  const downloadKind: DownloadRequestKind | undefined = containerKind === 'show' || containerKind === 'season' || containerKind === 'album' || containerKind === 'book' ? containerKind : undefined;
  const items = useMemo<MenuItem[]>(() => {
    if (!entry) return [];
    const has = (id: string) => data?.actions.some(a => a.id === id && a.enabled) ?? false;
    const flag = (name: 'watchlisted' | 'favorite' | 'watched') => (container.carries(name) ? !!container.state?.[name] : undefined);
    const groups = entryActions({
      kind: entry.kind,
      playable: !!entry.playback,
      progressSeconds: entry.progressSeconds,
      queue: !!engine.service.getQueueController(),
      group: together.inRoom && together.canQueue,
      // On the title's own page these three are the action row; the menu holds the rest.
      ...(origin === 'page' ? {} : {
        watchlisted: containerKind ? flag('watchlisted') : has('watchlist') ? !!personal?.watchlisted : undefined,
        favorite: containerKind ? flag('favorite') : has('favorite') ? !!personal?.favorite : undefined,
        watched: containerKind ? flag('watched') : has('watched') ? !!personal?.watched : undefined,
      }),
      // X-12: only a Continue Watching card offers to leave the row; P5: a recommendation can be
      // turned down. Neither needs anything from the detail.
      continueWatching: origin === 'continue_watching',
      notInterested: origin === 'recommendation',
      addToPlaylist: !!entry.playback,
      download: !downloads.service ? undefined : entry.playback ? 'media' : downloadKind ? 'container' : undefined,
      details: !!entry.navigation && origin !== 'page',
      editMetadata: !!(canEdit && repairTargetFor(entry)),
      separateArtist: canEdit && entry.kind === 'album' && !!entry.navigation?.entityId,
    });
    return groups.flatMap(group => group.actions.map((action, index): MenuItem => ({
      id: action.id, label: i18n.t(action.label), icon: action.icon as MenuItem['icon'], destructive: action.destructive,
      ...(index === 0 && group.id !== 'play' ? {section: group.title ? i18n.t(group.title) : ''} : {}),
    })));
  }, [entry, origin, data, personal, canEdit, engine.service, downloads.service, together.inRoom, together.canQueue, i18n, containerKind, downloadKind, container]);

  const select = (id: string) => {
    if (!entry) return;
    const item = entry.playback?.itemId;
    const failed = (e: unknown) => showToast({message: say(e, 'show', 'save'), icon: 'warning'});
    switch (id as EntryActionId) {
      case 'play': case 'resume': if (item) engine.play(item, entry.playback!.startSeconds ?? entry.progressSeconds ?? 0, entry); break;
      case 'playFromStart': if (item) engine.play(item, 0, entry); break;
      case 'playNext': case 'addToQueue':
        if (item) engine.service.getQueueController()?.enqueue(queueItemInput(item), id === 'playNext').then(() => showToast({message: i18n.t(id === 'playNext' ? 'entry.playingNext' : 'entry.addedToQueue'), icon: 'queue'}), undefined).catch(e => showToast({message: say(e, 'playlist', 'action'), icon: 'warning'}));
        break;
      case 'watchWithGroup': if (item) void together.service?.watch(item).then(ok => { if (ok) onTogether(); }); break;
      case 'addToGroupQueue': if (item) void together.service?.queueAdd([item]).then(ok => showToast(ok ? {message: i18n.t('entry.addedToGroupQueue'), icon: 'check'} : {message: i18n.t('entry.groupQueueFailed'), icon: 'warning'})); break;
      case 'watchlist': if (containerKind) void container.setFlag('watchlisted', !container.state?.watchlisted).catch(failed); else mutate({action: 'watchlist', value: !personal?.watchlisted}); break;
      case 'favorite': if (containerKind) void container.setFlag('favorite', !container.state?.favorite).catch(failed); else mutate({action: 'favorite', value: !personal?.favorite}); break;
      case 'watched':
        if (containerKind && containerId) {
          // A show, season, album or book marked from its card: said, with Undo while the server's receipt is good.
          const next = !(container.state?.watched ?? false), kind = containerKind, id = containerId, title = entry.title;
          // The screens behind the menu read their titles again after the mark, and again after an Undo.
          const reread = () => emitPlaybackChange({positionSeconds: 0, completed: false, reason: 'closed'});
          void container.setWatched(next).then(marked => { announceMark(api, kind, id, marked, i18n.t(next ? 'title.seasonMarkedWatched' : 'title.seasonMarkedUnwatched', {season: title}), reread); reread(); }, failed);
        } else mutate({action: 'watched', value: !personal?.watched});
        break;
      case 'removeFromContinueWatching': {
        const viewer = session?.viewer;
        void removeFromContinueWatching({
          api, scope: continueScope(viewer?.serverId ?? api.baseUrl, viewer?.accountId, viewer?.profileId), itemId: entry.id, title: entry.title,
          revision: personal?.revision, operationId: requestId, toast: showToast, t: (key, values) => i18n.t(key, values),
        });
        break;
      }
      case 'notInterested': {
        const viewer = session?.viewer;
        void markNotInterested({
          api, scope: continueScope(viewer?.serverId ?? api.baseUrl, viewer?.accountId, viewer?.profileId), serverId: viewer?.serverId ?? api.baseUrl, entry,
          operationId: requestId, toast: showToast, t: (key, values) => i18n.t(key, values),
        });
        break;
      }
      case 'addToPlaylist': setPlaylistFor(entry); break;
      case 'download':
        if (item) downloads.ask({target: {mediaId: item}, title: entry.title, display: {title: entry.title, subtitle: entry.subtitle, artworkUrl: entry.posterUrl, libraryId: entry.libraryId, kind: entry.kind}});
        else if (downloadKind && containerId) downloads.ask({target: {containerId, containerKind: downloadKind}, title: entry.title});
        break;
      case 'details': onOpen(entry); break;
      case 'editMetadata': { const repair = repairTargetFor(entry); if (repair) editor?.open({targets: [repair], titles: [entry.title]}); break; }
      case 'separateArtist': setSeparating(entry); break;
    }
  };
  return (
    <>
      <Menu open={entry !== null} onClose={onClose} title={entry?.title} subtitle={entry?.subtitle} items={items} onSelect={select} />
      <PlaylistSheet entry={playlistFor} onClose={() => setPlaylistFor(null)} />
      {/* "Not this artist…" (owners): the album moves to a new artist of the same name, whose page then opens. */}
      <ConfirmSheet open={!!separating} onDismiss={() => setSeparating(null)} tone="default" title={i18n.t('title.separateArtist.title')} consequence={i18n.t('title.separateArtist.body')} confirmLabel={i18n.t('title.separateArtist.confirm')}
        describeError={e => say(e, 'show', 'action') || i18n.t('title.separateArtist.failed')}
        onConfirm={async () => {
          const album = separating;
          if (!album?.navigation?.entityId) return;
          const artistId = await separateArtist(api, [album.navigation.entityId]);
          setSeparating(null);
          emitPlaybackChange({positionSeconds: 0, completed: false, reason: 'closed'});
          onOpen({id: artistId, kind: 'artist', title: album.subtitle ?? album.title, libraryId: album.libraryId, navigation: {view: 'artist', entityId: artistId}});
        }} />
    </>
  );
}

/** Pick an existing playlist or name a new one, then add the title to it. */
export function PlaylistSheet({entry, onClose}: {entry: ContentEntry | null; onClose: () => void}) {
  const i18n = useI18n();
  const {api, session} = useSession();
  const {space} = useTheme();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new SavedService({api, scope, requestId}), [api, scope]);
  const [snapshot, setSnapshot] = useState<SavedSnapshot>(service.getSnapshot());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => { unsubscribe(); service.dispose(); };
  }, [service]);
  useEffect(() => {
    if (!entry) return;
    setName(''); setError('');
    void service.select({view: 'playlists'}).catch(() => {});
  }, [entry, service]);
  const itemId = entry?.playback?.itemId;
  const playlists = (snapshot.projection?.sections.flatMap(s => s.entries) ?? []).filter((e): e is PlaylistCard => e.kind === 'playlist');
  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('');
    try { await work(); showToast({message, icon: 'check'}); onClose(); } catch (e) { setError(say(e, 'playlist', 'action')); } finally { setBusy(false); }
  };
  const add = (playlist: PlaylistCard) => run(async () => { await service.select({view: 'playlist', playlistId: playlist.id}); await service.mutate({action: 'add', itemId: itemId!}); }, i18n.t('entry.addedTo', {name: playlist.title}));
  const create = () => run(async () => { await service.select({view: 'playlists'}); await service.mutate({action: 'create', name: name.trim(), itemIds: [itemId!]}); }, i18n.t('entry.created', {name: name.trim()}));
  return (
    <Sheet open={entry !== null && !!itemId} onClose={onClose} title={i18n.t('entry.sheet.addToPlaylist')} subtitle={entry?.title}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="danger" message={error} /> : null}
        {snapshot.phase === 'loading' && !snapshot.projection ? <StateView loading title={i18n.t('entry.loadingPlaylists')} /> : null}
        {playlists.length ? (
          <Surface padded={false}>
            {playlists.map((p, i) => (
              <View key={p.id}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow icon="queue" title={p.title} subtitle={p.subtitle} meta={p.count !== undefined ? String(p.count) : undefined} disabled={busy} onPress={() => void add(p)} />
              </View>
            ))}
          </Surface>
        ) : null}
        <Field label={i18n.t('web.saved.newPlaylist')} placeholder={i18n.t('profile.name')} value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={() => { if (name.trim()) void create(); }} />
        <Button variant="primary" label={i18n.t('entry.createPlaylist')} loading={busy} disabled={!name.trim() || busy} onPress={() => void create()} />
      </View>
    </Sheet>
  );
}

/**
 * Add a title to one of this profile's collections, or start a new one with it. Exported so the
 * title pages' ⋯ menus can offer it next to Add to playlist.
 */
export function CollectionSheet({entry, onClose}: {entry: ContentEntry | null; onClose: () => void}) {
  const i18n = useI18n();
  const {api, session} = useSession();
  const {space} = useTheme();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new PersonalSavedService(api, scope, requestId), [api, scope]);
  const [snapshot, setSnapshot] = useState<PersonalSavedSnapshot>(service.getSnapshot());
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => { unsubscribe(); service.dispose(); };
  }, [service]);
  useEffect(() => {
    if (!entry) return;
    setName(''); setError('');
    void service.select({view: 'collections'}).catch(() => {});
  }, [entry, service]);
  const itemId = entry?.playback?.itemId ?? entry?.id;
  const collections = snapshot.resources.filter(r => r.kind === 'collection' && r.actions.includes('entries'));
  const run = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true); setError('');
    try { await work(); showToast({message, icon: 'check'}); onClose(); } catch (e) { setError(say(e, 'collection', 'action')); } finally { setBusy(false); }
  };
  const add = (id: string, title: string) => run(async () => { await service.select({view: 'resource', resourceId: id}); await service.mutate({action: 'entries', addItemIds: [itemId!]}); }, i18n.t('entry.addedTo', {name: title}));
  const create = () => run(async () => {
    await service.select({view: 'collections'});
    await service.mutate({action: 'create', kind: 'collection', name: name.trim()});
    const made = service.getSnapshot().resources.find(r => r.kind === 'collection' && r.name === name.trim());
    if (made) { await service.select({view: 'resource', resourceId: made.id}); await service.mutate({action: 'entries', addItemIds: [itemId!]}); }
  }, i18n.t('entry.created', {name: name.trim()}));
  return (
    <Sheet open={entry !== null && !!itemId} onClose={onClose} title={i18n.t('entry.sheet.addToCollection')} subtitle={entry?.title}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="danger" message={error} /> : null}
        {snapshot.loading && !snapshot.resources.length ? <StateView loading title={i18n.t('entry.loadingCollections')} /> : null}
        {collections.length ? (
          <Surface padded={false}>
            {collections.map((c, i) => (
              <View key={c.id}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow icon="collection" title={c.name} meta={String(c.entryCount)} disabled={busy} onPress={() => void add(c.id, c.name)} />
              </View>
            ))}
          </Surface>
        ) : null}
        <Field label={i18n.t('web.saved.newCollection')} placeholder="Rainy Sunday movies" value={name} onChangeText={setName} returnKeyType="done" onSubmitEditing={() => { if (name.trim()) void create(); }} /> {/* lint-strings-allow: an example name, not copy */}
        <Button variant="primary" label={i18n.t('entry.createCollection')} loading={busy} disabled={!name.trim() || busy} onPress={() => void create()} />
      </View>
    </Sheet>
  );
}
