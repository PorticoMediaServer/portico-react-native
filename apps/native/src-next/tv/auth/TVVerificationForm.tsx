import React, {useEffect, useRef} from 'react';
import {Text, View, useTVEventHandler} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Button, Focusable} from '../../kit/controls';
import {FocusRegion} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {nativeType, useTheme} from '../../kit/theme';
import {useDestinationEntryFocus} from '../../screens/destinations/useEntryFocus';
import {TVAuthLayout} from './TVAuthLayout';

export type TVVerificationFormProps = Readonly<{
  kind: 'portico' | 'local'; code: string; onCodeChange: (value: string) => void;
  recovery: boolean; recoveryCode: string; onRecoveryCodeChange: (value: string) => void;
  onRecoveryChange: (value: boolean) => void;
  busy: boolean; error?: React.ReactNode; onSubmit: (value: string) => void; onBack: () => void;
}>;
const recoveryCharacters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890'];
const recoveryRows = Array.from({length: Math.ceil(recoveryCharacters.length / 9)}, (_, row) => recoveryCharacters.slice(row * 9, row * 9 + 9));
const padRows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['delete', '0']];

/** Controlled same-account MFA; the transaction owner clears a rejected code and maps its shared error. */
export function TVVerificationForm(props: TVVerificationFormProps) {
  const theme = useTheme(), t = defaultI18n.t, id = `tv.auth.${props.kind}.factor`, submitted = useRef<string | undefined>(undefined);
  useEffect(() => {if (!props.code) submitted.current = undefined;}, [props.code]);
  const remove = () => {if (!props.busy) {submitted.current = undefined; props.onCodeChange(props.code.slice(0, -1));}};
  useTVEventHandler(event => {
    if (!props.recovery && !props.busy && event.eventType === 'playPause' && event.eventKeyAction !== 1) remove();
  });
  useDestinationEntryFocus({visible: !props.busy, intent: 'enter', revision: props.recovery ? 1 : 0},
    {regionId: `${id}.${props.recovery ? 'keyboard' : 'pad'}.0`, childId: props.recovery ? 'A' : '1'});
  const type = (size: number, weight: 400 | 600 | 700 | 800 = 400) => nativeType({size, weight, tracking: 0, lineHeight: 'normal'}, theme.textScale);
  const digit = (value: string) => {
    if (props.busy) return;
    if (value === 'delete') {remove(); return;}
    if (props.code.length >= 6) return;
    const next = props.code + value;
    props.onCodeChange(next);
    if (next.length === 6 && submitted.current !== next) {submitted.current = next; props.onSubmit(next);}
  };
  const recoveryKey = (key: string) => {
    if (props.busy) return;
    props.onRecoveryCodeChange(key === 'delete' ? props.recoveryCode.slice(0, -1) : key === 'clear' ? '' : props.recoveryCode + (key === 'space' ? ' ' : key));
  };
  const key = (value: string, span = 1) => {
    const recovery = props.recovery, label = value === 'delete' ? t('action.delete') : value === 'space' ? t('next.states.key.Space') : value === 'clear' ? t('filter.clear') : value;
    return <Focusable key={value} focusId={value} testID={`${id}-${recovery ? 'keyboard' : 'pad'}-${value}`} disabled={props.busy}
      accessibilityLabel={label} onPress={() => {if (recovery) recoveryKey(value); else digit(value);}} focusRadius={recovery ? 14 : 20}
      style={{width: recovery ? (860 - 80) / 9 * span + 10 * (span - 1) : 148, height: recovery ? 72 : 118,
        alignItems: 'center', justifyContent: 'center', borderRadius: recovery ? 14 : 20, backgroundColor: `${theme.colors.text}${recovery ? '0D' : '12'}`}}>
      {value === 'delete' ? <Icon name="i-backspace" size={recovery ? 32 : 46} color={theme.colors.textSecondary}/>
        : <Text style={[type(recovery ? span > 1 ? 22 : 28 : 48, 700), {color: recovery && /^\d$/.test(value) ? theme.colors.textTertiary : theme.colors.textSecondary}]}>{label}</Text>}
    </Focusable>;
  };
  const pad = !props.recovery && <View style={{position: 'absolute', right: 260, top: 0, bottom: 0, width: 484, justifyContent: 'center'}}>
    <FocusRegion id={`${id}.pad`} entry="1" enabled={!props.busy}>
      {padRows.map((row, index) => <FocusRegion key={index} id={`${id}.pad.${index}`} entry={row[0]} order={row} orientation="horizontal"
        enabled={!props.busy} edges={{up: index > 0 ? `${id}.pad.${index - 1}` : undefined, down: index < 3 ? `${id}.pad.${index + 1}` : `${id}.recovery`}}
        style={{flexDirection: 'row', gap: 20, marginBottom: index < 3 ? 20 : 0}}>{row.map(value => key(value))}</FocusRegion>)}
    </FocusRegion>
    <FocusRegion id={`${id}.recovery`} entry="recovery" enabled={!props.busy} edges={{up: `${id}.pad.3`}} style={{marginTop: 38}}>
      <Button focusId="recovery" variant="glass" disabled={props.busy} onPress={() => props.onRecoveryChange(true)}
        style={{height: 72, paddingHorizontal: 18, borderRadius: 14}} textStyle={{fontSize: 20 * theme.textScale}}>
        {t('services.signin.lostPhone')}{' '}{t('services.signin.recovery')}
      </Button>
    </FocusRegion>
  </View>;
  return <TVAuthLayout testID={`tv-${props.kind}-verification`} portico={props.kind === 'portico'}
    heading={t('web.direct.codeTitle')} body={t('services.signin.twoStep')} aside={pad}>
    {props.error && <View accessibilityRole="alert" style={{marginBottom: 16}}>{props.error}</View>}
    {!props.recovery ? <View accessibilityLabel={t('auth.verificationCode')} accessibilityValue={{min: 0, max: 6, now: props.code.length}}
      style={{flexDirection: 'row', gap: 18}}>
      {Array.from({length: 6}, (_, index) => <View key={index} accessible={false} style={{width: 104, height: 116, borderRadius: 18,
        alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.colors.ink}9E`, borderWidth: 2,
        borderColor: props.error ? theme.colors.danger : index === props.code.length ? theme.colors.accentStrong : theme.colors.lineStrong}}>
        {props.code[index] ? <Text style={[type(28, 800), {color: theme.colors.text}]}>{props.code[index]}</Text>
          : index === props.code.length && !props.busy ? <View style={{width: 3, height: 52, borderRadius: 1, backgroundColor: theme.colors.accentStrong}}/> : null}
      </View>)}
    </View> : <>
      <Text style={[type(22, 700), {color: theme.colors.textTertiary, marginBottom: 8}]}>{t('services.signin.recovery')}</Text>
      <View style={{width: 860, height: 84, borderRadius: 16, paddingHorizontal: 28, flexDirection: 'row', alignItems: 'center',
        backgroundColor: `${theme.colors.ink}9E`, borderWidth: 1.5, borderColor: theme.colors.accentStrong}}>
        <Text numberOfLines={1} style={[type(32, 600), {color: theme.colors.text, flexShrink: 1}]}>{props.recoveryCode}</Text>
        {!props.busy && <View style={{width: 3, height: 40, borderRadius: 2, marginLeft: 3, backgroundColor: theme.colors.accentStrong}}/>}
      </View>
      <FocusRegion id={`${id}.keyboard`} enabled={!props.busy} style={{gap: 10, width: 860, marginTop: 24}}>
        {recoveryRows.map((row, index) => {
          const last = index === recoveryRows.length - 1, order = last ? [...row, 'space', 'delete', 'clear'] : row;
          return <FocusRegion key={index} id={`${id}.keyboard.${index}`} entry={row[0]} order={order} orientation="horizontal" enabled={!props.busy}
            edges={{up: index > 0 ? `${id}.keyboard.${index - 1}` : undefined, down: last ? `${id}.actions` : `${id}.keyboard.${index + 1}`}}
            style={{flexDirection: 'row', gap: 10}}>{row.map(value => key(value))}{last && <>{key('space', 3)}{key('delete')}{key('clear', 2)}</>}</FocusRegion>;
        })}
      </FocusRegion>
      <FocusRegion id={`${id}.actions`} entry="submit" enabled={!props.busy} edges={{up: `${id}.keyboard.${recoveryRows.length - 1}`}} style={{flexDirection: 'row', gap: 20, marginTop: 24}}>
        <Button focusId="submit" disabled={props.busy || !props.recoveryCode} loading={props.busy} onPress={() => {if (!props.busy && props.recoveryCode) props.onSubmit(props.recoveryCode);}}>{t('action.continue')}</Button>
        <Button focusId="back" variant="glass" disabled={props.busy} onPress={props.onBack}>{t('action.back')}</Button>
      </FocusRegion>
    </>}
  </TVAuthLayout>;
}
