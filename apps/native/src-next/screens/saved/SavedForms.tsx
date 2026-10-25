import React, {useEffect, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button, Switch, TextField} from '../../kit/controls';
import {Banner, BottomSheet, Dialog} from '../../kit/overlays';
import {useTheme} from '../../kit/theme';
import type {PersonalVisibility} from '../../../../../packages/client-core/src/personal-saved';

const t = defaultI18n.t;

export type SavedNameSheetProps = Readonly<{
  open: boolean;
  title: string;
  action: string;
  initialName?: string;
  initialSummary?: string;
  withSummary: boolean;
  withVisibility?: boolean;
  initialVisibility?: PersonalVisibility;
  busy: boolean;
  error?: string;
  testID: string;
  onClose: () => void;
  onSave: (input: Readonly<{name: string; summary: string; visibility: PersonalVisibility}>) => void;
}>;

/** The drawn name dialog as a sheet: Name, optional Description and the
 * published visibility switch. Every write is the caller's real command. */
export function SavedNameSheet(props: SavedNameSheetProps) {
  const theme = useTheme(), input = useRef<React.ComponentRef<typeof TextField>>(null);
  const [name, setName] = useState(props.initialName ?? ''), [summary, setSummary] = useState(props.initialSummary ?? '');
  const [visibility, setVisibility] = useState<PersonalVisibility>(props.initialVisibility ?? 'private');
  useEffect(() => {
    if (!props.open) return;
    setName(props.initialName ?? ''); setSummary(props.initialSummary ?? ''); setVisibility(props.initialVisibility ?? 'private');
  }, [props.open, props.initialName, props.initialSummary, props.initialVisibility]);
  const save = () => {if (!props.busy && name.trim()) props.onSave({name: name.trim(), summary: summary.trim(), visibility});};
  return <BottomSheet open={props.open} onOpenChange={open => {if (!open && !props.busy) props.onClose();}} testID={props.testID}
    title={props.title} initialFocusRef={input} showClose={false} fitContent keyboardAvoiding
    dismissOnBack={!props.busy} dismissOnOutsidePress={!props.busy} dismissOnGesture={!props.busy}
    footer={<View style={{flexDirection: 'row', gap: 12}}>
      <Button testID={`${props.testID}-cancel`} focusId={`${props.testID}-cancel`} variant="glass" disabled={props.busy} onPress={props.onClose} style={{flex: 1}}>{t('action.cancel')}</Button>
      <Button testID={`${props.testID}-save`} focusId={`${props.testID}-save`} variant="primary" loading={props.busy} disabled={props.busy || !name.trim()}
        onPress={save} style={{flex: 1}}>{props.action}</Button>
    </View>}>
    <View style={{gap: 12}}>
      {props.error !== undefined && <Banner testID={`${props.testID}-error`} variant="notice" tone="error" placement="inline" message={props.error}/>}
      <TextField ref={input} testID={`${props.testID}-name`} focusId={`${props.testID}-name`} label={t('profile.name')} value={name} onChangeText={setName}
        editable={!props.busy} maxLength={200} returnKeyType="done" onSubmitEditing={save}/>
      {props.withSummary && <TextField testID={`${props.testID}-summary`} focusId={`${props.testID}-summary`} label={t('web.saved.summary')} value={summary}
        onChangeText={setSummary} editable={!props.busy} maxLength={4000} multiline/>}
      {props.withVisibility && <View style={{gap: 6}}>
        <Switch checked={visibility === 'server'} onCheckedChange={next => setVisibility(next ? 'server' : 'private')} disabled={props.busy}>{t('web.saved.visibleToAll')}</Switch>
        <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t(visibility === 'server' ? 'web.saved.sharedHelp' : 'web.saved.privateHelp')}</Text>
      </View>}
    </View>
  </BottomSheet>;
}

export type SavedConfirmSheetProps = Readonly<{
  open: boolean;
  title: string;
  body: string;
  action: string;
  busy: boolean;
  error?: string;
  /** Draw the confirm as the destructive red-tint action (collections 13c). */
  destructive?: boolean;
  testID: string;
  onClose: () => void;
  onConfirm: () => void;
}>;

/** A destructive confirm: the phone sheet and the TV dialog share one command. */
export function SavedConfirmSheet(props: SavedConfirmSheetProps) {
  const theme = useTheme();
  const footer = <View style={{flexDirection: 'row', gap: 12}}>
    <Button testID={`${props.testID}-cancel`} focusId={`${props.testID}-cancel`} variant="glass" disabled={props.busy} onPress={props.onClose} style={{flex: 1}}>{t('action.cancel')}</Button>
    <Button testID={`${props.testID}-confirm`} focusId={`${props.testID}-confirm`} variant={props.destructive ? 'glass' : 'primary'} loading={props.busy} disabled={props.busy}
      onPress={props.onConfirm} style={props.destructive ? {flex: 1, backgroundColor: `${theme.colors.record}24`} : {flex: 1}}
      textStyle={props.destructive ? {color: theme.colors.record} : undefined}>{props.action}</Button>
  </View>;
  const body = <View style={{gap: 12}}>
    {props.error !== undefined && <Banner testID={`${props.testID}-error`} variant="notice" tone="error" placement="inline" message={props.error}/>}
    <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{props.body}</Text>
  </View>;
  if (theme.isTV) return <Dialog open={props.open} onOpenChange={open => {if (!open && !props.busy) props.onClose();}} title={props.title}
    testID={props.testID} width={620} dismissOnBack={!props.busy} dismissOnOutsidePress={!props.busy} footer={footer}>{body}</Dialog>;
  return <BottomSheet open={props.open} onOpenChange={open => {if (!open && !props.busy) props.onClose();}} title={props.title} testID={props.testID}
    fitContent dismissOnBack={!props.busy} dismissOnOutsidePress={!props.busy} dismissOnGesture={!props.busy} footer={footer}>{body}</BottomSheet>;
}
