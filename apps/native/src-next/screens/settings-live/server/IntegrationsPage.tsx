import {useSettingsRequestScope} from '../use-settings-request-scope';
import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {ScrollView, Share, Text, View} from 'react-native';
import {createWebhook, deleteWebhook, listWebhooks, type Webhook, type WebhookEvent} from '../../../../../../packages/client-core/src/api-access';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import {assistantAddress} from '../../../../../../packages/client-core/src/server-admin/api-words';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {MessageId} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls/Button';
import {TextField} from '../../../kit/controls/TextField';
import {Tabs} from '../../../kit/controls/Tabs';
import {BottomSheet} from '../../../kit/overlays/BottomSheet';
import {Menu, type MenuEntry} from '../../../kit/overlays';
import {ServerHeader} from '../../../kit/shell/ServerIdentity';
import {StateView} from '../../../kit/states';
import {alpha, shellType} from '../../../kit/shell/visual';
import {useTheme} from '../../../kit/theme';
import type {NativeSettingsLivePorts} from '../ports';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {copyText} from '../../../platform/clipboard';
import {createNativeApiKeys, NativeApiKeys} from './integrations/ApiKeys';

type ViewerRole = 'owner' | 'administrator' | 'member';
type Translate = typeof defaultI18n.t;

/** Settings › Server › Integrations on the phone (owner-server.html frames 38–39). */
export function NativeServerIntegrations({ports, runtime, compactHeader = false}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; compactHeader?: boolean}) {
  const theme = useTheme(), t = runtime.text.t as Translate, context = ports.context;
  const viewerRole: ViewerRole = context.account.account.role === 'owner' ? 'owner' : context.account.canManage ? 'administrator' : 'member';
  const [tab, setTab] = useState('keys');
  const [keys, setKeys] = useState<ReturnType<typeof createNativeApiKeys>>(), [keyCreateRequest, setKeyCreateRequest] = useState(0);
  const keyRequest = useRef(0), keySequence = useRef(0), operationId = ports.requestId, reportError = runtime.reportError;
  useLayoutEffect(() => {const next = createNativeApiKeys(context, operationId, reportError);setKeys(next);return () => {keyRequest.current = 0;next.dispose();};}, [context, operationId, reportError]);
  const consumeKeyCreate = useCallback((request: number) => {if (!keys || keys.context !== context || !keys.current() || keyRequest.current !== request) return false;keyRequest.current = 0;setKeyCreateRequest(0);return true;}, [keys, context]);
  const openCreateKey = () => {if (!keys || keys.context !== context || !keys.current()) return;const request = ++keySequence.current;keyRequest.current = request;setKeyCreateRequest(request);setTab('keys');};
  return <View style={{flex: 1}}>
    <ScrollView contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 40}}>
      <ServerHeader serverName={context.serverName} viewerRole={viewerRole} audience={viewerRole === 'administrator' ? 'administrators' : 'owner'} variant="phone" style={{marginBottom: 12}}/>
      {!compactHeader && <Text accessibilityRole="header" style={[shellType(28, 800, 33, -.03), {color: theme.colors.text}]}>{t('settings.server.integrations')}</Text>}
      <Tabs testID="server-integrations-tabs" style={{marginTop: 12, marginHorizontal: -20}} value={tab} onValueChange={setTab} accessibilityLabel={t('settings.server.integrations')}
        items={[{value: 'keys', label: t('web.access.apiKeys')}, {value: 'webhooks', label: t('api.webhooks.title')}, {value: 'assistants', label: t('api.mcp.title')}]}/>
      {tab === 'keys' && keys?.context === context && keys.current() && <NativeApiKeys group={keys} runtime={runtime} createRequest={keyCreateRequest} consumeCreateRequest={consumeKeyCreate}/>}
      {tab === 'webhooks' && <WebhooksTab ports={ports} runtime={runtime} t={t}/>}
      {tab === 'assistants' && <AssistantsTab ports={ports} t={t} openCreateKey={openCreateKey} isCurrent={() => keys?.context === context && keys.current()}/>}
    </ScrollView>
  </View>;
}

const eventGroups: readonly {title: MessageId; events: readonly WebhookEvent[]}[] = [
  {title: 'api.webhooks.lede', events: ['title.added', 'title.updated', 'title.removed']},
  {title: 'web.logs.messages', events: ['scan.started', 'scan.finished']},
  {title: 'settings.server.dashboard', events: ['playback.started', 'playback.paused', 'playback.resumed', 'playback.stopped']},
  {title: 'settings.server.recording', events: ['recording.finished', 'recording.failed']},
  {title: 'settings.server.people', events: ['member.signed_in']},
  {title: 'settings.server.storage', events: ['backup.succeeded', 'backup.failed', 'storage.low', 'update.available', 'server.started']},
];

