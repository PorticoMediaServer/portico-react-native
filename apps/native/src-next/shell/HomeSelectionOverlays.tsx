import React, {useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../packages/i18n/src';
import type {HomeSelectionController} from '../../../../packages/client-core/src/home-selection/index';
import type {EntryActionId} from '../../../../packages/client-core/src/presentation/entry-actions';
import type {SelectionKind} from '../../../../packages/client-core/src/selection-model/index';
import {presentError} from '../../../../packages/client-core/src/presentation/errors';
import {Menu, Dialog, type MenuEntry} from '../kit/overlays';
import {DeleteMediaDialog, MixedEditExplainer} from '../kit/selection';
import {Button} from '../kit/controls/Button';
import {Focusable} from '../kit/controls/Focusable';
import {Artwork} from '../kit/artwork';
import {Icon, type IconName} from '../kit/Icon';
import {useTheme} from '../kit/theme';
import {selectionHaptic} from '../platform/haptics';
import {memberTitle} from './selection-display';
import {HomeDestinationPicker} from './HomeDestinationPicker';
import {HomeBulkEditor} from './HomeBulkEditor';
import type {NativeShellRuntime} from './runtime';

const t = defaultI18n.t;
const icons: Record<EntryActionId, IconName> = {play: 'i-play', resume: 'i-play', playFromStart: 'i-restart', playNext: 'i-listplus', addToQueue: 'i-queue',
  watchWithGroup: 'i-people', addToGroupQueue: 'i-queue', watchlist: 'i-bookmark', favorite: 'i-heart', watched: 'i-check', removeFromContinueWatching: 'i-x', notInterested: 'i-eyeoff', rate: 'i-star',
  addToPlaylist: 'i-listplus', addToCollection: 'i-layers', download: 'i-download', details: 'i-info', editMetadata: 'i-edit', refreshMetadata: 'i-refresh', separateArtist: 'i-link', delete: 'i-trash'};
const kindIcon = (kind: SelectionKind): IconName => kind === 'movie' ? 'i-film' : kind === 'show' || kind === 'season' || kind === 'episode' ? 'i-tvlib'
  : kind === 'song' || kind === 'album' || kind === 'artist' ? 'i-music' : kind === 'channel' ? 'i-tv' : kind === 'person' ? 'i-person' : 'i-book';

/** One controlled overlay tree, using the shared controller's genuine retained members. */
export function HomeSelectionOverlays({controller, runtime, ownerTag, reportError}: {
  controller: HomeSelectionController; runtime?: NativeShellRuntime; ownerTag: React.ReactNode; reportError: (error: unknown) => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme();
  if (!runtime) return null;
  const members = state.displayMembers, count = members.length;
  const error = (value: {code: string} | null) => value ? presentError(value, 'home', {operation: 'action'}).body : undefined;
  const items: MenuEntry[] = [];
  for (const group of state.menu?.groups ?? []) {
    if (items.length) items.push({id: `separator:${group.id}`, separator: true});
    if (group.title) items.push({id: `group:${group.id}`, section: true, label: t(group.title), tone: group.id === 'manage' ? 'owner' : 'default'});
    for (const action of group.actions) items.push({id: action.id, label: t(action.label), icon: icons[action.id], selected: action.selected, destructive: action.destructive,
      tone: group.id === 'manage' ? 'owner' : 'default', onSelect: () => {void controller.executeMenu(action.id).catch(reportError);}});
  }
  if (state.menu) {
    const menu = state.menu;
    items.push({id: 'selection-separator', separator: true}, {id: 'select', label: t('next.selection.select'), icon: 'i-check', onSelect: () => {
      const before = controller.getSnapshot().selection.active;
      controller.closeMenu();
      const result = controller.toggle(menu.windowId, menu.key);
      if (result.ok && !before && controller.getSnapshot().selection.active) void selectionHaptic().catch(reportError);
    }});
  }
  const typeCounts = new Map<SelectionKind, number>();
  for (const member of members) typeCounts.set(member.item.kind, (typeCounts.get(member.item.kind) ?? 0) + 1);
  const groups = [...typeCounts].map(([kind, total]) => ({kind, count: total, label: t('next.home.native.selectionType', {kind}), icon: kindIcon(kind)}));
  const description = state.editExplanation === 'no-bulk-fields'
    ? t('next.selection.native.noBulkFields')
    : t('next.home.native.mixedSelection', {types: defaultI18n.list([...typeCounts].map(([kind, total]) => t('next.home.native.selectedType', {kind, count: total})))});
  const rating = state.rating;
  const ratingTitle = members[0] && memberTitle(members[0], runtime);
  const mutation = (value: number | null) => {controller.setRatingValue(value); void controller.submitRating().catch(reportError);};
  return <>
    <Menu open={!!state.menu} onOpenChange={open => {if (!open) controller.closeMenu();}} title={state.menu ? memberTitle(state.menu.member, runtime) : undefined}
      items={items} presentation={theme.isTV ? 'sideSheet' : 'sheet'}/>
    <HomeDestinationPicker controller={controller} runtime={runtime} reportError={reportError}/>
    <HomeBulkEditor controller={controller} runtime={runtime} reportError={reportError}/>
    <MixedEditExplainer open={state.mixedEdit} onOpenChange={open => {if (!open) controller.closeEditor();}} description={description} total={count} groups={groups}
      onKeepOnly={kind => {controller.keepOnly(kind as SelectionKind);}}/>
    {state.deletion && <DeleteMediaDialog open onOpenChange={open => {if (!open) controller.closeDelete();}} ownerHeader={ownerTag}
      owner={runtime.getSnapshot().account.viewerRole === 'owner'} selectionCount={count} preview={state.deletion.preview} loading={state.deletion.phase === 'loading'} error={error(state.deletion.error)}
      result={state.deletion.result ?? undefined} confirmation={state.deletion.confirmation} onConfirmationChange={value => controller.setDeleteConfirmation(value)}
      removeFiles={state.deletion.removeFiles} onRemoveFilesChange={value => controller.setDeleteRemoveFiles(value)} pending={state.deletion.phase === 'deleting'}
      onDelete={() => {void controller.confirmDelete().catch(reportError);}} renderArtwork={id => {
        const member = members.find(value => 'id' in value.item && value.item.id === id), source = runtime.artwork(member?.entry?.posterUrl);
        return source ? <Artwork source={source} width={24} height={36}/> : null;
      }}/>} 
    {rating && ratingTitle && <Dialog open onOpenChange={open => {if (!open) controller.closeRating();}} title={t('title.rate', {title: ratingTitle})}
      footer={<Button variant="glass" size="compact" onPress={() => controller.closeRating()}>{t('action.close')}</Button>}>
      <View style={{paddingTop: 16, gap: 16}}>
        {rating.value === undefined ? <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.states.loading')}</Text>
          : <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: theme.isTV ? 12 : 0}} accessibilityRole="radiogroup" accessibilityLabel={t('player.rateThis')}>
            {[1, 2, 3, 4, 5].map(stars => <Focusable key={stars} accessibilityRole="radio" accessibilityLabel={t('title.stars', {count: stars})}
              accessibilityState={{checked: rating.value === stars * 2, disabled: rating.phase !== 'ready'}} disabled={rating.phase !== 'ready'}
              hasTVPreferredFocus={theme.isTV && stars === (typeof rating.value === 'number' && rating.value > 0 ? Math.ceil(rating.value / 2) : 1)}
              onPress={() => mutation(stars * 2)} focusRadius={8} hitSlop={6} style={{width: theme.isTV ? 64 : 32, height: theme.isTV ? 64 : 32, alignItems: 'center', justifyContent: 'center'}}>
              <View style={{width: theme.isTV ? 28 : 22, height: theme.isTV ? 28 : 22}}>
                <Icon name="i-star" size={theme.isTV ? 28 : 22} color={theme.colors.textTertiary}/>
                {typeof rating.value === 'number' && rating.value > (stars - 1) * 2 && <View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: (theme.isTV ? 28 : 22) * Math.min(1, (rating.value - (stars - 1) * 2) / 2), overflow: 'hidden'}}><Icon name="i-star-f" size={theme.isTV ? 28 : 22} color={theme.colors.accentStrong}/></View>}
              </View>
            </Focusable>)}
          </View>}
        {rating.phase === 'ready' && <Button variant="text" size="compact" onPress={() => mutation(null)}>{t('title.clearRating')}</Button>}
        {rating.phase === 'result' && <Text accessibilityLiveRegion="polite" style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('next.selection.native.saved')}</Text>}
        {rating.error && <Text accessibilityLiveRegion="polite" style={[theme.type.body, {color: theme.colors.textSecondary}]}>{error(rating.error)}</Text>}
        {rating.phase === 'uncertain' && <Button variant="glass" size="compact" onPress={() => {void controller.retryRating().catch(reportError);}}>{t('action.tryAgain')}</Button>}
      </View>
    </Dialog>}
  </>;
}
