import React, {useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {Library} from '../../../../../packages/client-core/src/index';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {PersonalResource, PersonalSavedSnapshot} from '../../../../../packages/client-core/src/personal-saved';
import type {PlaylistOccurrence, SavedRoute, SavedSnapshot} from '../../../../../packages/client-core/src/saved';
import {Button, Chip, Focusable, Switch} from '../../kit/controls';
import {AmbientArt, Artwork, MediaArt} from '../../kit/artwork';
import {CardFrame, Parts} from '../../kit/cards/primitives';
import {PosterCard, SquareCard} from '../../kit/cards';
import {FocusRegion} from '../../kit/focus';
import {Banner, BottomSheet, Menu, ToastHost, type MenuEntry, type ToastMessage} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {Icon} from '../../kit/Icon';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeEntryMenuState} from '../destinations/entry-actions';
import {nativeDestinationFocusIds, type NativeDestinationActivationPort} from '../destinations/focus';
import type {NativeSavedViewDestination} from './view-model';
import {homeCardText} from '../home/model';
import {SavedConfirmSheet, SavedNameSheet} from './SavedForms';
import {exactDurationSeconds, firstPlayable, personalMosaic, playlistEntryMosaic, savedDuration, savedItemCount, savedLibraryName, savedPlaylistEyebrow,
  savedResourceEyebrow, savedTitleCount, savedViewConditionCount, savedVisibility, savedVisibilityHelp} from './presentation';

const t = defaultI18n.t;

export type NativeSavedEntryActions = Readonly<{
  menuState?: NativeEntryMenuState;
  open: (entry: ContentEntry) => void;
  play: (entry: ContentEntry) => void;
  menu: (entry: ContentEntry, anchorRef?: RefObject<View | null>) => void;
  isMenuOpen?: (entry: ContentEntry) => boolean;
}>;

export type NativeSavedResourceProps = Readonly<{
  route: SavedRoute;
  destination: NativeSavedViewDestination;
  activation: NativeDestinationActivationPort;
  runtime: NativeShellRuntime;
  actions: NativeSavedEntryActions;
  libraries: readonly Library[];
  back: () => void;
}>;

type Row = Readonly<{id: string; media: ContentEntry}>;
type RowMenu = Readonly<{entry: ContentEntry; entryId: string}>;

/** collections.html 11a–13c and 18–20. The page reads the actual Saved route
 * through its canonical service; commands go back through the same service. */
