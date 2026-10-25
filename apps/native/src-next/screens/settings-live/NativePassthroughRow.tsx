import React, {useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {Select} from '../../kit/controls';
import {StateView} from '../../kit/states';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {nativeDeviceSettings} from '../../platform/device-settings';

export const nativePassthroughFocusId = 'settings-device-audio-passthrough';

/** The existing disable-passthrough override; Automatic leaves the receiver capability report in charge. */
export function NativePassthroughRow({context, runtime}: {context: NativeShellBootstrapContext; runtime: NativeShellRuntime}) {
  const source = useMemo(() => nativeDeviceSettings(context), [context]);
  const value = useSyncExternalStore(source.subscribe, () => source.read('disablePassthrough'));
  const live = useMemo(() => ({owner: context, current: false}), [context]);
  const pending = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  useLayoutEffect(() => {live.current = true; return () => {live.current = false;};}, [live]);
  const t = runtime.text.t;
  if (typeof value !== 'boolean') return null;
  const apply = async (next: string) => {
    if (!live.current || !live.owner.current() || pending.current || (next !== 'auto' && next !== 'off')) return;
    pending.current = true; setBusy(true); setError(undefined);
    try {await source.write('disablePassthrough', next === 'off');
      if (live.current && live.owner.current() && source.read('disablePassthrough') !== (next === 'off')) throw new Error('native_device_preference_unreadable');}
    catch (failure) {if (live.current && live.owner.current()) setError(failure);}
    finally {pending.current = false; if (live.current && live.owner.current()) setBusy(false);}
  };
  return <View>
    <Select testID={nativePassthroughFocusId} focusId={nativePassthroughFocusId} rowLabel={t('next.settingsSpec.account.device.groups.1.rows.6.label')}
      description={t('next.settingsSpec.account.device.groups.1.rows.6.help')} disabled={busy} value={value ? 'off' : 'auto'}
      options={[
        {value: 'auto', label: t('next.settingsSpec.account.device.groups.1.rows.6.control.options.0.label')},
        {value: 'off', label: t('next.settingsSpec.account.device.groups.1.rows.6.control.options.1.label')},
      ]} onValueChange={next => {void apply(next);}}/>
    {error !== undefined && <StateView variant="inline" {...runtime.error(error, () => setError(undefined))}/>}
  </View>;
}