function WebhooksTab({ports, runtime, t}: {ports: NativeSettingsLivePorts; runtime: NativeShellRuntime; t: Translate}) {
  const theme = useTheme(), context = ports.context;
  const {api, lifetime} = useSettingsRequestScope(context);
  const [hooks, setHooks] = useState<readonly Webhook[]>([]), [error, setError] = useState<unknown>(), [adding, setAdding] = useState(false);
  const [name, setName] = useState(''), [url, setUrl] = useState(''), [events, setEvents] = useState<readonly string[]>(['title.added']), [signing, setSigning] = useState('');
  const [secret, setSecret] = useState<{title: string; value: string}>(), [removing, setRemoving] = useState<Webhook>(), [menu, setMenu] = useState<Webhook>(), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string>();
  const reload = useCallback(() => {
    if (!lifetime.current()) return;
    void listWebhooks(api).then(value => {if (lifetime.current()) {setHooks(value.items); setError(undefined);}}, failure => {if (lifetime.current()) setError(failure);});
  }, [api, lifetime]);
  useEffect(() => {reload();}, [reload]);
  const toggle = (event: string) => setEvents(current => current.includes(event) ? current.filter(value => value !== event) : [...current, event]);
  const add = () => {
    setBusy(true); setProblem(undefined);
    void createWebhook(api, {name: name.trim(), url: url.trim(), events, ...(signing.trim() ? {secret: signing.trim()} : {})}).then(issued => {
      setAdding(false); setName(''); setUrl(''); setEvents(['title.added']); setSigning('');
      if (issued.secret) setSecret({title: issued.webhook.name, value: issued.secret});
      reload();
    }, failure => setProblem(presentError(failure, 'server-console').body)).finally(() => setBusy(false));
  };
  const remove = () => {
    const target = removing;
    if (!target) return;
    setBusy(true);
    void deleteWebhook(api, target.id).then(() => {setRemoving(undefined); reload();}, failure => setProblem(presentError(failure, 'server-console').body)).finally(() => setBusy(false));
  };
  if (error !== undefined && !hooks.length) return <StateView {...runtime.error(error, reload)}/>;
  return <View style={{marginTop: 14}} testID="server-integrations-webhooks">
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10}}>
      <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('api.webhooks.title')}</Text>
      <Button size="compact" icon="i-plus" onPress={() => {setName(''); setUrl(''); setEvents(['title.added']); setSigning(''); setProblem(undefined); setAdding(true);}}>{t('api.webhooks.add')}</Button>
    </View>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('api.webhooks.lede')}</Text>
    {problem && !adding ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record, marginTop: 8}]}>{problem}</Text> : null}
    <View style={{marginTop: 10, borderRadius: 14, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {!hooks.length ? <Text style={[shellType(13, 500), {color: theme.colors.textTertiary, padding: 14}]}>{t('api.webhooks.none')}</Text> : null}
      {hooks.map((hook, index) => <Button key={hook.id} variant="text" size="compact" onPress={() => setMenu(hook)}
        style={{alignItems: 'flex-start', minHeight: 0, paddingHorizontal: 14, paddingVertical: 11, borderTopWidth: index ? 1 : 0, borderTopColor: theme.colors.lineSoft}}>
        <View style={{flex: 1, minWidth: 0}}>
          <Text numberOfLines={1} style={[shellType(15, 700), {color: theme.colors.text}]}>{hook.name}</Text>
          <Text numberOfLines={1} style={[shellType(12.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{hook.url}</Text>
          <Text numberOfLines={2} style={[shellType(12, 500), {color: hook.failing ? theme.colors.record : theme.colors.accentStrong, marginTop: 2}]}>
            {hook.failing ? t('api.webhooks.failing', {count: hook.failing}) : hook.enabled ? t('api.webhooks.eventCount', {count: hook.events.length}) : t('api.webhooks.off')}
          </Text>
        </View>
      </Button>)}
    </View>
    <Menu open={Boolean(menu)} onOpenChange={open => {if (!open) setMenu(undefined);}} presentation="sheet" testID="server-webhook-menu" title={menu?.name}
      items={menu ? [{id: 'remove', label: t('action.delete'), icon: 'i-trash', destructive: true, onSelect: () => {const target = menu; setMenu(undefined); setProblem(undefined); setRemoving(target);}}] as readonly MenuEntry[] : []}/>
    <BottomSheet open={adding} onOpenChange={open => {if (!open && !busy) setAdding(false);}} testID="server-webhook-add" keyboardAvoiding title={t('api.webhooks.add')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setAdding(false)}>{t('action.cancel')}</Button><Button loading={busy} disabled={!name.trim() || !url.trim() || !events.length} onPress={add}>{t('api.webhooks.add')}</Button></View>}>
      <View style={{gap: 12}}>
        <TextField label={t('auth.yourName')} value={name} onChangeText={setName} maxLength={160}/>
        <TextField label={t('api.webhooks.url')} description={t('api.webhooks.urlHelp')} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url"/>
        <Text style={[shellType(14, 700), {color: theme.colors.text}]}>{t('api.webhooks.events')}</Text>
        {eventGroups.map(group => <View key={group.title} style={{gap: 6}}>
          <Text style={[shellType(12.5, 700), {color: theme.colors.textTertiary}]}>{t(group.title)}</Text>
          {group.events.map(event => <Button key={event} variant={events.includes(event) ? 'primary' : 'glass'} size="compact" onPress={() => toggle(event)}>{t(`api.webhooks.event.${event}` as MessageId)}</Button>)}
        </View>)}
        <TextField label={t('api.webhooks.secret')} value={signing} onChangeText={setSigning} autoCapitalize="none" autoCorrect={false}/>
        {problem ? <Text accessibilityRole="alert" style={[shellType(13, 600), {color: theme.colors.record}]}>{problem}</Text> : null}
      </View>
    </BottomSheet>
    <SecretSheet value={secret} t={t} close={() => setSecret(undefined)}/>
    <BottomSheet open={Boolean(removing)} onOpenChange={open => {if (!open && !busy) setRemoving(undefined);}} testID="server-webhook-remove"
      title={removing ? t('api.webhooks.removeTitle', {name: removing.name}) : undefined} description={t('api.webhooks.removeBody')}
      footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" disabled={busy} onPress={() => setRemoving(undefined)}>{t('action.cancel')}</Button>
        <Button variant="glass" textStyle={{color: theme.colors.record}} loading={busy} onPress={remove}>{t('action.delete')}</Button></View>}><View/></BottomSheet>
  </View>;
}

function AssistantsTab({ports, t, openCreateKey, isCurrent}: {ports: NativeSettingsLivePorts; t: Translate; openCreateKey: () => void; isCurrent: () => boolean}) {
  const theme = useTheme(), context = ports.context;
  const address = assistantAddress(context.api.baseUrl), [copied, setCopied] = useState(false), [failed, setFailed] = useState(false);
  const scope = useMemo(() => ({context, address, active: true}), [context, address]);
  useLayoutEffect(() => {scope.active = true;setCopied(false);setFailed(false);return () => {scope.active = false;};}, [scope]);
  const current = () => scope.active && scope.context === context && scope.address === address && context.current() && isCurrent();
  const copy = async () => {if (!current()) return;try {await copyText(address);if (current()) {setCopied(true);setFailed(false);}} catch {if (current()) setFailed(true);}};
  const share = async () => {if (!current()) return;try {await Share.share({title:t('api.mcp.title'),message:address});} catch {if (current()) setFailed(true);}};
  return <View style={{marginTop: 14}} testID="server-integrations-assistants">
    <Text style={[shellType(17, 800), {color: theme.colors.text}]}>{t('api.mcp.title')}</Text>
    <Text style={[shellType(13, 400, 18), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('api.mcp.lede')}</Text>
    <Text style={[shellType(14, 700), {color: theme.colors.text, marginTop: 16}]}>{t('api.mcp.address')}</Text>
    <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textTertiary, marginTop: 2}]}>{t('api.mcp.addressHelp')}</Text>
    <View style={{marginTop: 8, borderRadius: 12, padding: 12, backgroundColor: alpha(theme.colors.ink, .55), borderWidth: 1, borderColor: theme.colors.lineSoft}}>
      <Text selectable style={[shellType(13, 500, 18), {color: theme.colors.text}]}>{address}</Text>
    </View>
    <View style={{flexDirection: 'row', gap: 8, marginTop: 10}}><Button size="compact" variant="glass" icon="i-copy" onPress={() => {void copy();}}>{t('web.twoStep.copy')}</Button><Button size="compact" variant="glass" icon="i-link" onPress={() => {void share();}}>{t('api.mcp.shareAddress')}</Button></View>{copied && <Text style={[shellType(13,500),{color:theme.colors.accentStrong}]}>{t('api.credential.copied')}</Text>}{failed && <Text accessibilityRole="alert" style={[shellType(13,500),{color:theme.colors.record}]}>{t('error.unavailable')}</Text>}
    <Text style={[shellType(12.5, 400, 17), {color: theme.colors.textSecondary, marginTop: 14}]}>{t('api.mcp.keyHelp')}</Text><Button size="compact" variant="glass" onPress={() => {if (current()) openCreateKey();}}>{t('web.access.createKey')}</Button>
  </View>;
}

function SecretSheet({value, t, close}: {value?: {title: string; value: string}; t: Translate; close: () => void}) {
  const theme = useTheme();
  return <BottomSheet open={Boolean(value)} onOpenChange={open => {if (!open) close();}} testID="server-integration-secret" title={value?.title}
    description={t('api.tokens.shownOnce')}
    footer={<View style={{flexDirection: 'row', gap: 8}}><Button variant="glass" icon="i-copy" disabled={!value} onPress={() => {if (value) void Share.share({title: value.title, message: value.value}).catch(() => {});}}>{t('api.tokens.share')}</Button>
      <Button onPress={close}>{t('web.access.copiedIt')}</Button></View>}>
    <View style={{borderRadius: 12, padding: 12, backgroundColor: alpha(theme.colors.ink, .55), borderWidth: 1, borderColor: theme.colors.lineSoft}}>
      <Text selectable style={[shellType(12.5, 500, 18), {color: theme.colors.text}]}>{value?.value}</Text>
    </View>
  </BottomSheet>;
}