export function SavedResourceScreen({route, destination, activation, runtime, actions, libraries, back}: NativeSavedResourceProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const snapshot = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  useSyncExternalStore(actions.menuState?.subscribe ?? (() => () => {}), actions.menuState?.getSnapshot ?? (() => 0));
  const [pageMenu, setPageMenu] = useState(false), [rowMenu, setRowMenu] = useState<RowMenu>(), [renaming, setRenaming] = useState(false), [deleting, setDeleting] = useState(false);
  const [reordering, setReordering] = useState(false), [infoOpen, setInfoOpen] = useState(false), [problem, setProblem] = useState<string>(), [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null), toastId = useRef(0);
  useEffect(() => {void destination.select(route).catch(runtime.reportError);}, [destination, route, runtime]);
  useEffect(() => {setPageMenu(false); setRowMenu(undefined); setRenaming(false); setDeleting(false); setReordering(false); setProblem('');}, [route]);
  const saved = snapshot.saved as SavedSnapshot | undefined, personal = snapshot.personal as PersonalSavedSnapshot | undefined;
  const playlist = saved?.playlist ?? null, resource = personal?.resource ?? null, isPlaylist = route.view === 'playlist';
  const rows: readonly Row[] = useMemo(() => isPlaylist
    ? (saved?.projection?.sections ?? []).flatMap(section => section.entries.flatMap(entry => entry.kind === 'playlist_entry' && !entry.hidden ? [{id: entry.id, media: entry.media}] : []))
    : (personal?.entries ?? []).flatMap(entry => !entry.hidden && entry.media ? [{id: entry.id, media: entry.media}] : []), [isPlaylist, personal?.entries, saved?.projection]);
  const media = rows.map(row => row.media), playable = media.filter(entry => !!entry.playback && entry.available !== false && !entry.missing);
  const count = isPlaylist ? playlist?.entryCount : resource?.entryCount;
  const countText = isPlaylist ? savedItemCount(count) : savedTitleCount(count);
  const duration = exactDurationSeconds(media), artwork = isPlaylist ? playlistEntryMosaic((saved?.projection?.sections ?? []).flatMap(section => section.entries).filter((entry): entry is PlaylistOccurrence => entry.kind === 'playlist_entry')) : personalMosaic(resource);
  const name = isPlaylist ? playlist?.name : resource?.name;
  const eyebrow = isPlaylist ? savedPlaylistEyebrow : resource ? savedResourceEyebrow(resource) : undefined;
  const canReorder = reordering || (isPlaylist ? playlist?.actions.includes('reorder') === true : resource?.kind === 'collection' && resource.actions.includes('reorder') === true);
  const visibility = resource?.kind === 'collection' ? savedVisibility(resource) : undefined;
  const report = (error: unknown) => runtime.reportError(error);
  const run = async (work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setProblem('');
    try {await work();} catch (error) {setProblem(error instanceof Error ? error.message : t('error.unavailable'));} finally {setBusy(false);}
  };
  const play = (shuffle = false) => {
    if (!playable.length) return;
    const entry = shuffle ? playable[Math.floor(Math.random() * playable.length)] : firstPlayable(playable);
    if (entry) actions.play(entry);
  };
  const pin = () => {
    if (isPlaylist ? !playlist : !resource) return;
    void run(async () => {
      if (isPlaylist) await destination.mutateSaved({action: 'pin', pinned: playlist!.pinned !== true});
      else await destination.mutatePersonal({action: 'pin', pinned: resource!.pinned !== true});
    });
  };
  const remove = (row: Row) => {
    setRowMenu(undefined);
    void run(async () => {
      if (isPlaylist) {
        await destination.mutateSaved({action: 'remove', entryId: row.id});
        const token = destination.getSnapshot().saved?.lastReceipt?.undoToken;
        if (token) showUndo(t('saved.removal.fromPlaylist', {title: row.media.title}), () => destination.mutateSaved({action: 'restore', undoToken: token}), t('saved.removal.fromPlaylist', {title: row.media.title}));
      } else {
        await destination.mutatePersonal({action: 'entries', removeEntryIds: [row.id]});
        const undo = destination.getSnapshot().personal?.result?.undo;
        if (undo) showUndo(t('saved.removal.fromCollection', {title: row.media.title}), () => destination.mutatePersonal({action: 'entries', undoToken: undo.token}), t('saved.removal.fromCollection', {title: row.media.title}));
      }
    });
  };
  const showUndo = (message: string, undo: () => Promise<unknown>, failure: string) => {
    const id = String(++toastId.current);
    setToast({id, message, action: {label: t('action.undo'), onPress: () => {void undo().then(() => setToast(null)).catch(() => {setToast({id: `${id}-failed`, message: failure});});}}});
  };
  const move = (row: Row, where: 'up' | 'down' | 'top' | 'bottom') => {
    setRowMenu(undefined);
    const ids = rows.map(value => value.id), index = ids.indexOf(row.id);
    if (index < 0) return;
    let after: string | undefined;
    if (where === 'up') {if (index === 0) return; after = index === 1 ? '' : ids[index - 2];}
    else if (where === 'down') {if (index === ids.length - 1) return; after = ids[index + 1];}
    else if (where === 'top') {if (index !== 0) after = '';}
    else {if (index !== ids.length - 1) after = ids[ids.length - 1];}
    if (after === undefined) return;
    void run(async () => {
      if (isPlaylist) {
        try {await destination.mutateSaved({action: 'reorder', entryIds: [row.id], afterEntryId: after});}
        catch (error) {
          const code = (error as {code?: string}).code;
          if (code !== 'playlist_conflict' && code !== 'revision_mismatch') throw error;
          await destination.loadOrder();
          await destination.mutateSaved({action: 'reorder', entryIds: [row.id], afterEntryId: after});
        }
      } else await destination.mutatePersonal({action: 'reorder', entryIds: [row.id], afterEntryId: after});
    });
  };
  const saveName = (input: {name: string; summary: string; visibility: 'private' | 'server'}) => {
    void run(async () => {
      if (isPlaylist) await destination.mutateSaved({action: 'rename', name: input.name, ...(playlist?.actions.includes('summary') ? {summary: input.summary} : {})});
      else await destination.mutatePersonal({action: 'update', name: input.name, summary: input.summary});
      setRenaming(false);
    });
  };
  const confirmDelete = () => {
    void run(async () => {
      if (isPlaylist) await destination.mutateSaved({action: 'delete'});
      else await destination.mutatePersonal({action: 'delete'});
      setDeleting(false); back();
    });
  };
  const rowMenuEntries = (menu: RowMenu): readonly MenuEntry[] => {
    const index = rows.findIndex(row => row.id === menu.entryId), last = rows.length - 1;
    return [
      {id: 'open', label: t('web.saved.goToItem'), icon: 'i-info', onSelect: () => {setRowMenu(undefined); actions.open(menu.entry);}},
      ...(canReorder ? [
        {id: 'top', label: t('order.moveTop'), icon: 'i-up', disabled: index <= 0, onSelect: () => move(rows[index]!, 'top')},
        {id: 'up', label: t('player.queueMoveUp'), icon: 'i-up', disabled: index <= 0, onSelect: () => move(rows[index]!, 'up')},
        {id: 'down', label: t('player.queueMoveDown'), icon: 'i-down', disabled: index < 0 || index >= last, onSelect: () => move(rows[index]!, 'down')},
        {id: 'bottom', label: t('order.moveBottom'), icon: 'i-down', disabled: index < 0 || index >= last, onSelect: () => move(rows[index]!, 'bottom')},
      ] as const : []),
      ...(media.some(entry => entry === menu.entry) && (isPlaylist ? playlist?.actions.includes('remove') : resource?.kind === 'collection' && resource.role !== 'viewer' && resource.actions.includes('entries'))
        ? [{id: 'remove', separator: true as const}, {id: 'remove-entry', label: t(isPlaylist ? 'web.saved.removeFromPlaylist' : 'web.saved.removeFromCollection'), icon: 'i-trash' as const, destructive: true, onSelect: () => remove(rows[index]!)}]
        : []),
    ];
  };
  const menuItems: readonly MenuEntry[] = (() => {
    const items: MenuEntry[] = [], pinned = playlist?.pinned === true || resource?.pinned === true;
    if (isPlaylist ? playlist?.actions.includes('pin') : resource?.actions.includes('pin')) items.push({id: 'pin', label: t(pinned ? 'pins.unpin' : 'pins.pin'),
      icon: pinned ? 'i-bookmark-f' : 'i-bookmark', onSelect: () => {setPageMenu(false); pin();}});
    if (isPlaylist ? playlist?.actions.includes('rename') : resource?.actions.includes('update')) items.push({id: 'rename', label: t('web.saved.rename'),
      icon: 'i-edit', onSelect: () => {setPageMenu(false); setRenaming(true);}});
    if (isPlaylist ? playlist?.actions.includes('delete') : resource?.actions.includes('delete')) items.push({id: 'delete',
      label: t(isPlaylist ? 'web.saved.deletePlaylist' : resource?.kind === 'view' ? 'web.saved.deleteView' : 'web.saved.deleteCollection'),
      icon: 'i-trash', destructive: true, onSelect: () => {setPageMenu(false); setDeleting(true);}});
    return items;
  })();
  const stateError = snapshot.error ?? saved?.error ?? personal?.error;
  const width = theme.isTV ? 1920 - theme.gutter * 2 : dimensions.width - theme.gutter * 2;
  const focusIds = useMemo(() => nativeDestinationFocusIds(runtime.getSnapshot().authority), [runtime]);
  const region = `saved.resource.${route.view === 'playlist' ? route.playlistId : `${route.view}:${route.resourceId ?? ''}`}`;
  const applyError = (error: unknown) => <StateView variant={theme.isTV ? 'centered' : 'inline'} {...runtime.error(error, () => {void destination.retry().catch(report);})}/>;
  return <View testID={`native-saved-resource-${isPlaylist ? 'playlist' : 'resource'}`} pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    {theme.isTV ? null : <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: 760, overflow: 'hidden'}}>
      {!!artwork[0] && <AmbientArt source={runtime.ambient(artwork[0])} treatment="library"/>}
    </View>}
    <FocusRegion id={region} entry="saved-play" orientation="vertical" enabled={active.visible} edges={{left: focusIds.rail}} style={{flex: 1}}>
      <View pointerEvents="box-none" style={{position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: insets.top, height: insets.top + (theme.isTV ? 96 : 52),
        paddingHorizontal: theme.isTV ? theme.gutter : 12, flexDirection: 'row', alignItems: 'center'}}>
        <Focusable focusId="saved-back" testID="saved-resource-back" accessibilityRole="button" accessibilityLabel={t('saved.title')} onPress={back}
          style={{width: theme.isTV ? 64 : 38, height: theme.isTV ? 64 : 38, borderRadius: theme.isTV ? 32 : 19, alignItems: 'center', justifyContent: 'center',
            backgroundColor: theme.isTV ? 'transparent' : alpha(theme.colors.ink, .45)}}>
          <Icon name="i-left" size={theme.isTV ? 30 : 22} color={theme.colors.text}/>
        </Focusable>
        <View style={{marginLeft: 'auto'}}>
          <Button testID="saved-resource-menu" focusId="saved-resource-menu" variant="glass" icon="i-more" iconOnly size={theme.isTV ? 'compact' : 'small'}
            accessibilityLabel={t(isPlaylist ? 'web.saved.playlistOptions' : 'web.saved.collectionOptions')} accessibilityState={{expanded: pageMenu}} onPress={() => setPageMenu(true)}
            style={{width: theme.isTV ? 72 : 38, height: theme.isTV ? 72 : 38, borderRadius: theme.isTV ? 36 : 19}}/>
        </View>
      </View>
      <ScrollView contentContainerStyle={{paddingTop: insets.top + (theme.isTV ? 96 : 52), paddingBottom: 32 + insets.bottom}}>
        {stateError ? applyError(stateError) : !name ? <View style={{paddingVertical: 40}}><Text style={[theme.type.body, {color: theme.colors.textTertiary, textAlign: 'center'}]}>{t('saved.loading')}</Text></View> : <>
          <View style={theme.isTV ? {flexDirection: 'row', alignItems: 'flex-end', gap: 48, paddingHorizontal: theme.gutter, paddingTop: 16}
            : {alignItems: 'center', paddingHorizontal: theme.gutter, paddingTop: 40}}>
            <View style={{width: theme.isTV ? 280 : 152, height: theme.isTV ? 280 : 152, borderRadius: theme.isTV ? 16 : 14, overflow: 'hidden', backgroundColor: theme.colors.raised,
              flexDirection: 'row', flexWrap: 'wrap', gap: theme.isTV ? 3 : 2, alignSelf: theme.isTV ? undefined : 'center'}}>
              {artwork.slice(0, 4).map((path, index) => <Artwork key={`${path}:${index}`} source={runtime.artwork(path)} width={(theme.isTV ? 280 : 152) / 2 - 1} height={(theme.isTV ? 280 : 152) / 2 - 1}
                visible={active.visible} priority={index === 0} style={{borderRadius: 0}}/>)}
            </View>
            <View style={theme.isTV ? {flex: 1, minWidth: 0} : {alignItems: 'center', marginTop: 14}}>
              {eyebrow && <Text style={[browseType(theme, theme.isTV ? 24 : 13.5, 700), {color: theme.colors.accentStrong, marginBottom: theme.isTV ? 8 : 2}]}>{eyebrow}</Text>}
              <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, theme.isTV ? 72 : 30, 800, -.04, theme.isTV ? 70 : 32), {color: theme.colors.text, textAlign: theme.isTV ? 'left' : 'center'}]}>{name}</Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.isTV ? 20 : 12, marginTop: theme.isTV ? 12 : 6, justifyContent: theme.isTV ? 'flex-start' : 'center'}}>
                {countText && <Text style={[browseType(theme, theme.isTV ? 24 : 13, 600), {color: theme.colors.textSecondary}]}>{countText}</Text>}
                {!!duration && <Text style={[browseType(theme, theme.isTV ? 24 : 13), {color: theme.colors.textSecondary}]}>{savedDuration(duration)}</Text>}
                {!isPlaylist && visibility && resource?.role !== 'owner' && <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
                  <Icon name={visibility.icon} size={theme.isTV ? 22 : 13} color={visibility.strong ? theme.colors.accentStrong : theme.colors.textTertiary}/>
                  <Text style={[browseType(theme, theme.isTV ? 24 : 13, visibility.strong ? 700 : 500), {color: visibility.strong ? theme.colors.accentStrong : theme.colors.textTertiary}]}>{visibility.text}</Text>
                </View>}
              </View>
              {!!(isPlaylist ? playlist?.summary : resource?.summary) && <Text numberOfLines={theme.isTV ? 2 : 1} style={[browseType(theme, theme.isTV ? 22 : 13.5, 400, 0, theme.isTV ? 30 : 19.6),
                {color: theme.colors.textSecondary, textAlign: theme.isTV ? 'left' : 'center', marginTop: theme.isTV ? 10 : 6}]}>{isPlaylist ? playlist?.summary : resource?.summary}</Text>}
            </View>
          </View>
          {resource?.kind === 'collection' && resource.role === 'owner' && resource.actions.includes('update') && !theme.isTV && <View style={{paddingHorizontal: theme.gutter, paddingTop: 16, gap: 4}}>
            <Switch checked={resource.visibility === 'server'} disabled={busy || personal?.pending} onCheckedChange={next => run(async () => {await destination.mutatePersonal({action: 'update', visibility: next ? 'server' : 'private'});})}>
              {t('web.saved.visibleToAll')}
            </Switch>
            <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{savedVisibilityHelp(resource)}</Text>
          </View>}
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: theme.gutter, paddingTop: theme.isTV ? 24 : 14}}>
            <Button testID="saved-play" focusId="saved-play" variant="primary" icon="i-play" disabled={!playable.length}
              onPress={() => play()} style={theme.isTV ? {height: 72, minWidth: 220} : {height: 48, flex: 1}}>{t(theme.isTV && resource?.kind === 'collection' ? 'next.cards.playAll' : 'action.play')}</Button>
            <Button testID="saved-shuffle" focusId="saved-shuffle" variant="glass" icon="i-shuffle" iconOnly disabled={playable.length < 2} onPress={() => play(true)}
              accessibilityLabel={t('title.shuffle')} style={theme.isTV ? {width: 72, height: 72, borderRadius: 36} : {width: 48, height: 48, borderRadius: 24}}/>
            <Button testID="saved-pin" focusId="saved-pin" variant="glass" icon={playlist?.pinned || resource?.pinned ? 'i-bookmark-f' : 'i-bookmark'} iconOnly disabled={busy || !(isPlaylist ? playlist?.actions.includes('pin') : resource?.actions.includes('pin'))}
              onPress={pin} accessibilityLabel={t(playlist?.pinned || resource?.pinned ? 'pins.unpin' : 'pins.pin')}
              style={theme.isTV ? {width: 72, height: 72, borderRadius: 36} : {width: 48, height: 48, borderRadius: 24}}/>
            {canReorder && !theme.isTV && <Button testID="saved-reorder" focusId="saved-reorder" variant={reordering ? 'primary' : 'glass'} icon={reordering ? 'i-check' : 'i-updown'}
              onPress={() => setReordering(value => !value)}>{t(reordering ? 'order.done' : 'order.reorder')}</Button>}
          </View>
          {reordering && !theme.isTV && <Text style={[browseType(theme, 13), {color: theme.colors.textTertiary, marginHorizontal: theme.gutter, marginTop: 10}]}>{t('web.saved.visibleToAll') === '' ? '' : t('order.handle', {title: name})}</Text>}
          {(isPlaylist ? playlist?.actions.includes('reorder') : resource?.kind === 'collection' && resource.actions.includes('reorder')) && theme.isTV &&
            <View style={{paddingHorizontal: theme.gutter, paddingTop: 20}}><Text style={[browseType(theme, 22), {color: theme.colors.textTertiary}]}>{t('order.handle', {title: name})}</Text></View>}
          {(!theme.isTV || (!isPlaylist && resource?.kind === 'view')) && <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: theme.gutter, paddingTop: 14}}>
            {!isPlaylist && resource?.kind === 'view' ? <>
              <Chip focusId="saved-sort" icon="i-sort" onPress={() => setInfoOpen(true)}>{viewSortLabel(resource)}</Chip>
              <Chip focusId="saved-filters" icon="i-sliders" count={savedViewConditionCount(resource)} countStyle="badge" onPress={() => setInfoOpen(true)}>{t('next.browse.native.filters')}</Chip>
            </> : <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, opacity: .7}}><Icon name="i-sort" size={16} color={theme.colors.textTertiary}/>
              <Text style={[browseType(theme, 14.5, 700), {color: theme.colors.text}]}>{t('web.saved.sort.other')}</Text></View>}
            <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary, marginLeft: 'auto'}]}>{countText}</Text>
          </View>}
          {problem !== '' && <View style={{paddingHorizontal: theme.gutter, paddingTop: 12}}><Banner testID="saved-resource-problem" variant="notice" tone="error" placement="inline" message={problem}
            action={{label: t('action.dismiss'), onPress: () => setProblem('')}}/></View>}
          <View style={{marginTop: theme.isTV ? 24 : 8}}>
            {!rows.length && snapshot.phase !== 'loading' && <StateView variant={theme.isTV ? 'centered' : 'inline'} icon={isPlaylist ? 'i-queue' : 'i-stack'}
              title={t(isPlaylist ? 'web.saved.playlistEmpty' : resource?.kind === 'view' ? 'web.saved.viewEmpty' : 'web.saved.collectionEmpty')}
              body={isPlaylist ? t('web.saved.playlistEmptyBody') : undefined}/>}
            {!isPlaylist && resource?.kind === 'view'
              ? <SavedResourceViewGrid entries={media} runtime={runtime} actions={actions} tv={theme.isTV} windowWidth={theme.isTV ? 1920 : dimensions.width} gutter={theme.gutter}/>
              : rows.map(row => <SavedResourceRow key={row.id} row={row} width={width} runtime={runtime} actions={actions} library={savedLibraryName(libraries, row.media.libraryId)}
                canReorder={canReorder && reordering} onMore={() => setRowMenu({entry: row.media, entryId: row.id})}/>)}
            {!!(isPlaylist ? saved?.pagination.next.length : personal?.nextCursor) && <View style={{alignItems: 'center', paddingVertical: 16}}>
              <Button variant="glass" size="compact" onPress={() => {void destination.next(isPlaylist ? saved?.pagination.next[0]?.sectionId : undefined).catch(report);}}>{t('action.showMore')}</Button>
            </View>}
          </View>
        </>}
      </ScrollView>
    </FocusRegion>
    <Menu open={pageMenu} onOpenChange={setPageMenu} presentation={theme.isTV ? 'sideSheet' : 'sheet'} title={t(isPlaylist ? 'web.saved.playlistOptions' : 'web.saved.collectionOptions')}
      items={menuItems} testID="saved-resource-page-menu"/>
    <Menu open={!!rowMenu} onOpenChange={open => {if (!open) setRowMenu(undefined);}} presentation={theme.isTV ? 'sideSheet' : 'sheet'} title={rowMenu?.entry.title ?? ''}
      secondaryTitle={rowMenu ? <View style={{flexDirection: 'row', gap: 8}}>{[t('title.kind', {kind: rowMenu.entry.kind}), savedLibraryName(libraries, rowMenu.entry.libraryId)].filter(Boolean).map(part =>
        <Text key={part} style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{part}</Text>)}</View> : undefined}
      items={rowMenu ? rowMenuEntries(rowMenu) : []} testID="saved-resource-row-menu"/>
    <SavedNameSheet open={renaming} title={t(isPlaylist ? 'web.saved.renamePlaylist' : resource?.kind === 'view' ? 'web.saved.renameView' : 'web.saved.renameCollection')}
      action={t('action.save')} initialName={name} initialSummary={isPlaylist ? playlist?.summary : resource?.summary} withSummary={isPlaylist ? playlist?.actions.includes('summary') === true : true}
      busy={busy} error={problem || undefined} testID="saved-rename" onClose={() => setRenaming(false)} onSave={saveName}/>
    <BottomSheet open={infoOpen} onOpenChange={setInfoOpen} title={t('web.saved.savedView')} testID="saved-view-info" fitContent>
      <View style={{gap: 10}}>
        <Text style={[browseType(theme, 15, 700), {color: theme.colors.text}]}>{resource ? viewSortLabel(resource) : ''}</Text>
        {!!(resource?.summary) && <Text style={[browseType(theme, 14, 400, 0, 21), {color: theme.colors.textSecondary}]}>{resource.summary}</Text>}
        <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('next.saved.viewsHelp')}</Text>
      </View>
    </BottomSheet>
    <SavedConfirmSheet open={deleting} title={t('web.saved.deleteTitle', {name: name ?? ''})}
      body={t(isPlaylist ? 'web.saved.deletePlaylistBody' : resource?.kind === 'view' ? 'web.saved.deleteViewBody' : 'web.saved.deleteCollectionBody')}
      action={t(isPlaylist ? 'web.saved.deletePlaylistAction' : resource?.kind === 'view' ? 'web.saved.deleteViewAction' : 'web.saved.deleteCollectionAction')}
      busy={busy} error={problem || undefined} testID="saved-delete" onClose={() => setDeleting(false)} onConfirm={confirmDelete}/>
    {theme.isTV ? toast?.action && <View style={{position: 'absolute', left: theme.gutter, right: theme.gutter, bottom: 80}} pointerEvents="box-none">
      <Banner variant="notice" tone="info" placement="overlay" message={toast.message} action={{label: toast.action.label, onPress: toast.action.onPress}} visible/>
    </View> : <ToastHost toast={toast} onDismiss={() => setToast(null)} bottomOffset={0}/>}
  </View>;
}

