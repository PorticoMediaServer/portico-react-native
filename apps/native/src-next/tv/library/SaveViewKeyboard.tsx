import React, {useRef, useState, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion, requestNativeFocus} from '../../kit/focus';
import {Banner, SidePanel} from '../../kit/overlays';
import {Icon} from '../../kit/Icon';
import {nativeType, useTheme} from '../../kit/theme';
import {useDestinationEntryFocus} from '../../screens/destinations/useEntryFocus';
import {applyNativeTVKeyboardKey, nativeTVKeyboardRows} from '../../screens/search/keyboard';
import type {NativeLibrarySaveView} from '../../screens/library/save-view';

// Frame36's nine-column keys and 860-point field, using the shared keyboard
// inventory. The panel adds only its existing 56/96-point TV content insets.
const characters = nativeTVKeyboardRows.flat();
const rows = Array.from({length: 4}, (_, index) => characters.slice(index * 9, index * 9 + 9));
const id = 'tv.library.save-view';

/** Rulings37/38: the real captured-view mutation, presented with TV text entry.
 * Back first leaves the keyboard, then returns to the actual overlay opener. */
export function NativeTVSaveViewKeyboard({controller, onBack}: {controller: NativeLibrarySaveView; onBack: () => void}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), t = defaultI18n.t;
  const [typing, setTyping] = useState(false), field = useRef<View>(null);
  const editable = state.open && !state.busy && !state.nameLocked;
  useDestinationEntryFocus({visible: typing && editable, intent: 'enter', revision: 0}, {regionId: `${id}.keys.0`, childId: 'a'});
  const back = () => {
    if (state.busy) return;
    if (typing) {setTyping(false); requestNativeFocus(field.current);} else onBack();
  };
  const choose = (key: string) => {
    if (!editable) return;
    const next = applyNativeTVKeyboardKey(state.name, key);
    if (Array.from(next).length <= 200) controller.setName(next);
  };
  const type = (size: number, weight: 400 | 600 | 700 = 400) => nativeType({size, weight, tracking: 0, lineHeight: 'normal'}, theme.textScale);
  const key = (value: string, span = 1) => {
    const label = value === 'space' ? t('next.states.key.Space') : value === 'delete' ? t('action.delete') : value === 'clear' ? t('filter.clear') : value;
    return <Focusable key={value} focusId={value} testID={`${id}.key.${value}`} disabled={!editable} accessibilityLabel={label}
      onPress={() => choose(value)} focusRadius={14} style={{width: (860 - 80) / 9 * span + 10 * (span - 1), height: 72,
        borderRadius: 14, backgroundColor: `${theme.colors.text}0D`, alignItems: 'center', justifyContent: 'center'}}>
      {value === 'delete' ? <Icon name="i-backspace" size={32} color={theme.colors.textSecondary}/>
        : <Text style={[type(span > 1 ? 22 : 28, 700), {color: /^\d$/.test(value) ? theme.colors.textTertiary : theme.colors.textSecondary}]}>{label}</Text>}
    </Focusable>;
  };
  return <SidePanel open={state.open} onOpenChange={open => {if (!open) back();}} title={t('lib.saveViewTitle')} description={t('lib.saveViewLede')}
    testID={id} initialFocusRef={field} showClose={false} topInset={0} logicalCanvas={{width: 1012, height: 1080}} dismissOnBack={!state.busy}
    footer={<FocusRegion id={`${id}.actions`} orientation="horizontal" entry="save" edges={{up: typing ? `${id}.keys.4` : `${id}.field`}} style={{flexDirection: 'row', gap: 20}}>
      <Button focusId="cancel" testID={`${id}.cancel`} variant="glass" disabled={state.busy} onPress={onBack}>{t('action.cancel')}</Button>
      <Button focusId="save" testID={`${id}.save`} variant="primary" loading={state.busy ? true : undefined}
        disabled={state.busy || !state.name.trim() || Array.from(state.name).length > 200} onPress={() => {void controller.save();}}>{t('lib.saveView')}</Button>
    </FocusRegion>}>
    <View style={{gap: 24, paddingTop: 12}}>
      {state.error !== undefined && <Banner testID={`${id}.error`} variant="notice" tone="error" placement="inline" message={presentError(state.error, 'library', {operation: 'save'}).body}/>}
      <FocusRegion id={`${id}.field`} entry="name" edges={{down: typing ? `${id}.keys.0` : `${id}.actions`}}>
        <Text style={[type(22, 700), {color: theme.colors.textTertiary, marginBottom: 8}]}>{t('lib.saveViewName')}</Text>
        <Focusable ref={field} focusId="name" testID={`${id}.name`} disabled={!editable} accessibilityLabel={t('lib.saveViewName')}
          accessibilityValue={{text: state.name}} onPress={() => {if (editable) setTyping(true);}} focusRadius={16}
          style={{width: 860, height: 84, borderRadius: 16, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center', backgroundColor: `${theme.colors.ink}9E`}}>
          <Text numberOfLines={1} style={[type(32, 600), {flexShrink: 1, color: state.name ? theme.colors.text : theme.colors.textTertiary}]}>{state.name || t('lib.saveViewPlaceholder')}</Text>
          {typing && editable && <View testID={`${id}.caret`} style={{width: 3, height: 40, borderRadius: 2, marginLeft: 3, backgroundColor: theme.colors.accentStrong}}/>}
        </Focusable>
      </FocusRegion>
      <Text style={[type(20), {color: theme.colors.textTertiary}]}>{t('lib.saveViewHelp')}</Text>
      {typing && <FocusRegion id={`${id}.keyboard`} enabled={editable} style={{gap: 10, width: 860}}>
        {rows.map((row, index) => <FocusRegion key={index} id={`${id}.keys.${index}`} entry={row[0]} order={row} orientation="horizontal" enabled={editable}
          edges={{up: index ? `${id}.keys.${index - 1}` : `${id}.field`, down: `${id}.keys.${index + 1}`}} style={{flexDirection: 'row', gap: 10}}>{row.map(value => key(value))}</FocusRegion>)}
        <FocusRegion id={`${id}.keys.4`} entry="space" order={['space', 'delete', 'clear']} orientation="horizontal" enabled={editable}
          edges={{up: `${id}.keys.3`, down: `${id}.actions`}} style={{flexDirection: 'row', gap: 10}}>{key('space', 5)}{key('delete')}{key('clear', 3)}</FocusRegion>
      </FocusRegion>}
    </View>
  </SidePanel>;
}
