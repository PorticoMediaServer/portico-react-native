import React, {useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {Button} from '../../kit/controls';
import {Menu} from '../../kit/overlays';
import {SelectionBar} from '../../kit/selection';
import type {CardSelection} from '../../kit/cards/model';
import {useTheme} from '../../kit/theme';
import {NativeReadingActions, type NativeReadingActionOffer} from './reading-actions';

const {t} = defaultI18n;
export function ReadingMenuAnchor({children}: {children: (anchor: React.RefObject<View | null>) => React.ReactNode}) {
  const anchor = useRef<View>(null);
  return <>{children(anchor)}</>;
}
export function useReadingActions(context: NativeShellBootstrapContext, runtime: NativeShellRuntime, owner: object) {
  const actions = useMemo(() => new NativeReadingActions(context, runtime.reportError), [context, runtime.reportError]);
  useLayoutEffect(() => {actions.arm(); return () => actions.release();}, [actions, owner]);
  // Navigation clears the opening; the retained owner can capture its route again on Back.
  useEffect(() => actions.reconcile());
  const state = useSyncExternalStore(actions.subscribe, actions.getSnapshot);
  const selection = (offer: NativeReadingActionOffer): CardSelection => ({active: state.selecting, selected: actions.selected(offer.item),
    onToggle: () => actions.toggle(offer), onEnter: () => actions.toggle(offer)});
  return {actions, state, selection};
}
export type ReadingActionsPort = ReturnType<typeof useReadingActions>;

export function ReadingItemMenu({port, runtime}: {port: ReadingActionsPort; runtime: NativeShellRuntime}) {
  const {actions, state} = port, offer = state.menu;
  return <Menu open={!!offer} onOpenChange={open => {if (!open) actions.dismiss(offer);}} title={offer?.item.title} anchorRef={offer?.anchorRef}
    items={offer ? [
      {id: 'read', label: t('next.reader.read'), icon: 'i-book', disabled: state.busy, onSelect: () => actions.open(offer)},
      ...(offer.download ? [{id: 'download', label: t('action.download'), icon: 'i-dl' as const, disabled: state.busy, onSelect: () => actions.download(offer)}] : []),
      ...(state.mark ? [{id: 'mark', label: t(state.mark.read ? 'next.reader.markUnread' : 'next.reader.markRead'), icon: 'i-check' as const,
        disabled: state.busy, closeOnSelect: false, onSelect: () => {void actions.personal(state, 'mark').catch(runtime.reportError);}}] : []),
      ...(state.listed ? [{id: 'list', label: t(state.listed.listed ? 'next.home.removeMyList' : 'next.home.addMyList'), icon: 'i-plus' as const,
        disabled: state.busy, closeOnSelect: false, onSelect: () => {void actions.personal(state, 'listed').catch(runtime.reportError);}}] : []),
      {id: 'select', label: t('next.selection.select'), disabled: state.busy, onSelect: () => actions.toggle(offer)},
    ] : []}/>;
}

/** Reading uses Read/Unread copy, not the AV selection bar's Watched actions. */
export function ReadingSelectionToolbar({port, runtime}: {port: ReadingActionsPort; runtime: NativeShellRuntime}) {
  const theme = useTheme(), {actions, state} = port;
  if (!state.selecting) return theme.platform === 'phone' ? null : <View style={{alignItems: 'flex-end', paddingHorizontal: theme.gutter}}>
    <Button variant="text" onPress={actions.start}>{t('next.selection.select')}</Button>
  </View>;
  return <View>
    <SelectionBar count={state.selected.length} onCancel={actions.cancel} menu={null} onMenuChange={() => {}} actions={[]} onAction={() => {}}/>
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: theme.gutter, paddingVertical: 10}}>
      {(['list', 'unlist', 'read', 'unread'] as const).map(action => <Button key={action} variant="glass" size="small" disabled={state.busy || !state.selected.length}
        onPress={() => {void actions.apply(state, action).catch(runtime.reportError);}}>{t(action === 'list' ? 'next.home.addMyList' : action === 'unlist' ? 'next.home.removeMyList' : action === 'read' ? 'next.reader.markRead' : 'next.reader.markUnread')}</Button>)}
    </View>
  </View>;
}