function viewSortLabel(resource: PersonalResource): string {
  const sort = resource.definition?.sort?.[0];
  if (!sort) return t('web.saved.sort.other');
  return t(sortFieldId(sort.field));
}

function sortFieldId(field: string): 'web.saved.sort.title' | 'web.saved.sort.added' | 'web.saved.sort.recent' | 'web.saved.sort.year' | 'web.saved.sort.duration' | 'web.saved.sort.progress' | 'web.saved.sort.other' {
  if (field === 'title' || field === 'sort_title') return 'web.saved.sort.title';
  if (field === 'added' || field === 'added_at') return 'web.saved.sort.added';
  if (field === 'last_played' || field === 'recent') return 'web.saved.sort.recent';
  if (field === 'year') return 'web.saved.sort.year';
  if (field === 'duration') return 'web.saved.sort.duration';
  if (field === 'progress') return 'web.saved.sort.progress';
  return 'web.saved.sort.other';
}

/** A saved view is a browse result, so its body is the library grid rather than
 * the playlist row list (collections.html 13a and 21). */
function SavedResourceViewGrid({entries, runtime, actions, tv, windowWidth, gutter}: {
  entries: readonly ContentEntry[]; runtime: NativeShellRuntime; actions: NativeSavedEntryActions; tv: boolean; windowWidth: number; gutter: number;
}) {
  const columns = tv ? 7 : 3, gap = tv ? 26 : 10, width = (windowWidth - gutter * 2 - gap * (columns - 1)) / columns;
  return <View style={{flexDirection: 'row', flexWrap: 'wrap', gap, paddingHorizontal: gutter}}>{entries.map(entry => {
    const text = homeCardText(entry, false, runtime.text), square = ['album', 'song', 'book', 'audiobook_file'].includes(entry.kind);
    const progress = entry.duration && entry.progressSeconds ? Math.min(1, entry.progressSeconds / entry.duration) : undefined;
    const props = {testID: `saved-view-entry-${encodeURIComponent(entry.id)}`, focusId: `saved-view-entry-${entry.id}`, title: entry.displayTitle || entry.title,
      caption: text.caption, artwork: runtime.artwork(entry.posterUrl), progress, watched: entry.watched, width,
      onNavigate: () => actions.open(entry), onPlay: entry.playback ? () => actions.play(entry) : undefined, onMore: () => actions.menu(entry),
      moreExpanded: actions.isMenuOpen?.(entry)};
    return square ? <SquareCard key={entry.id} {...props}/> : <PosterCard key={entry.id} {...props}/>;
  })}</View>;
}

