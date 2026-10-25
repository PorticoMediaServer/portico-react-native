import React, {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
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
import {sameAuthority, type ShellAuthority} from '../../shell/model';
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
  changed?: () => void;
}>;

type Row = Readonly<{id: string; media: ContentEntry}>;
/** One row-sheet opening: what it names, the route it belongs to, and the row focus it took
 * once when it opened, so no later move can pull focus to a row the person has left. */
type RowMenu = Readonly<{entry: ContentEntry; entryId: string; route: SavedRoute; focus?: 'open' | 'up' | 'down'}>;
type Command = 'done' | 'failed' | 'busy' | 'stale';
/** The page a command started on: its epoch (which moves with the route) and its authority. */
type PageWitness = Readonly<{epoch: number; authority: ShellAuthority}>;

/** The page's membership rows, from whichever snapshot the caller holds: the render and a
 * command dispatched later must both read the same thing. */
function membershipRows(isPlaylist: boolean, state: Readonly<{saved?: SavedSnapshot; personal?: PersonalSavedSnapshot}>): readonly Row[] {
  return isPlaylist
    ? (state.saved?.projection?.sections ?? []).flatMap(section => section.entries.flatMap(entry => entry.kind === 'playlist_entry' && !entry.hidden ? [{id: entry.id, media: entry.media}] : []))
    : (state.personal?.entries ?? []).flatMap(entry => !entry.hidden && entry.media ? [{id: entry.id, media: entry.media}] : []);
}

/** collections.html 11a–13c and 18–20. The page reads the actual Saved route
 * through its canonical service; commands go back through the same service. */
