import React, {useEffect, useId} from 'react';
import {BackHandler, StyleSheet, View} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import {BlurView, glassRecipe} from '../../platform/native-blur';
import {Button} from '../controls/Button';
import {Focusable} from '../controls/Focusable';
import {Icon, type IconName} from '../Icon';
import {Menu} from '../overlays/Menu';
import type {MenuEntry} from '../overlays/types';
import {useTheme} from '../theme';
import {selectionText} from './copy';
import {SelectionText} from './surface';
import type {SelectionAction, SelectionActionOffer, SelectionBarProps} from './types';

const icons: Record<SelectionAction, IconName> = {play: 'i-play', queue: 'i-queue', playlist: 'i-listplus', myList: 'i-plus', watched: 'i-check', unwatched: 'i-eyeoff', collection: 'i-layers', favorite: 'i-heart', removeMyList: 'i-x', download: 'i-download', edit: 'i-edit', refresh: 'i-refresh', delete: 'i-trash', playNext: 'i-listplus', playLater: 'i-queue', more: 'i-more'};
const ownerActions: readonly SelectionAction[] = ['edit', 'refresh', 'delete'];
const mainTV: readonly SelectionAction[] = ['play', 'queue', 'playlist', 'myList', 'watched', 'more'];
const phoneMain: readonly SelectionAction[] = ['play', 'queue', 'playlist', 'myList', 'more'];
const label = (id: SelectionAction) => selectionText(`next.selection.native.action.${id}`);

function permitted(actions: readonly SelectionActionOffer[], isTV: boolean) {return actions.filter(action => !isTV || action.id !== 'refresh' && action.id !== 'delete' && action.id !== 'download');}
function SelectionMenus(props: SelectionBarProps) {
  const {isTV} = useTheme();
  const actions = permitted(props.actions, isTV);
  const menuIds: readonly SelectionAction[] = props.menu === 'queue' ? ['playNext', 'playLater'] : props.menu === 'watched' ? ['watched', 'unwatched'] : ['watched', 'unwatched', 'collection', 'favorite', 'download', 'removeMyList', 'edit', 'refresh', 'delete'];
  const items: MenuEntry[] = [];
  for (const id of menuIds) {
    const offer = actions.find(action => action.id === id);
    if (!offer || isTV && props.menu === 'more' && id === 'watched') continue;
    if (ownerActions.includes(id) && !items.some(item => 'section' in item)) items.push({id: 'owner', section: true, label: props.ownerTag, tone: 'owner'});
    items.push({id, label: id === 'watched' ? selectionText('next.selection.native.markWatched') : label(id), icon: icons[id], description: offer.reason, disabled: offer.disabled,
      tone: ownerActions.includes(id) ? 'owner' : 'default', destructive: id === 'delete', onSelect: () => props.onAction(id)});
  }
  return <Menu open={props.menu !== null} onOpenChange={open => {if (!open) props.onMenuChange(null);}}
    title={props.menu === 'queue' ? selectionText('next.selection.native.queueTitle', {count: props.count}) : props.menuTitle ?? selectionText('next.selection.native.selected', {count: props.count})}
    items={items} presentation={isTV ? 'sideSheet' : 'sheet'} />;
}
function useSelectionBack(onCancel: () => void, menu: SelectionBarProps['menu']) {
  useEffect(() => {
    if (menu !== null) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {onCancel(); return true;});
    return () => subscription.remove();
  }, [onCancel, menu]);
}
function activate(props: SelectionBarProps, id: SelectionAction) {
  if (id === 'queue' || id === 'watched' || id === 'more') props.onMenuChange(id);
  else props.onAction(id);
}

