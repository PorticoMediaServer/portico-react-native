import React, {useEffect, useRef} from 'react';
import {useTVEventHandler} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ProfileOption} from '../../kit/artwork';
import {FocusProvider} from '../../kit/focus';
import {useDestinationEntryFocus} from '../../screens/destinations/useEntryFocus';
import {TVProfilePINLayout} from './TVAuthLayout';
import {TVCodeBoxes, TVNumericPad} from './TVNumericPad';

export type TVProfilePINFormProps = Readonly<{
  profile: ProfileOption; code: string; onCodeChange: (value: string) => void;
  busy: boolean; error?: React.ReactNode; hints?: React.ReactNode;
  onSubmit: (value: string) => void; onBack: () => void; onForgotPIN: () => void;
}>;

/** Profile PIN uses only the drawn numeric pad, never a TextInput or system keyboard. */
export function TVProfilePINForm(props: TVProfilePINFormProps) {
  return <FocusProvider><ProfilePINForm {...props}/></FocusProvider>;
}
function ProfilePINForm(props: TVProfilePINFormProps) {
  const id = `tv.auth.profile.${JSON.stringify(props.profile.id)}.pin`, submitted = useRef<string | undefined>(undefined);
  useEffect(() => {if (!props.code) submitted.current = undefined;}, [props.code]);
  const remove = () => {if (!props.busy) {submitted.current = undefined; props.onCodeChange(props.code.slice(0, -1));}};
  useTVEventHandler(event => {if (event.eventType === 'playPause' && event.eventKeyAction !== 1) remove();});
  useDestinationEntryFocus({visible: !props.busy, intent: 'enter', revision: 0}, {regionId: `${id}.pad.0`, childId: '1'});
  const digit = (value: string) => {
    if (props.busy || props.code.length >= 4 || !/^\d$/.test(value)) return;
    const next = props.code + value;
    props.onCodeChange(next);
    if (next.length === 4 && submitted.current !== next) {submitted.current = next; props.onSubmit(next);}
  };
  return <TVProfilePINLayout profile={props.profile} error={props.error} hints={props.hints} onBack={props.onBack}
    pad={<TVNumericPad id={id} busy={props.busy} onDigit={digit} onDelete={remove} help={defaultI18n.t('pin.forgot')} onHelp={props.onForgotPIN}/>}>
    <TVCodeBoxes code={props.code} length={4} masked busy={props.busy} error={!!props.error}/>
  </TVProfilePINLayout>;
}