export function SavedResourceScreen({route, destination, activation, runtime, actions, libraries, back, changed}: NativeSavedResourceProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot);
  const snapshot = useSyncExternalStore(destination.subscribe, destination.getSnapshot);
  useSyncExternalStore(actions.menuState?.subscribe ?? (() => () => {}), actions.menuState?.getSnapshot ?? (() => 0));
  const [pageMenu, setPageMenu] = useState(false), [rowMenuState, setRowMenuState] = useState<RowMenu>(), [renaming, setRenaming] = useState(false), [deleting, setDeleting] = useState(false);
  const [reordering, setReordering] = useState(false), [infoOpen, setInfoOpen] = useState(false), [problem, setProblem] = useState<string>(), [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null), toastId = useRef(0);
  /** The opening this screen is showing, retired by identity so a late result or a second
   * press can only ever act on the sheet it came from; `epoch` moves with the route so a
   * command started on one page cannot report onto the next. */
  const opening = useRef<RowMenu | undefined>(undefined), flight = useRef<Readonly<{token: object}> | undefined>(undefined);
  const mounted = useRef(true), epoch = useRef(0), shownRoute = useRef(route);
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false; opening.current = undefined; flight.current = undefined;};}, []);
  useEffect(() => {void destination.select(route).catch(runtime.reportError);}, [destination, route, runtime]);
  useEffect(() => {setPageMenu(false); setRenaming(false); setDeleting(false); setReordering(false); setProblem(''); setBusy(false);}, [route]);
  const saved = snapshot.saved as SavedSnapshot | undefined, personal = snapshot.personal as PersonalSavedSnapshot | undefined;
  const playlist = saved?.playlist ?? null, resource = personal?.resource ?? null, isPlaylist = route.view === 'playlist';
  // A sheet and a command belong to exactly one route. A route change retires both here, at
  // render, so nothing the old page started survives it by even one frame.
  if (shownRoute.current !== route) {shownRoute.current = route; epoch.current += 1; opening.current = undefined; flight.current = undefined;}
  // An opening belongs to the route it was made on: a different page never draws it.
  const rowMenu = rowMenuState?.route === route ? rowMenuState : undefined;
  const rows: readonly Row[] = useMemo(() => membershipRows(isPlaylist, snapshot), [isPlaylist, snapshot]);
  const media = rows.map(row => row.media), playable = media.filter(entry => !!entry.playback && entry.available !== false && !entry.missing);
  const count = isPlaylist ? playlist?.entryCount : resource?.entryCount;
  const countText = isPlaylist ? savedItemCount(count) : savedTitleCount(count);
  const duration = exactDurationSeconds(media), artwork = isPlaylist ? playlistEntryMosaic((saved?.projection?.sections ?? []).flatMap(section => section.entries).filter((entry): entry is PlaylistOccurrence => entry.kind === 'playlist_entry')) : personalMosaic(resource);
  const name = isPlaylist ? playlist?.name : resource?.name;
  const eyebrow = isPlaylist ? savedPlaylistEyebrow : resource ? savedResourceEyebrow(resource) : undefined;
  const canReorder = reordering || (isPlaylist ? playlist?.actions.includes('reorder') === true : resource?.kind === 'collection' && resource.actions.includes('reorder') === true);
  const visibility = resource?.kind === 'collection' ? savedVisibility(resource) : undefined;
  const report = (error: unknown) => runtime.reportError(error);
  /** The page a command started on, as a witness; `still` also knows its command is the one in
   * flight. A completion that lands late — a toast, a sheet closing, Back — can tell it is no
   * longer on its own page and leaves the successor alone. */
  const witness = (): PageWitness => ({epoch: epoch.current, authority: runtime.getSnapshot().authority});
  const onPage = (at: PageWitness): boolean => mounted.current && epoch.current === at.epoch
    && sameAuthority(runtime.getSnapshot().authority, at.authority) && activation.getSnapshot().visible;
  /** One command at a time, refused synchronously: a held remote OK repeats faster than a
   * render can disable the row it is on. The work is handed a witness, so a completion that
   * lands late — a toast, a sheet closing, Back — can tell it is no longer on its own page. */
  const run = async (work: (still: () => boolean) => Promise<unknown>): Promise<Command> => {
    if (flight.current) return 'busy';
    const token = {}, at = witness();
    flight.current = {token};
    setBusy(true); setProblem('');
    const current = () => onPage(at) && flight.current?.token === token;
    try {await work(current); if (!current()) return 'stale'; changed?.(); return 'done';}
    catch (error) {if (!current()) return 'stale'; setProblem(presentError(error, 'saved', {operation: 'save'}).body); return 'failed';}
    finally {if (flight.current?.token === token) {flight.current = undefined; if (mounted.current && epoch.current === at.epoch) setBusy(false);}}
  };
  /** The page as the server last stated it, for a sheet that has outlived a refresh. */
  const page = () => {
    const state = destination.getSnapshot();
    return {rows: membershipRows(isPlaylist, state), playlist: state.saved?.playlist ?? null, resource: state.personal?.resource ?? null};
  };
  /** A press acts only from the exact opening that drew it, while this page is on screen. */
  const openingLive = (menu: RowMenu): boolean =>
    mounted.current && opening.current === menu && menu.route === route && activation.getSnapshot().visible;
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
  /** Retires this exact opening. A press from a sheet that has since been replaced or
   * unmounted can only ever touch the opening it was drawn from. */
  const closeOpening = (target: RowMenu) => {
    if (opening.current !== target) return;
    opening.current = undefined;
    if (mounted.current) setRowMenuState(current => current === target ? undefined : current);
  };
  const remove = (menu: RowMenu) => {
    if (!openingLive(menu)) return;
    const live = page(), index = live.rows.findIndex(value => value.id === menu.entryId);
    const removable = isPlaylist ? live.playlist?.actions.includes('remove') === true
      : live.resource?.kind === 'collection' && live.resource.role !== 'viewer' && live.resource.actions.includes('entries') === true;
    // The row, and the action on it, are checked against the page as it is now.
    if (index < 0 || !removable) {closeOpening(menu); return;}
    const row = live.rows[index]!;
    closeOpening(menu);
    void run(async still => {
      if (isPlaylist) {
        await destination.mutateSaved({action: 'remove', entryId: row.id});
        const token = destination.getSnapshot().saved?.lastReceipt?.undoToken;
        if (token && still()) showUndo(t('saved.removal.fromPlaylist', {title: row.media.title}), () => destination.mutateSaved({action: 'restore', undoToken: token}), t('saved.removal.fromPlaylist', {title: row.media.title}));
      } else {
        await destination.mutatePersonal({action: 'entries', removeEntryIds: [row.id]});
        const undo = destination.getSnapshot().personal?.result?.undo;
        if (undo && still()) showUndo(t('saved.removal.fromCollection', {title: row.media.title}), () => destination.mutatePersonal({action: 'entries', undoToken: undo.token}), t('saved.removal.fromCollection', {title: row.media.title}));
      }
    });
  };
  /** The toast's Undo belongs to the page that created it and to that one toast: the press
   * never dispatches from a successor page, and a late result never clears or replaces a newer
   * toast on the same page. */
  const showUndo = (message: string, undo: () => Promise<unknown>, failure: string) => {
    const id = String(++toastId.current), at = witness();
    setToast({id, message, action: {label: t('action.undo'), onPress: () => {
      if (!onPage(at)) return;
      const settle = (next: () => ToastMessage | null) => {if (onPage(at)) setToast(current => current?.id === id ? next() : current);};
      void undo().then(() => settle(() => null)).catch(() => settle(() => ({id: `${id}-failed`, message: failure})));
    }}});
  };
  /** collections.html 19: a TV playlist's sheet stays open so Move up and Move down can be
   * pressed again, and a failed move closes the sheet it was pressed from so the page's own
   * problem line is read. collections.html 20 leaves a collection's order to the other
   * clients. */
  const move = (menu: RowMenu, where: 'up' | 'down' | 'top' | 'bottom') => {
    if (!openingLive(menu)) return;
    const keepSheetOpen = theme.isTV && isPlaylist, live = page();
    const ids = live.rows.map(value => value.id), index = live.rows.findIndex(value => value.id === menu.entryId);
    const reorderable = isPlaylist ? live.playlist?.actions.includes('reorder') === true
      : live.resource?.kind === 'collection' && live.resource.actions.includes('reorder') === true;
    // The membership row and the reorder it asks for are the current page's, not the render's.
    if (index < 0 || !reorderable) {closeOpening(menu); return;}
    const row = live.rows[index]!;
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
    }).then(result => {if (result === 'failed' && keepSheetOpen) closeOpening(menu);});
  };
  const saveName = (input: {name: string; summary: string; visibility: 'private' | 'server'}) => {
    void run(async still => {
      if (isPlaylist) await destination.mutateSaved({action: 'rename', name: input.name, ...(playlist?.actions.includes('summary') ? {summary: input.summary} : {})});
      else await destination.mutatePersonal({action: 'update', name: input.name, summary: input.summary});
      if (still()) setRenaming(false);
    });
  };
  const confirmDelete = () => {
    void run(async still => {
      if (isPlaylist) await destination.mutateSaved({action: 'delete'});
      else await destination.mutatePersonal({action: 'delete'});
      // A delete that finishes after the person has left closes nothing, goes back nowhere and
      // refreshes nothing: the successor page keeps its own sheets and its own history.
      if (!still()) return;
      changed?.(); setDeleting(false); back();
    });
  };
  const rowMenuEntries = (menu: RowMenu): readonly MenuEntry[] => {
    const index = rows.findIndex(row => row.id === menu.entryId), last = rows.length - 1;
    // collections.html 19 draws Move up and Move down only, presses of which keep the sheet
    // open; collections.html 20 keeps a collection's order off the TV menu entirely. Each
    // press re-checks the current page before it dispatches, and none of them fire twice.
    const tvMoves = theme.isTV && isPlaylist, moves = canReorder && (isPlaylist || !theme.isTV);
    return [
      {id: 'open', label: t('web.saved.goToItem'), icon: 'i-info', onSelect: () => {if (!openingLive(menu)) return; closeOpening(menu); actions.open(menu.entry);}},
      ...(moves && !tvMoves ? [
        {id: 'top', label: t('order.moveTop'), icon: 'i-up', disabled: index <= 0, onSelect: () => move(menu, 'top')},
        {id: 'up', label: t('player.queueMoveUp'), icon: 'i-up', disabled: index <= 0, onSelect: () => move(menu, 'up')},
        {id: 'down', label: t('player.queueMoveDown'), icon: 'i-down', disabled: index < 0 || index >= last, onSelect: () => move(menu, 'down')},
        {id: 'bottom', label: t('order.moveBottom'), icon: 'i-down', disabled: index < 0 || index >= last, onSelect: () => move(menu, 'bottom')},
      ] as const : []),
      // A TV sheet keeps its move rows attached while a command runs: disabling the row the
      // person is on would move focus away from it. The flight refusal above is the guard.
      ...(moves && tvMoves ? [
        {id: 'up', label: t('player.queueMoveUp'), icon: 'i-up', disabled: index <= 0, closeOnSelect: false, onSelect: () => move(menu, 'up')},
        {id: 'down', label: t('player.queueMoveDown'), icon: 'i-down', disabled: index < 0 || index >= last, closeOnSelect: false, onSelect: () => move(menu, 'down')},
      ] as const : []),
      // The page's current membership row, not the object captured when the sheet opened: the
      // refresh after each move replaces the projection's objects while the sheet stays open.
      ...(index >= 0 && (isPlaylist ? playlist?.actions.includes('remove') : resource?.kind === 'collection' && resource.role !== 'viewer' && resource.actions.includes('entries'))
        ? [{id: 'remove', separator: true as const}, {id: 'remove-entry', label: t(isPlaylist ? 'web.saved.removeFromPlaylist' : 'web.saved.removeFromCollection'), icon: 'i-trash' as const, destructive: true, disabled: busy, onSelect: () => remove(menu)}]
        : []),
    ];
  };
  const openRowMenu = (row: Row) => {
    const index = rows.findIndex(value => value.id === row.id), last = rows.length - 1;
    // collections.html 19 opens on Move down; the choice belongs to this one opening, so a
    // later move never pulls focus back to a row the person has already left.
    const next: RowMenu = {entry: row.media, entryId: row.id, route,
      ...(theme.isTV && isPlaylist && canReorder ? {focus: index < last ? 'down' as const : index > 0 ? 'up' as const : 'open' as const} : {})};
    opening.current = next;
    setRowMenuState(next);
  };
  const menuItems: readonly MenuEntry[] = (() => {
    const items: MenuEntry[] = [], pinned = playlist?.pinned === true || resource?.pinned === true;
    // collections.html 20 and 21: a personal collection or saved view is renamed and deleted
    // on a phone, tablet or browser, so the TV page menu keeps Pin alone.
    const changeableHere = !(theme.isTV && resource);
    if (isPlaylist ? playlist?.actions.includes('pin') : resource?.actions.includes('pin')) items.push({id: 'pin', label: t(pinned ? 'pins.unpin' : 'pins.pin'),
      icon: pinned ? 'i-bookmark-f' : 'i-bookmark', onSelect: () => {setPageMenu(false); pin();}});
    if (changeableHere && (isPlaylist ? playlist?.actions.includes('rename') : resource?.actions.includes('update'))) items.push({id: 'rename', label: t('web.saved.rename'),
      icon: 'i-edit', onSelect: () => {setPageMenu(false); setRenaming(true);}});
    if (changeableHere && (isPlaylist ? playlist?.actions.includes('delete') : resource?.actions.includes('delete'))) items.push({id: 'delete',
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
      {theme.isTV ? null : <View pointerEvents="box-none" style={{position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, paddingTop: insets.top, height: insets.top + 52,
        paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center'}}>
        <Focusable focusId="saved-back" testID="saved-resource-back" accessibilityRole="button" accessibilityLabel={t('saved.title')} onPress={back}
          style={{width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(theme.colors.ink, .45)}}>
          <Icon name="i-left" size={22} color={theme.colors.text}/>
        </Focusable>
        <View style={{marginLeft: 'auto'}}>
          <Button testID="saved-resource-menu" focusId="saved-resource-menu" variant="glass" icon="i-more" iconOnly size="small"
            accessibilityLabel={t(isPlaylist ? 'web.saved.playlistOptions' : 'web.saved.collectionOptions')} accessibilityState={{expanded: pageMenu}} onPress={() => setPageMenu(true)}
            style={{width: 38, height: 38, borderRadius: 19}}/>
        </View>
      </View>}
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
                {!isPlaylist && visibility && (theme.isTV || resource?.role !== 'owner') && <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
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
          <View style={{flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 18 : 10, paddingHorizontal: theme.gutter, paddingTop: theme.isTV ? 24 : 14}}>
            <Button testID="saved-play" focusId="saved-play" variant="primary" icon="i-play" disabled={!playable.length}
              onPress={() => play()} style={theme.isTV ? undefined : {height: 48, flex: 1}}>{t(theme.isTV && resource?.kind === 'collection' ? 'next.cards.playAll' : 'action.play')}</Button>
            {/* collections.html 18/20 draw Shuffle and Pin as labelled glass buttons, and More as
                a 72 by 14-radius square: the kit's hero glass button is that geometry already. */}
            <Button testID="saved-shuffle" focusId="saved-shuffle" variant="glass" icon="i-shuffle" iconOnly={!theme.isTV} disabled={playable.length < 2} onPress={() => play(true)}
              accessibilityLabel={t('title.shuffle')} style={theme.isTV ? undefined : {width: 48, height: 48, borderRadius: 24}}>{t('title.shuffle')}</Button>
            <Button testID="saved-pin" focusId="saved-pin" variant="glass" icon={playlist?.pinned || resource?.pinned ? 'i-bookmark-f' : 'i-bookmark'} iconOnly={!theme.isTV} disabled={busy || !(isPlaylist ? playlist?.actions.includes('pin') : resource?.actions.includes('pin'))}
              onPress={pin} accessibilityLabel={t(playlist?.pinned || resource?.pinned ? 'pins.unpin' : 'pins.pin')}
              style={theme.isTV ? undefined : {width: 48, height: 48, borderRadius: 24}}>{t(playlist?.pinned || resource?.pinned ? 'pins.unpin' : 'pins.pin')}</Button>
            {theme.isTV && <Button testID="saved-resource-menu" focusId="saved-resource-menu" variant="glass" icon="i-more" iconOnly
              accessibilityLabel={t(isPlaylist ? 'web.saved.playlistOptions' : 'web.saved.collectionOptions')} accessibilityState={{expanded: pageMenu}}
              onPress={() => setPageMenu(true)} style={{width: 72, height: 72, borderRadius: 14}}/>}
            {canReorder && !theme.isTV && <Button testID="saved-reorder" focusId="saved-reorder" variant={reordering ? 'primary' : 'glass'} icon={reordering ? 'i-check' : 'i-updown'}
              onPress={() => setReordering(value => !value)}>{t(reordering ? 'order.done' : 'order.reorder')}</Button>}
          </View>
          {reordering && !theme.isTV && <Text style={[browseType(theme, 13), {color: theme.colors.textTertiary, marginHorizontal: theme.gutter, marginTop: 10}]}>{t('web.saved.visibleToAll') === '' ? '' : t('order.handle', {title: name})}</Text>}
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
                canReorder={canReorder && reordering} onMore={() => openRowMenu(row)}/>)}
            {!!(isPlaylist ? saved?.pagination.next.length : personal?.nextCursor) && <View style={{alignItems: 'center', paddingVertical: 16}}>
              <Button variant="glass" size="compact" onPress={() => {void destination.next(isPlaylist ? saved?.pagination.next[0]?.sectionId : undefined).catch(report);}}>{t('action.showMore')}</Button>
            </View>}
          </View>
        </>}
      </ScrollView>
    </FocusRegion>
    <Menu open={pageMenu} onOpenChange={setPageMenu} presentation={theme.isTV ? 'sideSheet' : 'sheet'} title={t(isPlaylist ? 'web.saved.playlistOptions' : 'web.saved.collectionOptions')}
      items={menuItems} testID="saved-resource-page-menu"/>
    <Menu open={!!rowMenu} onOpenChange={open => {if (!open && rowMenu) closeOpening(rowMenu);}} presentation={theme.isTV ? 'sideSheet' : 'sheet'} title={rowMenu?.entry.title ?? ''}
      secondaryTitle={rowMenu ? <View style={{flexDirection: 'row', gap: 8}}>{[t('title.kind', {kind: rowMenu.entry.kind}), savedLibraryName(libraries, rowMenu.entry.libraryId)].filter(Boolean).map(part =>
        <Text key={part} style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{part}</Text>)}</View> : undefined}
      items={rowMenu ? rowMenuEntries(rowMenu) : []} initialFocusId={rowMenu?.focus} testID="saved-resource-row-menu"/>
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
