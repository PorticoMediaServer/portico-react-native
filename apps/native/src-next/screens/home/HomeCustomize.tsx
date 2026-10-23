import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {findNodeHandle, ScrollView, Text, TVEventHandler, View, useWindowDimensions} from 'react-native';
import {defaultI18n, type I18n} from '../../../../../packages/i18n/src';
import {serverTextLabel} from '../../../../../packages/client-core/src/presentation/server-text';
import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import {Button, Focusable, Switch} from '../../kit/controls';
import {useFocusRegistry} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {BottomSheet, Dialog, SidePanel} from '../../kit/overlays';
import {focusTarget} from '../../kit/overlays/OverlayHost';
import {nativeType, useTheme} from '../../kit/theme';
import {shellLayout} from '../../shell/model';
import {NativeHomeCustomizeController} from './customize-controller';

/** Exact catalogue values supplied by the canonical copy owner. No screen copy
 * or server row label is manufactured by this presentation. */
export type NativeHomeCustomizeCopy = Readonly<{
  title: string; instruction: string; alwaysOn: string; addView: string; reset: string; save: string;
  conflictTitle: string; conflictBody: string; reload: string; keepEditing: string;
  move: string; drop: string; putBack: string;
}>;

export function HomeCustomize({controller, copy, i18n, onClose, onAddView, testID}: {
  controller: NativeHomeCustomizeController; copy: NativeHomeCustomizeCopy; i18n: Pick<I18n, 't' | 'has'>;
  onClose: () => void; onAddView: () => void; testID: string;
}) {
  const theme = useTheme(), viewport = useWindowDimensions(), registry = useFocusRegistry();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const first = useRef<View>(null), reload = useRef<View>(null), cancelReset = useRef<View>(null);
  const picked = useRef<View>(null), scroller = useRef<ScrollView>(null);
  const [reset, setReset] = useState(false);
  const regionId = testID;
  const back = () => {if (!controller.cancelPickup()) onClose();};
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
  const rowHeight = theme.isTV ? 76 : 58;
  const rows = <ScrollView ref={scroller} removeClippedSubviews={false} contentContainerStyle={{paddingTop: theme.isTV ? 20 : 8, paddingBottom: 20}}>
    {state.rows.map((row, index) => {
      const lifted = row.id === state.pickedId;
      const title = serverTextLabel(i18n, row.titleText, row.title);
      return <View key={row.id} style={{flexDirection: 'row', alignItems: 'center', minHeight: rowHeight, gap: theme.isTV ? 18 : 10, opacity: row.hidden ? .55 : 1,
        backgroundColor: lifted ? theme.colors.raisedHigh : undefined, borderRadius: 16}}>
        <Focusable ref={lifted ? picked : index === 0 ? first : undefined} focusId={row.id} testID={`${testID}-row-${row.id}`}
          disabled={state.pending || !!state.pickedId && !lifted} focusKind="row" focusRadius={16}
          hasTVPreferredFocus={index === 0} accessibilityLabel={title} accessibilityState={{selected: lifted}}
          onPress={() => controller.pick(row.id)} onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'increment' || event.nativeEvent.actionName === 'decrement') {
              if (!lifted) controller.pick(row.id);
              controller.move(event.nativeEvent.actionName === 'increment' ? 1 : -1); controller.drop();
            }
          }} accessibilityActions={row.reorderable ? [{name: 'increment', label: defaultI18n.t('home.customize.moveDown', {title})}, {name: 'decrement', label: defaultI18n.t('home.customize.moveUp', {title})}] : []}
          style={{flex: 1, minHeight: rowHeight, flexDirection: 'row', alignItems: 'center', gap: theme.isTV ? 28 : 14, paddingHorizontal: theme.isTV ? 18 : 8}}>
          <Icon name="i-grip" size={theme.isTV ? 24 : 20} color={theme.colors.textTertiary}/>
          <View style={{flex: 1}}><Text style={[nativeType({size: theme.isTV ? 26 : 16, weight: 700, tracking: -.01, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{title}</Text>
            {row.availabilityText && <Text style={[nativeType({size: theme.isTV ? 20 : 13, weight: 400, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary, marginTop: 4}]}>{serverTextLabel(i18n, row.availabilityText)}</Text>}
          </View>
        </Focusable>
        {row.required ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}><Icon name="i-lock" size={theme.isTV ? 18 : 14} color={theme.colors.textTertiary}/><Text style={[nativeType({size: theme.isTV ? 20 : 12, weight: 400, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.textTertiary}]}>{copy.alwaysOn}</Text></View>
          : row.hideable && <Switch focusId={`${row.id}:visibility`} checked={!row.hidden} disabled={state.pending || !!state.pickedId}
            accessibilityLabel={defaultI18n.t('home.customize.showRow', {title})} onCheckedChange={() => controller.toggle(row.id)}/>}
      </View>;
    })}
    <Button focusId="add-view" variant="text" icon="i-plus" disabled={state.pending || !!state.pickedId} onPress={onAddView}>{copy.addView}</Button>
  </ScrollView>;
  const footer = <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 18}}>
    <Button focusId="reset" variant="glass" disabled={state.pending || !!state.pickedId} onPress={() => setReset(true)}>{copy.reset}</Button>
    <Button focusId="save" disabled={state.pending || state.conflict || !state.dirty || !!state.pickedId} loading={state.pending} onPress={() => {void controller.save().then(saved => {if (saved) onClose();});}}>{copy.save}</Button>
  </View>;
  const body = <>{state.showConflict ? <View style={{paddingVertical: 20, gap: 16}}>
    <Text style={[theme.type.title, {color: theme.colors.text}]}>{copy.conflictTitle}</Text><Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{copy.conflictBody}</Text>
    <View style={{flexDirection: 'row', gap: 18}}><Button focusId="reload" ref={reload} onPress={() => {void controller.load();}}>{copy.reload}</Button><Button focusId="keep-editing" variant="glass" onPress={controller.keepEditing}>{copy.keepEditing}</Button></View>
  </View> : null}{rows}</>;
  const scale = shellLayout(viewport.width, viewport.height, theme.isTV).scale;
  return <>
    {theme.isTV ? <SidePanel open onOpenChange={open => {if (!open) back();}} title={copy.title} description={copy.instruction} width={860 * scale} topInset={0}
      showClose={false} testID={testID} initialFocusRef={first} footer={footer}
      style={{width: 860, maxWidth: 860, height: 1080, paddingLeft: 60, paddingRight: 96, transformOrigin: 'top right', transform: [{scale}]}}>{body}</SidePanel>
      : <BottomSheet open onOpenChange={open => {if (!open) back();}} title={copy.title} description={defaultI18n.t('home.customize.subtitle')}
        testID={testID} initialFocusRef={first} footer={footer}>{body}</BottomSheet>}
    <Dialog open={reset} onOpenChange={setReset} title={defaultI18n.t('confirm.resetHome.title')} description={defaultI18n.t('confirm.resetHome.body')}
      initialFocusRef={cancelReset} showClose={false} footer={<View style={{flexDirection: 'row', gap: 18}}>
        <Button ref={cancelReset} variant="glass" onPress={() => setReset(false)}>{defaultI18n.t('action.cancel')}</Button>
        <Button variant="glass" style={{backgroundColor: `${theme.colors.record}24`}} textStyle={{color: theme.colors.record}} onPress={() => {setReset(false); void controller.resetConfirmed();}}>{copy.reset}</Button>
      </View>}><View/></Dialog>
  </>;
}

export function HomeSavedViewChoices({views, i18n, onChoose}: {views: readonly PersonalResource[]; i18n: Pick<I18n, 't'>; onChoose: (view: PersonalResource) => void}) {
  const theme = useTheme();
  const eligible = views.filter(view => view.kind === 'view' && view.status === 'ready' && !view.onHome && view.actions.includes('pin'));
  return <ScrollView>{eligible.map(view =>
    <Focusable key={view.id} focusId={view.id} focusKind="row" onPress={() => onChoose(view)} style={{paddingVertical: 20, gap: 6}}>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{view.name}</Text>
      {!!view.summary && <Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{view.summary}</Text>}
    </Focusable>)}{!eligible.length && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{i18n.t('home.customize.noViews')}</Text>}</ScrollView>;
}
