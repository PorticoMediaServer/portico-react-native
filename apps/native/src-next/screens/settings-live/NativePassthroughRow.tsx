import React, {useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {AppState, NativeModules, View} from 'react-native';
import {Select} from '../../kit/controls';
import {SettingsRow} from '../../kit/shell';
import {StateView} from '../../kit/states';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import {passthroughFormats, type PassthroughFormat} from '../../platform/playback/passthrough-formats';
import {nativeDeviceSettings} from '../../platform/device-settings';
import {defaultI18n} from '../../../../../packages/i18n/src';

export const nativePassthroughFocusId = 'settings-device-audio-passthrough';

type ReceiverFacts = Readonly<{objects: readonly string[]; channels?: number}>;
const objectNames: Readonly<Record<string, string>> = {atmos: 'next.kit.object.atmos', dtsx: 'next.kit.object.dtsx'};

/** The active sink's reported bitstream encodings only: known object-audio names and the
 * reported channel limit. An empty or failed report leaves the child row out rather than
 * naming a receiver, a model or an output. */
function readReceiver(value: unknown): ReceiverFacts | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries = (value as {passthrough?: unknown}).passthrough;
  if (!Array.isArray(entries)) return undefined;
  const objects = new Set<string>();
  let channels: number | undefined;
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const audio = (entry as {objectAudio?: unknown}).objectAudio;
    if (Array.isArray(audio)) for (const name of audio) if (typeof name === 'string' && objectNames[name]) objects.add(objectNames[name]);
    const limit = (entry as {maxChannels?: unknown}).maxChannels;
    if (typeof limit === 'number' && Number.isInteger(limit) && limit >= 1 && limit <= 16) channels = Math.max(channels ?? 0, limit);
  }
  return {objects: [...objects], ...(channels ? {channels} : {})};
}

/** The existing disable-passthrough override; Automatic leaves the receiver capability report in charge. */
export function NativePassthroughRow({context, runtime, format}: {context: NativeShellBootstrapContext; runtime: NativeShellRuntime; format?: PassthroughFormat}) {
  const source = useMemo(() => nativeDeviceSettings(context), [context]);
  const value = useSyncExternalStore(source.subscribe, () => format ? source.readPassthroughFormat(format) : source.read('disablePassthrough') === true ? 'off' : passthroughFormats.some(key => source.readPassthroughFormat(key) === 'off') ? 'custom' : 'auto');
  const live = useMemo(() => ({owner: context, current: false}), [context]);
  const pending = useRef(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  useLayoutEffect(() => {live.current = true; return () => {live.current = false;};}, [live]);
  const [receiver, setReceiver] = useState<ReceiverFacts | null>();
  const receiverRead = useRef(0);
  useEffect(() => {
    if (format) return;
    let alive = true;
    const load = async () => {
      const read = ++receiverRead.current;
      try {
        const facts = await (NativeModules.PorticoCapabilities?.facts?.() as Promise<unknown> | undefined);
        if (!alive || read !== receiverRead.current) return;
        setReceiver(readReceiver(facts) ?? null);
      } catch {
        if (alive && read === receiverRead.current) setReceiver(null);
      }
    };
    void load();
    const subscription = AppState.addEventListener('change', value => {if (value === 'active') void load();});
    return () => {alive = false; subscription.remove();};
  }, [format]);
  const t = runtime.text.t;
  const focusId = format ? `settings-passthrough-${format}` : nativePassthroughFocusId;
  const label = format ? t(`next.settingsSpec.account.device.advanced.groups.1.rows.0.control.items.${passthroughFormats.indexOf(format)}.label` as Parameters<typeof t>[0]) : t('next.settingsSpec.account.device.groups.1.rows.6.label');
  const apply = async (next: string) => {
    if (!live.current || !live.owner.current() || pending.current || (next !== 'auto' && next !== 'off')) return;
    pending.current = true; setBusy(true); setError(undefined);
    try {await source.writePassthroughFormat(format ?? 'all', next as 'auto' | 'off');
      if (live.current && live.owner.current() && (format ? source.readPassthroughFormat(format) !== next : passthroughFormats.some(key => source.readPassthroughFormat(key) !== next))) throw new Error('native_device_preference_unreadable');}
    catch (failure) {if (live.current && live.owner.current()) setError(failure);}
    finally {pending.current = false; if (live.current && live.owner.current()) setBusy(false);}
  };
  return <View>
    <Select testID={focusId} focusId={focusId} rowLabel={label}
      description={format ? undefined : t('next.settingsSpec.account.device.groups.1.rows.6.help')} disabled={busy} value={value}
      options={[
        {value: 'auto', label: t('next.settingsSpec.account.device.groups.1.rows.6.control.options.0.label')},
        {value: 'off', label: t('next.settingsSpec.account.device.groups.1.rows.6.control.options.1.label')},
        ...(!format ? [{value: 'custom', label: t('next.settingsSpec.account.device.groups.1.rows.6.control.options.2.label'), disabled: true}] : []),
      ]} onValueChange={next => {void apply(next);}}/>
    {!format && receiver && (receiver.objects.length > 0 || receiver.channels !== undefined) && (
      <SettingsRow testID="settings-device-receiver" dependent readable
        label={t('next.settingsSpec.account.device.groups.1.rows.6.children.0.label')}
        value={[
          receiver.objects.length ? defaultI18n.list(receiver.objects.map(id => t(id as Parameters<typeof t>[0])), 'and') : undefined,
          receiver.channels !== undefined ? t('next.deviceCapabilities.channels', {count: receiver.channels}) : undefined,
        ].filter((part): part is string => !!part).join(' · ')}/>
    )}
    {error !== undefined && <StateView variant="inline" {...runtime.error(error, () => setError(undefined))}/>}
  </View>;
}
