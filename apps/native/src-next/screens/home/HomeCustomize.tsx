import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {findNodeHandle, ScrollView, Text, TVEventHandler, View} from 'react-native';
import {defaultI18n, type I18n} from '../../../../../packages/i18n/src';
import {serverTextLabel} from '../../../../../packages/client-core/src/presentation/server-text';
import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import {Button, Focusable, Switch} from '../../kit/controls';
import {useFocusRegistry} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {BottomSheet, Dialog, SidePanel} from '../../kit/overlays';
import {focusTarget} from '../../kit/overlays/OverlayHost';
import {nativeType, useTheme} from '../../kit/theme';
import {NativeHomeCustomizeController} from './customize-controller';

/** Exact catalogue values supplied by the canonical copy owner. No screen copy
 * or server row label is manufactured by this presentation. */
export type NativeHomeCustomizeCopy = Readonly<{
  title: string; instruction: string; alwaysOn: string; addView: string; reset: string; save: string;
  conflictTitle: string; conflictBody: string; reload: string; keepEditing: string;
  move: string; drop: string; putBack: string;
}>;

export function HomeCustomize({controller, copy, i18n, onClose, onAddView, views, summary, renderError, testID}: {
  controller: NativeHomeCustomizeController; copy: NativeHomeCustomizeCopy; i18n: Pick<I18n, 't' | 'has'>;
  onClose: () => void; onAddView: () => void; testID: string; summary: (view: PersonalResource) => string | undefined;
  renderError?: (error: unknown, retry: () => void) => React.ReactNode;
  views?: Readonly<{items: readonly PersonalResource[]; loading: boolean; error?: unknown; renderError: (error: unknown, retry: () => void) => React.ReactNode; retry: () => void}>;
}) {
  const theme = useTheme(), registry = useFocusRegistry();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const first = useRef<View>(null), reload = useRef<View>(null), cancelReset = useRef<View>(null);
  const picked = useRef<View>(null), scroller = useRef<ScrollView>(null);
  const [reset, setReset] = useState(false), [choosing, setChoosing] = useState(false);
  const firstView = useRef<View>(null), viewEntryFocused = useRef(false);
  const [positions, setPositions] = useState<ReadonlyMap<string, number>>(new Map());
  const regionId = testID;
  const back = () => {if (choosing) {setChoosing(false); return;} if (!controller.cancelPickup()) onClose();};
  useEffect(() => {
    if (!choosing) {viewEntryFocused.current = false; return;}
    if (!theme.isTV || views?.loading || viewEntryFocused.current) return;
    const frame = requestAnimationFrame(() => {if (firstView.current) {focusTarget(firstView.current); viewEntryFocused.current = true;}});
    return () => cancelAnimationFrame(frame);
  }, [choosing, theme.isTV, views?.items, views?.loading]);
  useEffect(() => {
    if (!theme.isTV || state.phase !== 'ready') return;
    const frame = requestAnimationFrame(() => focusTarget(state.showConflict ? reload.current : first.current));
    return () => cancelAnimationFrame(frame);
  }, [state.phase, state.showConflict, theme.isTV]);
  useEffect(() => {
    if (!theme.isTV || !state.pickedId || state.pending) return;
    const listener = TVEventHandler.addListener(event => {
      if (event.eventKeyAction !== 0 || !['up', 'down'].includes(event.eventType)) return;
      const active = registry.capture();
      if (active?.regionId !== regionId || active.childId !== state.pickedId || !picked.current) return;
      if (event.tag !== undefined && event.tag !== findNodeHandle(picked.current)) return;
      controller.move(event.eventType === 'up' ? -1 : 1);
    });
    return () => listener?.remove();
  }, [controller, regionId, registry, state.pending, state.pickedId, theme.isTV]);
  const rowHeight = theme.isTV ? 70 : 58;
  const rowsById = new Map(state.rows.map(row => [row.id, row]));
  const displayed = state.pickupOrder ? state.pickupOrder.map(id => rowsById.get(id)!).filter(Boolean) : state.rows;
  const targetIndex = state.rows.findIndex(row => row.id === state.pickedId), targetId = state.pickupOrder?.[targetIndex];
  const targetY = targetId ? positions.get(targetId) : undefined;
  const rows = <ScrollView ref={scroller} removeClippedSubviews={false} contentContainerStyle={{paddingTop: theme.isTV ? 16 : 8, paddingBottom: 20}}>
    {displayed.map((row, index) => {
      const lifted = row.id === state.pickedId;
      const title = serverTextLabel(i18n, row.titleText, row.title);
      const detail = row.savedView ? summary(row.savedView) : serverTextLabel(i18n, row.availabilityText);
      const originalY = positions.get(row.id), shift = lifted && targetY !== undefined && originalY !== undefined ? targetY - originalY : 0;
      return <View key={row.id} onLayout={event => {const y = event.nativeEvent.layout.y; setPositions(before => {if (before.get(row.id) === y) return before; const next = new Map(before); next.set(row.id, y); return next;});}}
        style={{height: rowHeight, zIndex: lifted ? 8 : undefined, ...(lifted ? {borderWidth: 2, borderStyle: 'dashed', borderColor: theme.colors.line} : {})}}><View style={{flexDirection: 'row', alignItems: 'center', height: rowHeight, gap: theme.isTV ? 18 : 10, position: lifted ? 'absolute' : undefined, left: lifted ? 0 : undefined, right: lifted ? 0 : undefined,
        backgroundColor: lifted ? theme.colors.raisedHigh : undefined, borderRadius: 14, transform: lifted ? [{translateY: shift}, {scale: 1.03}] : undefined}}>
        <Focusable ref={lifted ? picked : index === 0 ? first : undefined} focusId={row.id} testID={`${testID}-row-${row.id}`}
          disabled={state.pending || !!state.pickedId && !lifted} focusKind="row" focusRadius={16}
          hasTVPreferredFocus={index === 0} accessibilityLabel={title} accessibilityState={{selected: lifted}}
          onPress={() => controller.pick(row.id)} onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'increment' || event.nativeEvent.actionName === 'decrement') {
              if (!lifted) controller.pick(row.id);
              controller.move(event.nativeEvent.actionName === 'increment' ? 1 : -1); controller.drop();
            }
          }} accessibilityActions={row.reorderable ? [{name: 'increment', label: defaultI18n.t('home.customize.moveDown', {title})}, {name: 'decrement', label: defaultI18n.t('home.customize.moveUp', {title})}] : []}
          style={{flex: 1, minHeight: rowHeight, flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 18 : 14, paddingLeft: theme.isTV ? 12 : 8}}>
          <View style={theme.isTV ? {width: 44, height: 50, alignItems: 'center', justifyContent: 'center'} : undefined}><Icon name="i-grip" size={theme.isTV ? 26 : 20} color={lifted ? theme.colors.text : theme.colors.textTertiary}/></View>
          <View style={{flex: 1}}><Text style={[nativeType({size: theme.isTV ? 26 : 16, weight: theme.isTV ? 600 : 700, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: row.hidden ? theme.colors.textTertiary : theme.colors.text}]} numberOfLines={1}>{title}</Text>
            {!!detail && <Text style={[nativeType({size: theme.isTV ? 19 : 13, weight: 500, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary, marginTop: theme.isTV ? 1 : 4}]}>{detail}</Text>}
          </View>
        </Focusable>
        {row.required ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 9, paddingRight: 18}}><Icon name="i-lock" size={theme.isTV ? 18 : 14} color={theme.colors.textTertiary}/><Text style={[nativeType({size: theme.isTV ? 20 : 12, weight: 400, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{copy.alwaysOn}</Text></View>
          : row.hideable && <Switch focusId={`${row.id}:visibility`} checked={!row.hidden} disabled={state.pending || !!state.pickedId}
            accessibilityLabel={defaultI18n.t('home.customize.showRow', {title})} onCheckedChange={() => controller.toggle(row.id)}/>}
      </View></View>;
    })}
    {state.pickedId && targetY !== undefined && <View pointerEvents="none" style={{position: 'absolute', left: 12, right: 12, top: targetY - 3, height: 6, backgroundColor: theme.colors.accentStrong, borderRadius: 3}}/>}
    {!state.pickedId && <Button focusId="add-view" variant="text" icon="i-plus" disabled={state.pending || !!state.pickedId} onPress={() => {if (views) setChoosing(true); onAddView();}}>{copy.addView}</Button>}
  </ScrollView>;
  const footer = choosing || state.pickedId ? undefined : state.showConflict ? <View style={{flexDirection: 'row', gap: 18}}><Button focusId="reload" ref={reload} onPress={() => {void controller.load();}}>{copy.reload}</Button><Button focusId="keep-editing" variant="glass" onPress={controller.keepEditing}>{copy.keepEditing}</Button></View> : <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 18}}>
    <Button focusId="reset" variant="glass" disabled={state.pending || !!state.pickedId} onPress={() => setReset(true)}>{copy.reset}</Button>
    <Button focusId="save" disabled={state.pending || state.conflict || !state.dirty || !!state.pickedId} loading={state.pending} onPress={() => {void controller.save().then(saved => {if (saved) onClose();});}}>{copy.save}</Button>
  </View>;
  const body = choosing && views ? views.loading ? <View/> : views.error ? views.renderError(views.error, views.retry) : <HomeSavedViewChoices summary={summary} views={views.items.filter(view => !state.rows.some(row => row.id === `view:${view.id}`))} i18n={i18n} firstRef={firstView}
    onChoose={view => {if (controller.addSavedView(view, theme.isTV)) setChoosing(false);}}/> : <>{state.showConflict && <View style={{paddingVertical: 20, flexDirection: 'row', gap: 16}}>
    <Icon name="i-warn" size={30} color={theme.colors.textSecondary}/><View style={{flex: 1}}><Text style={[theme.type.title, {color: theme.colors.text}]}>{copy.conflictTitle}</Text><Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{copy.conflictBody}</Text></View>
  </View>}{state.error && !state.showConflict && renderError?.(state.error, () => {void controller.save();})}{rows}</>;
  return <>
    {theme.isTV && state.pickedId && <View pointerEvents="none" style={{position: 'absolute', left: 200, right: 960, bottom: 56, flexDirection: 'row', justifyContent: 'center', gap: 28}}>
      {[['▲▼', copy.move], [defaultI18n.t('next.layout.ok'), copy.drop], [defaultI18n.t('action.back'), copy.putBack]].map(([key, label]) => <View key={key} style={{flexDirection: 'row', alignItems: 'center', gap: 10}}><Text style={[theme.type.captionStrong, {color: theme.colors.text, backgroundColor: theme.colors.raised, paddingHorizontal: 10, borderRadius: 6}]}>{key}</Text><Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{label}</Text></View>)}
    </View>}
    {theme.isTV ? <SidePanel open onOpenChange={open => {if (!open) back();}} title={choosing ? defaultI18n.t('home.customize.addView') : copy.title} description={choosing ? defaultI18n.t('home.customize.chooseView') : state.showConflict ? undefined : copy.instruction} width={860} topInset={0} logicalCanvas={{width: 860, height: 1080}}
      showClose={false} titleType={{size: 44, weight: 800, tracking: -.03, lineHeight: 'normal'}}
      descriptionTextStyle={[nativeType({size: 22, weight: 400, tracking: 0, lineHeight: 30.8}, theme.textScale), {color: theme.colors.textTertiary, marginTop: 8}]} testID={testID} initialFocusRef={choosing ? firstView : first} footer={footer}
      style={{paddingTop: 46, paddingLeft: 60, paddingRight: 96}}>{body}</SidePanel>
      : <BottomSheet open onOpenChange={open => {if (!open) back();}} title={choosing ? defaultI18n.t('home.customize.addView') : copy.title} description={defaultI18n.t(choosing ? 'home.customize.chooseView' : 'home.customize.subtitle')}
        testID={testID} initialFocusRef={choosing ? firstView : first} footer={footer}>{body}</BottomSheet>}
    <Dialog open={reset} onOpenChange={setReset} title={defaultI18n.t('confirm.resetHome.title')} description={defaultI18n.t('confirm.resetHome.body')}
      initialFocusRef={cancelReset} showClose={false} footer={<View style={{flexDirection: 'row', gap: 18}}>
        <Button ref={cancelReset} variant="glass" onPress={() => setReset(false)}>{defaultI18n.t('action.cancel')}</Button>
        <Button variant="glass" style={{backgroundColor: `${theme.colors.record}24`}} textStyle={{color: theme.colors.record}} onPress={() => {setReset(false); void controller.resetConfirmed();}}>{copy.reset}</Button>
      </View>}><View/></Dialog>
  </>;
}

