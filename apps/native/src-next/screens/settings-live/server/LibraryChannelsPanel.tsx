import React, {useEffect, useMemo, useState} from 'react';
import {Text, View} from 'react-native';
import {readLibraryChannels, readLibraryTemplates, saveLibraryChannel, type LibraryChannel, type LibraryChannelTemplate} from '../../../../../../packages/client-core/src/library-channels';
import {regenerationBody} from '../../../../../../packages/client-core/src/server-admin/panel-logic';
import {sentence, when} from '../../../../../../packages/client-core/src/server-admin/console-words';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {Menu, type MenuEntry} from '../../../kit/overlays';
import {StateView} from '../../../kit/states';
import {shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';

type Translate = typeof defaultI18n.t;

/** Settings › Server › Live TV & Channels › Library Channels (owner-server.html frame 41). */
export function NativeLibraryChannelsPanel({ports, runtime}: {ports: Pick<NativeSettingsLivePorts, 'context' | 'requestId'>; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context, authority = context.authority();
  const api = useMemo(() => ({request: <T,>(path: string, method?: string, body?: unknown, signal?: AbortSignal) => context.api.request<T>(path, method, body, signal)}), [context]);
  const [channels, setChannels] = useState<readonly LibraryChannel[]>([]), [templates, setTemplates] = useState<readonly LibraryChannelTemplate[]>([]);
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string>();
  const [menu, setMenu] = useState<Readonly<{channel: LibraryChannel; index: number}>>(), [creating, setCreating] = useState(false), [template, setTemplate] = useState<LibraryChannelTemplate>();
  const [removing, setRemoving] = useState<LibraryChannel>(), [healthFor, setHealthFor] = useState<LibraryChannel>();
  const reload = () => {
    setProblem(undefined);
    void Promise.all([readLibraryChannels(api, authority.serverId), readLibraryTemplates(api, authority.serverId)])
      .then(([list, choices]) => {setChannels([...list].sort((a, b) => a.config.position - b.config.position)); setTemplates(choices);}, setError);
  };
  useEffect(() => {reload();}, [context]);
  const run = (work: () => Promise<unknown>) => {
    setBusy(true); setProblem(undefined);
    void work().then(() => {setBusy(false); reload();}, failure => {setBusy(false); setProblem(presentError(failure, 'server-console').body);});
  };
  const toggle = (channel: LibraryChannel) => run(async () => {
    await saveLibraryChannel(api, authority.serverId, {...channel.config, enabled: !channel.config.enabled}, channel.revision, ports.requestId());
  });
  const move = (index: number, direction: -1 | 1) => {
    const next = [...channels], target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    const payload = {channels: next.map(channel => ({id: channel.config.id, expectedRevision: channel.revision}))};
    run(async () => {await api.request('/v1/admin/library-channels/reorder', 'POST', {requestId: ports.requestId(), ...payload});});
  };
  const regenerate = (channel: LibraryChannel) => run(async () => {
    await api.request(`/v1/admin/library-channels/${encodeURIComponent(channel.config.id)}/regenerate`, 'POST', regenerationBody(channel, ports.requestId()));
  });
  const create = () => {
    const chosen = template;
    if (!chosen) return;
    setBusy(true); setProblem(undefined);
    const config = {...JSON.parse(JSON.stringify(chosen.config)) as LibraryChannelTemplate['config'], id: `lc-${ports.requestId().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24)}`, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', templateId: chosen.id};
    void saveLibraryChannel(api, authority.serverId, config, 0, ports.requestId()).then(() => {setTemplate(undefined); setCreating(false); reload();}, failure => setProblem(presentError(failure, 'server-console').body)).finally(() => setBusy(false));
  };
  const remove = () => {
    const target = removing;
    if (!target) return;
    setBusy(true);
    void api.request(`/v1/admin/library-channels/${encodeURIComponent(target.config.id)}/delete`, 'POST', {requestId: ports.requestId(), expectedRevision: target.revision})
      .then(() => {setRemoving(undefined); reload();}, failure => setProblem(presentError(failure, 'server-console').body)).finally(() => setBusy(false));
  };
  const entries = (channel: LibraryChannel, index: number): readonly MenuEntry[] => [
    {id: 'toggle', label: t(channel.config.enabled ? 'web.libraryChannels.turnOff' : 'web.libraryChannels.turnOn'), icon: channel.config.enabled ? 'i-pause' : 'i-play', onSelect: () => {setMenu(undefined); toggle(channel);}},
    {id: 'regen', label: t('web.libraryChannels.regenSchedule'), icon: 'i-refresh', disabled: !channel.replacementBoundary, onSelect: () => {setMenu(undefined); regenerate(channel);}},
    {id: 'health', label: t('web.libraryChannels.checkHealth'), icon: 'i-info', onSelect: () => {setMenu(undefined); setHealthFor(channel);}},
    {id: 'up', label: t('web.profile.moveUp'), icon: 'i-up', disabled: index === 0, onSelect: () => {setMenu(undefined); move(index, -1);}},
    {id: 'down', label: t('web.profile.moveDown'), icon: 'i-down', disabled: index === channels.length - 1, onSelect: () => {setMenu(undefined); move(index, 1);}},
    {id: 'remove', label: t('web.libraryChannels.delete'), icon: 'i-trash', destructive: true, onSelect: () => {setMenu(undefined); setRemoving(channel);}},
  ];
  const facts = (channel: LibraryChannel) => [channel.config.description, t('server.channels.titles', {count: channel.candidateCount}), channel.generatedThrough ? t('server.channels.through', {when: when(Date.parse(channel.generatedThrough))}) : '', channel.healthCode ? sentence(channel.healthCode) : ''].filter(Boolean).join(' · ');
  if (error !== undefined && !channels.length) return <StateView {...runtime.error(error, reload)}/>;
  return <View testID="server-library-channels">
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10}}>
      <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('settings.server.libraryChannels')}</Text>
      {templates.length ? <Button size="compact" icon="i-plus" onPress={() => {setProblem(undefined); setCreating(true);}}>{t('builder.newTitle')}</Button> : null}
    </View>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('web.console.nav.channelsLede')}</Text>
    {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 8}]}>{problem}</Text> : null}
    <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {!channels.length ? <View style={{padding: 14}}>
        <Text style={[shellType(15, 700), {color: theme.colors.text}]}>{t('builder.empty.title')}</Text>
        <Text style={[shellType(12.5, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('builder.empty.body')}</Text>
      </View> : null}
      {channels.map((channel, index) => <Button key={channel.config.id} variant="text" size="compact" onPress={() => setMenu({channel, index})}
        style={{alignItems: 'flex-start', minHeight: 0, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <View style={{flex: 1, minWidth: 0}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
            <Text numberOfLines={1} style={[shellType(15, 700), {color: theme.colors.text, flexShrink: 1}]}>{channel.config.name}</Text>
            {!channel.config.enabled ? <Text style={[shellType(11.5, 700), {color: theme.colors.textTertiary}]}>{t('web.libraryChannels.offState')}</Text> : null}
          </View>
          <Text numberOfLines={2} style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{facts(channel)}</Text>
        </View>
      </Button>)}
    </View>
    <Menu open={Boolean(menu)} onOpenChange={open => {if (!open) setMenu(undefined);}} presentation="sheet" testID="server-library-channel-menu" title={menu?.channel.config.name}
      items={menu ? entries(menu.channel, menu.index) : []}/>
    <BottomSheet open={creating} onOpenChange={open => {if (!open && !busy) setCreating(false);}} testID="server-library-channel-new" title={t('builder.newTitle')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setCreating(false)}>{t('action.cancel')}</Button></View>}>
      <View style={{gap: 8}}>
        {templates.map(choice => <Button key={choice.id} size="compact" variant="glass" disabled={!choice.applicable} onPress={() => {setTemplate(choice); setCreating(false);}}
          style={{alignItems: 'flex-start', minHeight: 0, paddingVertical: 10}}>
          <View style={{flex: 1}}><Text style={[shellType(14, 700), {color: theme.colors.text}]}>{choice.name}</Text>
            <Text style={[shellType(12, 400, 16), {color: theme.colors.textTertiary, marginTop: 2}]}>{choice.applicable ? choice.description : sentence(choice.reason || 'not enough media')}</Text></View>
        </Button>)}
      </View>
    </BottomSheet>
    <BottomSheet open={Boolean(template)} onOpenChange={open => {if (!open && !busy) setTemplate(undefined);}} testID="server-library-channel-create"
      title={template ? t('server.channels.createTitle', {name: template.name}) : undefined} description={template?.description}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setTemplate(undefined)}>{t('action.cancel')}</Button>
        <Button loading={busy} onPress={create}>{t('builder.empty.create')}</Button></View>}><View/></BottomSheet>
    <BottomSheet open={Boolean(removing)} onOpenChange={open => {if (!open && !busy) setRemoving(undefined);}} testID="server-library-channel-delete"
      title={removing ? t('web.libraryChannels.deleteTitle', {name: removing.config.name}) : undefined} description={t('web.libraryChannels.deleteBody')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setRemoving(undefined)}>{t('action.cancel')}</Button>
        <Button variant="glass" textStyle={{color: theme.colors.record}} loading={busy} onPress={remove}>{t('web.libraryChannels.delete')}</Button></View>}><View/></BottomSheet>
    <ChannelHealthSheet channel={healthFor} api={api} t={t} close={() => setHealthFor(undefined)}/>
  </View>;
}

