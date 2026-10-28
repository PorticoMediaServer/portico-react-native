import React, {useEffect, useMemo, useState} from 'react';
import {Text, View} from 'react-native';
import {settingsRowIndex, type SettingsRow} from '../../../../../../packages/client-core/src/presentation/settings-spec';
import type {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls';
import {shellType} from '../../../kit/shell/visual';
import {StateView} from '../../../kit/states';
import {useTheme} from '../../../kit/theme';
import {nativeRouteCrypto} from '../../../platform/server-connections';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {NativeScreenLifetime} from '../lifetime';
import {NativeLiveOwnerController} from '../live-owner-controller';
import {liveStabilityPatch, liveStabilityValue} from '../live-defaults-presentation';
import type {LiveDefaults} from '../live-owner-model';
import type {NativeSettingsLivePorts} from '../ports';
import {TVChoiceRow, TVEntryRow, TVSwitchRow, type TVChoice} from './TVSettingRows';

type Translate = typeof defaultI18n.t;
type Document = Readonly<{revision: number; settings: LiveDefaults}>;
const row = (id: string): SettingsRow => settingsRowIndex.get(id)!.row;
const operationId = () => [...nativeRouteCrypto.random(24)].map(byte => byte.toString(16).padStart(2, '0')).join('');

/** Live TV & Channels on TV: the server-wide live defaults through the phone's own live owner
 * controller, one revisioned save per change. Sources, guides and channels stay on the phone
 * and the web: their addresses can carry a provider's credentials. */
export function TVLiveDefaults({ports, runtime}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t as Translate;
  const owned = useMemo(() => {
    const lifetime = new NativeScreenLifetime(ports.context);
    const api = {request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => lifetime.request(next => ports.context.api.request<T>(path, method, body, next), signal)};
    return {lifetime, controller: new NativeLiveOwnerController(lifetime, api, operationId)};
  }, [ports]);
  useEffect(() => () => owned.lifetime.dispose(), [owned]);
  const [document, setDocument] = useState<Document>(), [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false);
  const [advanced, setAdvanced] = useState(false), [custom, setCustom] = useState(false), [revision, setRevision] = useState(0);
  useEffect(() => {
    setError(undefined);
    void owned.controller.liveDefaults().then(value => {if (owned.lifetime.current()) setDocument(value);}, failure => {if (owned.lifetime.current()) setError(failure);});
  }, [owned, revision]);
  if (!document) return error !== undefined ? <StateView testID="tv-server-live-error" {...runtime.error(error, () => setRevision(value => value + 1))}/> : <StateView title={t('status.loading')}/>;
  const settings = document.settings;
  const save = (patch: Partial<LiveDefaults>) => {
    if (busy || !owned.lifetime.current()) return;
    setBusy(true); setError(undefined);
    void owned.controller.saveLiveDefaults(document.revision, {...settings, ...patch})
      .then(next => {if (owned.lifetime.current()) setDocument(next);}, failure => {if (owned.lifetime.current()) {setError(failure); setRevision(value => value + 1);}})
      .finally(() => {if (owned.lifetime.current()) setBusy(false);});
  };
  const copy = (id: string) => ({testID: id, label: t(row(id).label), description: row(id).help ? t(row(id).help!) : undefined});
  const choices = (id: string, value: number | string): TVChoice[] => {
    const offered = (row(id).control.options ?? []).map(option => ({value: String(option.value), label: t(option.label), description: option.hint ? t(option.hint) : undefined}));
    if (!offered.some(option => option.value === String(value))) offered.push({value: String(value), label: String(value), description: undefined});
    return offered;
  };
  const limit = (id: string, value: number, apply: (value: number) => Partial<LiveDefaults>) => <TVChoiceRow {...copy(id)} value={String(value)} options={choices(id, value)}
    onChange={next => {const chosen = Number(next); if (row(id).control.options?.some(option => option.value === chosen)) save(apply(chosen));}}/>;
  const stability = custom ? 'custom' : liveStabilityValue(settings);
  return <View testID="tv-server-live-settings">
    {error !== undefined && <StateView variant="inline" testID="tv-server-live-save-error" {...runtime.error(error, () => setError(undefined))}/>}
    <Text style={[shellType(20, 700), {color: theme.colors.textTertiary, marginLeft: 24, marginBottom: 10}]}>{t('web.dvrSettings.liveDefaults')}</Text>
    <View style={{backgroundColor: theme.colors.raised, borderRadius: 18, marginBottom: 30}}>
      <TVChoiceRow {...copy('live.stability')} value={stability} options={choices('live.stability', stability)}
        onChange={next => {const patch = liveStabilityPatch(next); setCustom(next === 'custom'); if (patch) save(patch); else if (next === 'custom') setAdvanced(true);}}/>
      <TVChoiceRow {...copy('live.guideDays')} value={String(settings.guideDays)} options={choices('live.guideDays', settings.guideDays)}
        onChange={next => {const days = Number(next); if (Number.isSafeInteger(days) && days > 0) save({guideDays: days});}}/>
      {settings.timeshiftMinutes !== undefined && <TVChoiceRow {...copy('live.rewind')} value={String(settings.timeshiftMinutes)} options={choices('live.rewind', settings.timeshiftMinutes)}
        onChange={next => {const minutes = Number(next); if (minutes === 10 || minutes === 30 || minutes === 60 || minutes === 120) save({timeshiftMinutes: minutes});}}/>}
      <TVSwitchRow {...copy('live.logos')} checked={settings.logoImport} onChange={logoImport => save({logoImport})}/>
    </View>
    <View style={{flexDirection: 'row', marginBottom: 24}}>
      <Button testID="tv-server-live-advanced" variant="glass" size="small" trailingIcon={advanced ? 'i-up' : 'i-down'} onPress={() => setAdvanced(value => !value)}>{t('settings.section.advanced')}</Button>
    </View>
    {advanced && <View style={{backgroundColor: theme.colors.raised, borderRadius: 18, marginBottom: 30}}>
      <TVEntryRow {...copy('live.buffer')} kind="number" value={String(settings.streamBufferMs / 1000)} control={row('live.buffer').control} t={t}
        onSave={value => {if (typeof value === 'number') {setCustom(false); save({streamBufferMs: value * 1000});}}}/>
      <TVEntryRow {...copy('live.retry')} kind="number" value={String(settings.retryWindowMs / 1000)} control={row('live.retry').control} t={t}
        onSave={value => {if (typeof value === 'number') {setCustom(false); save({retryWindowMs: value * 1000});}}}/>
      <TVEntryRow {...copy('live.userAgent')} kind="text" value={settings.userAgent} maxLength={512} t={t} onSave={value => {if (typeof value === 'string') save({userAgent: value});}}/>
      <TVSwitchRow {...copy('live.discovery')} checked={settings.discoveryEnabled} onChange={discoveryEnabled => save({discoveryEnabled})}/>
      {limit('live.limit.channels', settings.importLimits.channels, channels => ({importLimits: {...settings.importLimits, channels}}))}
      {limit('live.limit.programs', settings.importLimits.programmes, programmes => ({importLimits: {...settings.importLimits, programmes}}))}
      {limit('live.limit.file', Math.round(settings.importLimits.bytes / 1048576), megabytes => ({importLimits: {...settings.importLimits, bytes: megabytes * 1048576}}))}
    </View>}
  </View>;
}