/** The frame's list row: art with its progress line, the title, what it is, the
 * library and its time left, and the row's own menu. */
function SavedResourceRow({row, width, runtime, actions, library, canReorder, onMore}: {
  row: Row; width: number; runtime: NativeShellRuntime; actions: NativeSavedEntryActions; library?: string; canReorder: boolean; onMore: () => void;
}) {
  const theme = useTheme(), entry = row.media, square = ['album', 'song', 'book', 'audiobook_file'].includes(entry.kind);
  const text = homeCardText(entry, false, runtime.text);
  const watched = entry.watched === true, progress = entry.duration && entry.progressSeconds ? Math.min(1, entry.progressSeconds / entry.duration) : undefined;
  const remaining = entry.duration && entry.progressSeconds && !watched ? savedDuration(Math.max(0, entry.duration - entry.progressSeconds)) : undefined;
  return <CardFrame testID={`saved-row-${encodeURIComponent(row.id)}`} focusId={`saved-row-${row.id}`} title={entry.title} width={width} onNavigate={() => actions.open(entry)}
    onPlay={entry.playback ? () => actions.play(entry) : undefined} onMore={onMore} moreExpanded={actions.isMenuOpen?.(entry)}
    pressableStyle={{height: theme.isTV ? 104 : 80, borderRadius: theme.isTV ? 16 : 10, justifyContent: 'center'}}>
    {() => <View style={{height: theme.isTV ? 104 : 80, flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 28 : 12, paddingHorizontal: theme.isTV ? 20 : 4}}>
      {canReorder && <Icon name="i-drag" size={theme.isTV ? 28 : 20} color={theme.colors.textTertiary}/>}
      <View style={{width: theme.isTV ? 76 : 48, height: theme.isTV ? 76 : square ? 56 : 72, alignItems: 'center', justifyContent: 'center'}}>
        <MediaArt kind={square ? 'square' : 'poster'} source={runtime.artwork(entry.posterUrl)} width={theme.isTV ? (square ? 76 : 51) : square ? 56 : 48}
          height={theme.isTV ? 76 : square ? 56 : 72} style={{borderRadius: theme.isTV ? 7 : 6}}/>
        {progress !== undefined && <View style={{position: 'absolute', left: theme.isTV ? 15 : 4, right: theme.isTV ? 15 : 4, bottom: theme.isTV ? 0 : 4, height: theme.isTV ? 5 : 3,
          borderRadius: 5, backgroundColor: alpha(theme.colors.ink, .7), overflow: 'hidden'}}><View style={{height: '100%', width: `${progress * 100}%`, backgroundColor: theme.colors.accentStrong}}/></View>}
      </View>
      <View style={{flex: 1, minWidth: 0, gap: 3}}>
        <Text numberOfLines={1} style={[browseType(theme, theme.isTV ? 28 : 15.5, 700, -.01), {color: theme.colors.text}]}>{entry.displayTitle || entry.title}</Text>
        <Parts parts={text.caption} style={[browseType(theme, theme.isTV ? 22 : 12.5, 400), {color: theme.colors.textTertiary}]}/>
        {(watched || remaining) && <Text numberOfLines={1} style={[browseType(theme, theme.isTV ? 22 : 12.5, 700), {color: watched ? theme.colors.textTertiary : theme.colors.accentStrong}]}>
          {watched ? t('saved.watched') : remaining}
        </Text>}
      </View>
      {theme.isTV && <Text numberOfLines={1} style={[browseType(theme, 22), {color: theme.colors.textTertiary, width: 360}]}>{library ?? ''}</Text>}
      {!theme.isTV && library && <Text numberOfLines={1} style={[browseType(theme, 12.5), {color: theme.colors.textTertiary, maxWidth: 96, textAlign: 'right'}]}>{library}</Text>}
      <Focusable testID={`saved-row-more-${encodeURIComponent(row.id)}`} focusId={`saved-row-more-${row.id}`} accessibilityRole="button" accessibilityLabel={t('card.more', {title: entry.title})}
        onPress={onMore} style={{width: theme.isTV ? 56 : 40, height: theme.isTV ? 56 : 40, alignItems: 'center', justifyContent: 'center'}}>
        <Icon name="i-more" size={theme.isTV ? 30 : 20} color={theme.colors.textTertiary}/>
      </Focusable>
      <View pointerEvents="none" style={{position: 'absolute', left: theme.isTV ? 20 : 20, right: theme.isTV ? 20 : 4, bottom: 0, height: 1, backgroundColor: alpha(theme.colors.line, theme.isTV ? .55 : .3)}}/>
    </View>}
  </CardFrame>;
}