export function HomeSavedViewChoices({views, i18n, onChoose, firstRef, summary}: {views: readonly PersonalResource[]; summary: (view: PersonalResource) => string | undefined; firstRef?: React.RefObject<View | null>; i18n: Pick<I18n, 't'>; onChoose: (view: PersonalResource) => void}) {
  const theme = useTheme();
  const eligible = views.filter(view => view.kind === 'view' && view.status === 'ready' && !view.onHome && view.actions.includes('pin'));
  return <ScrollView>{eligible.map((view, index) => {const detail = summary(view); return <Focusable ref={index === 0 ? firstRef : undefined} key={view.id} focusId={view.id} focusKind="row" onPress={() => onChoose(view)} style={{height: theme.isTV ? 92 : undefined, paddingVertical: theme.isTV ? 0 : 20, paddingHorizontal: theme.isTV ? 20 : 0, flexDirection: 'row', alignItems: 'center', gap: 18}}>
      <View style={{width: theme.isTV ? 52 : 36, height: theme.isTV ? 52 : 36, borderRadius: theme.isTV ? 13 : 9, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.colors.text}1A`}}><Icon name="i-filter" size={theme.isTV ? 28 : 20} color={theme.colors.textSecondary}/></View><View style={{flex: 1}}>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{view.name}</Text>
      {!!detail && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{detail}</Text>}</View>
    </Focusable>;})}{!eligible.length && <View style={{paddingVertical: 24}}><Text style={[theme.type.title, {color: theme.colors.text}]}>{i18n.t('next.home.noViewsTitle')}</Text><Text style={[theme.type.body, {color: theme.colors.textSecondary, marginTop: 8}]}>{i18n.t('next.home.noViewsBody')}</Text></View>}</ScrollView>;
}