function ChannelHealthSheet({channel, api, t, close}: {channel?: LibraryChannel; api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>}; t: Translate; close: () => void}) {
  const theme = useTheme();
  const [health, setHealth] = useState<{healthy: boolean; message: string; generatedThrough: string; scheduledEntries: number; candidates: number; unresolved: number; pendingGeneration: boolean}>(), [error, setError] = useState<unknown>();
  useEffect(() => {
    if (!channel) {setHealth(undefined); return;}
    let live = true;
    setError(undefined);
    void api.request<unknown>(`/v1/admin/library-channels/${encodeURIComponent(channel.config.id)}/health`).then(raw => {
      const value = (((raw as {result?: unknown}).result ?? raw) as Record<string, unknown>);
      if (!live) return;
      setHealth({healthy: value.healthy === true, message: typeof value.message === 'string' ? value.message : '', generatedThrough: typeof value.generatedThrough === 'string' ? value.generatedThrough : '', scheduledEntries: Number(value.scheduledEntries) || 0, candidates: Number(value.candidates) || 0, unresolved: Number(value.unresolved) || 0, pendingGeneration: value.pendingGeneration === true});
    }, failure => {if (live) setError(failure);});
    return () => {live = false;};
  }, [channel, api]);
  return <BottomSheet open={Boolean(channel)} onOpenChange={open => {if (!open) close();}} testID="server-library-channel-health" title={channel?.config.name} description={t('web.libraryChannels.healthLede')}
    footer={<View style={{flexDirection: 'row'}}><Button onPress={close}>{t('action.done')}</Button></View>}>
    <View style={{gap: 8}}>
      {error !== undefined ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record}]}>{presentError(error, 'server-console').body}</Text> : null}
      {health ? <>
        <Text style={[shellType(14, 600), {color: health.healthy ? theme.colors.healthy : theme.colors.amber}]}>{health.message || t(health.healthy ? 'web.libraryChannels.onAir' : 'web.libraryChannels.offAir')}</Text>
        <HealthRow label={t('web.libraryChannels.healthSchedule')} value={health.generatedThrough ? when(Date.parse(health.generatedThrough)) : t('web.libraryChannels.healthNotGenerated')}/>
        <HealthRow label={t('web.libraryChannels.healthPrograms')} value={defaultI18n.number(health.scheduledEntries)}/>
        <HealthRow label={t('web.libraryChannels.healthCandidates')} value={defaultI18n.number(health.candidates)}/>
        {health.unresolved ? <HealthRow label={t('web.libraryChannels.healthUnresolved')} value={defaultI18n.number(health.unresolved)}/> : null}
        <HealthRow label={t('web.libraryChannels.healthNewSchedule')} value={t(health.pendingGeneration ? 'web.libraryChannels.healthBeingMade' : 'web.libraryChannels.healthUpToDate')}/>
      </> : null}
    </View>
  </BottomSheet>;
}

function HealthRow({label, value}: {label: string; value: string}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 4}}>
    <Text style={[shellType(13.5, 500), {color: theme.colors.textSecondary, flex: 1}]}>{label}</Text>
    <Text style={[shellType(13.5, 600), {color: theme.colors.text}]}>{value}</Text>
  </View>;
}