/** Header replaces its host toolbar. The phone action bar occupies the shell's tab-bar slot. */
export function SelectionBar(props: SelectionBarProps) {
  const {isTV, colors} = useTheme();
  useSelectionBack(props.onCancel, props.menu);
  const tintId = useId().replace(/:/g, '');
  const actions = permitted(props.actions, isTV);
  if (!isTV) return <>
    <View style={{paddingTop: props.topInset ?? 0, backgroundColor: 'rgba(7,16,24,.9)', borderBottomWidth: 1, borderBottomColor: 'rgba(92,179,226,.25)'}}>
      <View style={styles.header}>
        <Button variant="text" size="small" style={{paddingHorizontal: 0}} textStyle={{fontSize: 16.5, color: colors.textSecondary}} onPress={props.onCancel}>{selectionText('next.selection.native.cancel')}</Button>
        <View pointerEvents="none" style={styles.count}><SelectionText size={17} weight={800}>{selectionText('next.selection.native.selected', {count: props.count})}</SelectionText></View>
        <Button variant="text" size="small" style={{marginLeft: 'auto', paddingHorizontal: 0}} textStyle={{fontSize: 16}} onPress={props.onSelectAll}>{props.selectAllLabel}</Button>
      </View>
      {props.subtitle ? <View style={{paddingHorizontal: 20, paddingBottom: 10}}><SelectionText size={13} weight={600} secondary>{props.subtitle}</SelectionText></View> : null}
    </View>
    <SelectionMenus {...props} />
  </>;
  return <>
    <View style={styles.tv}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" accessible={false} pointerEvents="none"><Defs><LinearGradient id={tintId} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={colors.accent} stopOpacity={.22}/><Stop offset="1" stopColor={colors.accent} stopOpacity={.12}/></LinearGradient></Defs><Rect width="100%" height="100%" rx={22} fill={`url(#${tintId})`}/></Svg>
      <SelectionText size={28} weight={800}>{selectionText('next.selection.native.selected', {count: props.count})}</SelectionText>
      {props.subtitle ? <SelectionText size={20} weight={600} secondary>{props.subtitle}</SelectionText> : null}
      <View style={{height: 44, width: 2, backgroundColor: 'rgba(92,179,226,.35)', marginHorizontal: 6}} />
      {mainTV.map(id => {const offer = actions.find(action => action.id === id);return offer ? <Button key={id} variant={id === 'play' ? 'primary' : 'glass'} size="compact" icon={icons[id]} iconOnly={id === 'more'} disabled={offer.disabled} accessibilityLabel={label(id)}
        style={{height: 64, borderRadius: 14, paddingHorizontal: id === 'more' ? 0 : 24}} textStyle={{fontSize: 22}} onPress={() => activate(props, id)}>{label(id)}</Button> : null;})}
      <View style={{flex: 1}} />
      <Button variant="glass" size="compact" onPress={props.onSelectAll} style={{height: 64}} textStyle={{fontSize: 22}}>{props.selectAllLabel}</Button>
      <Button variant="glass" size="compact" onPress={props.onCancel} style={{height: 64}} textStyle={{fontSize: 22}}>{selectionText('next.selection.native.done')}</Button>
    </View>
    <SelectionMenus {...props} />
  </>;
}

export function SelectionPhoneActionBar(props: Pick<SelectionBarProps, 'actions' | 'onAction' | 'onMenuChange'> & {fourthSlot?: 'myList' | 'watched'; bottomInset?: number}) {
  const {isTV, colors} = useTheme();
  if (isTV) return null;
  const recipe = glassRecipe();
  const ids = phoneMain.map(id => id === 'myList' ? props.fourthSlot ?? 'myList' : id);
  return <View style={[styles.phoneActions, {height: 50 + (props.bottomInset ?? 34)}]}>
    {recipe.nativeBlur ? <BlurView style={StyleSheet.absoluteFill} blurType="dark" blurAmount={24} reducedTransparencyFallbackColor={colors.raised} /> : null}
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, {backgroundColor: 'rgba(14,36,52,.94)', borderTopWidth: 1, borderTopColor: 'rgba(92,179,226,.3)'}]} />
    {ids.map(id => {
      const offer = props.actions.find(action => action.id === id);
      if (!offer) return <View key={id} style={{flex: 1}} />;
      return <Focusable key={id} accessibilityRole="button" accessibilityLabel={label(id)} disabled={offer.disabled}
        onPress={() => {if (id === 'queue' || id === 'watched' || id === 'more') props.onMenuChange(id);else props.onAction(id);}}
        style={{flex: 1, height: 44, alignItems: 'center', paddingTop: id === 'play' ? 0 : 2, gap: 4, opacity: offer.disabled ? .42 : 1}}>
        <View style={id === 'play' ? {width: 34, height: 28, borderRadius: 9, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center'} : {height: 24}}><Icon name={icons[id]} size={id === 'play' ? 20 : 24} color={id === 'play' ? colors.ink : colors.textSecondary} /></View>
        <SelectionText size={10.5} weight={700}>{label(id)}</SelectionText>
      </Focusable>;
    })}
  </View>;
}
const styles = StyleSheet.create({header: {height: 46, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center'}, count: {position: 'absolute', left: 0, right: 0, alignItems: 'center'}, tv: {height: 92, paddingLeft: 24, paddingRight: 16, borderRadius: 22, flexDirection: 'row', alignItems: 'center', gap: 14, borderWidth: 2, borderColor: 'rgba(92,179,226,.45)'}, phoneActions: {flexDirection: 'row', paddingTop: 9, paddingHorizontal: 8, overflow: 'hidden'}});
