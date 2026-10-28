import React,{useCallback,useEffect,useLayoutEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Text,View} from 'react-native';
import type {LibraryChannel,LibraryChannelTemplate} from '../../../../../../../packages/client-core/src/library-channels';
import {channelMonograms} from '../../../../../../../packages/client-core/src/presentation/kit-model/channels';
import {ChannelMark} from '../../../../kit/artwork';
import {nativeChannelLogoArtwork} from './logo-artwork';
import {defaultI18n} from '../../../../../../../packages/i18n/src';
import type {NativeSettingsLivePorts} from '../../ports';
import type {NativeShellRuntime} from '../../../../shell/runtime';
import {Button,Focusable,Switch} from '../../../../kit/controls';
import {BottomSheet} from '../../../../kit/overlays';
import {shellType} from '../../../../kit/shell/visual';
import {useTheme} from '../../../../kit/theme';
import {createNativeChannels,type NativeChannelsGroup} from './model';
import {NativeBlockPresets} from './BlockPresets';
import {NativeChannelLogo} from './ChannelLogo';
import {NativeChannelEditor} from './ChannelEditor';

type Confirmation=Readonly<{channel:LibraryChannel}>;
type ChannelMenu=Readonly<{channel:LibraryChannel}>;
type TemplateMenu=Readonly<{token:object}>;
let nextEditorAttempt=0;
type EditorAttempt=Readonly<{id:number}>;
export function NativeLibraryChannelsPage({ports,runtime}:{ports:Pick<NativeSettingsLivePorts,'context'|'requestId'>;runtime:NativeShellRuntime}) {
  const context=ports.context,reportError=runtime.reportError,[group,setGroup]=useState<NativeChannelsGroup>();
  useLayoutEffect(()=>{const next=createNativeChannels(context,reportError);setGroup(next);return next.dispose;},[context,reportError]);
  return group?.context===context?<Channels group={group} runtime={runtime}/>:null;
}
export function Channels({group,runtime}:{group:NativeChannelsGroup;runtime:NativeShellRuntime}) {
  const {reader,editor,actions}=group,theme=useTheme(),t=runtime.text.t as typeof defaultI18n.t,state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot),editing=useSyncExternalStore(editor.subscribe,editor.getSnapshot,editor.getSnapshot),action=useSyncExternalStore(actions.subscribe,actions.getSnapshot,actions.getSnapshot);
  const [confirmation,setConfirmation]=useState<Confirmation>(),[attempt,setAttempt]=useState<EditorAttempt>(),[health,setHealth]=useState<Readonly<{channel:LibraryChannel}>>(),[logoAvailable,setLogoAvailable]=useState(false),[menu,setMenu]=useState<ChannelMenu>(),[templatesMenu,setTemplatesMenu]=useState<TemplateMenu>();
  const view=useMemo(()=>({reader,active:true,confirmation:undefined as Confirmation|undefined,editor:undefined as EditorAttempt|undefined,health:undefined as Readonly<{channel:LibraryChannel}>|undefined,logo:undefined as object|undefined,menu:undefined as ChannelMenu|undefined,templates:undefined as TemplateMenu|undefined,presetsEditing:false}),[reader]);
  useLayoutEffect(()=>{view.active=true;return()=>{view.active=false;view.confirmation=undefined;view.editor=undefined;view.health=undefined;view.logo=undefined;view.menu=undefined;view.templates=undefined;view.presetsEditing=false;};},[view]);
  useEffect(()=>{void reader.load();void reader.templates();},[reader]);
  const current=useCallback(()=>view.active&&view.reader===reader&&group.current(),[view,reader,group]);
  const editorCurrent=useCallback(()=>current()&&!!attempt&&view.editor===attempt,[current,attempt,view]);
  const logoCurrent=useCallback(()=>current()&&!view.presetsEditing&&!group.presets.getSnapshot().busy&&!group.presets.getSnapshot().pending&&!group.presets.getSnapshot().reconcile&&editor.getSnapshot().phase==='closed'&&!editor.getSnapshot().pending&&!editor.getSnapshot().busy&&!actions.getSnapshot().busy&&!actions.getSnapshot().pending,[current,view,group,editor,actions]);
  const releaseLogo=useCallback((token:object)=>{if(view.logo===token)view.logo=undefined;},[view]);
  useEffect(()=>{let active=true;void group.logoCapability().then(value=>{if(active&&group.current())setLogoAvailable(value);},error=>{if(!active||!group.current())return;setLogoAvailable(false);if(error&&typeof error==='object'&&'status' in error&&(error.status===401||error.status===403))group.failure(error);});return()=>{active=false;};},[group]);
  const logoState=useSyncExternalStore(group.logos.subscribe,group.logos.getSnapshot,group.logos.getSnapshot);
  const presetsCurrent=useCallback(()=>current()&&!view.logo&&!group.logos.getSnapshot().busy&&!group.logos.getSnapshot().pending&&editor.getSnapshot().phase==='closed'&&!editor.getSnapshot().pending&&!editor.getSnapshot().busy&&!actions.getSnapshot().busy&&!actions.getSnapshot().pending,[current,view,group,editor,actions]);
  const presetEditing=useCallback((value:boolean)=>{view.presetsEditing=value;},[view]);
  const presetState=useSyncExternalStore(group.presets.subscribe,group.presets.getSnapshot,group.presets.getSnapshot);
  const commands=()=>current()&&!view.presetsEditing&&!group.presets.getSnapshot().busy&&!group.presets.getSnapshot().pending&&!group.presets.getSnapshot().reconcile&&!view.logo&&!group.logos.getSnapshot().busy&&!group.logos.getSnapshot().pending&&editor.getSnapshot().phase==='closed'&&!editor.getSnapshot().pending&&!editor.getSnapshot().busy&&!actions.getSnapshot().busy&&!actions.getSnapshot().pending;
  const claimLogo=useCallback((token:object)=>{if(!current()||view.presetsEditing||group.presets.getSnapshot().busy||group.presets.getSnapshot().pending||group.presets.getSnapshot().reconcile||view.logo||group.logos.getSnapshot().busy||group.logos.getSnapshot().pending||editor.getSnapshot().phase!=='closed'||editor.getSnapshot().pending||editor.getSnapshot().busy||actions.getSnapshot().busy||actions.getSnapshot().pending)return false;view.logo=token;return true;},[current,view,group,editor,actions]);
  const listed=(channel:LibraryChannel)=>!!reader.getSnapshot().channels?.includes(channel);
  if (view.menu && current() && !listed(view.menu.channel)) view.menu = undefined;
  if (view.confirmation && current() && !listed(view.confirmation.channel)) view.confirmation = undefined;
  if (view.health && current() && (!listed(view.health.channel) || reader.getSnapshot().selected !== view.health.channel)) view.health = undefined;
  const heldMenu = menu && view.menu === menu && current() && listed(menu.channel) ? menu : undefined;
  const menuCurrent = () => !!heldMenu && view.menu === heldMenu && current() && listed(heldMenu.channel);
  const closeMenu = () => {if (!menu || view.menu !== menu) return; view.menu = undefined; setMenu(undefined);};
  const menuAction = (perform: (channel: LibraryChannel) => void, write = true) => {
    if (!heldMenu || !menuCurrent() || write && !commands()) return;
    view.menu = undefined; setMenu(undefined); perform(heldMenu.channel);
  };
  const heldTemplates = templatesMenu && view.templates === templatesMenu && current() ? templatesMenu : undefined;
  const closeTemplates = () => {if (!templatesMenu || view.templates !== templatesMenu) return; view.templates = undefined; setTemplatesMenu(undefined);};
  const chooseTemplate = (template?: LibraryChannelTemplate) => {
    if (!heldTemplates || view.templates !== heldTemplates || !commands() || !group.timezone || template && (!template.applicable || !reader.getSnapshot().templates?.includes(template))) return;
    view.templates = undefined; setTemplatesMenu(undefined); open(undefined, template);
  };
  const open=(channel?:LibraryChannel,template?:LibraryChannelTemplate)=>{
    if(!commands()||channel&&!listed(channel)||!channel&&!group.timezone)return;
    const next={id:++nextEditorAttempt};view.editor=next;setAttempt(next);view.confirmation=undefined;setConfirmation(undefined);
    if(channel)editor.edit(channel);else if(template)editor.template(template,group.timezone!);else void editor.blank(group.timezone!);
  };
  const resume=()=>{if(!current()||view.presetsEditing||group.presets.getSnapshot().busy||group.presets.getSnapshot().pending||group.presets.getSnapshot().reconcile||view.logo||group.logos.getSnapshot().busy||group.logos.getSnapshot().pending||editor.getSnapshot().phase!=='closed'||!editor.getSnapshot().pending||editor.getSnapshot().busy||actions.getSnapshot().busy||actions.getSnapshot().pending)return;const next={id:++nextEditorAttempt};view.editor=next;setAttempt(next);editor.resume();};
  const held=confirmation&&view.confirmation===confirmation&&current()&&listed(confirmation.channel)?confirmation:undefined;
  const close=()=>{if(!held||!current()||view.confirmation!==held)return;view.confirmation=undefined;setConfirmation(undefined);};
  const confirm=async()=>{const captured=held;if(!captured||!current()||view.confirmation!==captured||!listed(captured.channel))return;const done=await actions.perform(captured.channel,'delete');if(done&&current()&&view.confirmation===captured){view.confirmation=undefined;setConfirmation(undefined);}};
  const ask=(channel:LibraryChannel)=>{if(!commands()||!listed(channel))return;const next={channel};view.confirmation=next;setConfirmation(next);};
  const heldHealth=health&&view.health===health&&current()&&state.selected===health.channel&&listed(health.channel)?health:undefined;
  const closeHealth=()=>{if(!heldHealth||!current()||view.health!==heldHealth)return;view.health=undefined;setHealth(undefined);reader.closeHealth(heldHealth.channel);};
  // Each Library Channel is its own guide source; this is the complete owner list.
  const marks=channelMonograms({kind:'complete-authorized',channels:(state.channels??[]).map(channel=>({sourceId:channel.config.id,id:channel.config.id,name:channel.config.name}))});
  const busy=action.busy||editing.busy||logoState.busy||presetState.busy,blocked=busy||!!presetState.pending||presetState.reconcile||!!logoState.pending||!!action.pending||editing.pending||editing.phase!=='closed';
  return <View style={{marginTop:14,gap:12}} testID="server-library-channels">
    <Text style={[shellType(17,800),{color:theme.colors.text}]}>{t('settings.server.libraryChannels')}</Text>
    {state.phase==='loading'&&<Text style={{color:theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}{(state.phase==='error'||action.error)&&<Text accessibilityRole="alert" style={{color:theme.colors.record}}>{t(action.pending?'error.unconfirmedChange':'error.unavailable')}</Text>}
    <View style={{flexDirection:'row',gap:8}}><Button size="compact" disabled={blocked||!group.timezone} onPress={()=>{if(commands()&&!view.menu&&!view.templates&&!view.confirmation&&!view.health){const next={token:{}};view.templates=next;setTemplatesMenu(next);}}}>{t('builder.newTitle')}</Button><Button size="compact" variant="glass" disabled={busy} onPress={()=>{if(current())void reader.load();}}>{t('web.selection.refresh')}</Button></View>
    {editing.pending&&<Button size="compact" variant="glass" disabled={editing.busy} onPress={resume}>{t('action.tryAgain')}</Button>}
    {action.pending&&<View style={{gap:8}}><Text style={{color:theme.colors.textSecondary}}>{action.pending.name}</Text><Button size="compact" variant="glass" disabled={action.busy} onPress={()=>{if(current()&&actions.getSnapshot().pending===action.pending)void actions.retry();}}>{t('action.tryAgain')}</Button></View>}
    {logoState.pending&&<View style={{gap:8}}><Text style={{color:theme.colors.textSecondary}}>{logoState.pending.name}</Text><Text style={{color:theme.colors.record}}>{t('error.unconfirmedChange')}</Text><Button size="compact" variant="glass" disabled={logoState.busy} onPress={()=>{if(logoCurrent()&&group.logos.getSnapshot().pending===logoState.pending)void group.logos.retry();}}>{t('action.tryAgain')}</Button></View>}
    {state.channels?.map(channel => <View key={channel.config.id} style={{padding: 12, gap: 8, borderRadius: 12, backgroundColor: theme.colors.raised}}>
      <Focusable accessibilityRole="button" accessibilityLabel={channel.config.name} onPress={() => {if (commands() && listed(channel) && !view.menu && !view.templates && !view.confirmation && !view.health) {const next = {channel}; view.menu = next; setMenu(next);}}} style={{gap: 8}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}><ChannelMark mark={marks.get(channel.config.id)!.get(channel.config.id)!} source={nativeChannelLogoArtwork(group, runtime, channel)} size={44} sized/><Text style={[shellType(15, 700), {color: theme.colors.text, flex: 1}]}>{channel.config.name}</Text></View>
        <Text style={{color: theme.colors.textSecondary}}>{t('builder.matches', {count: channel.candidateCount})}{' · '}{channel.state}</Text>
        {channel.generatedThrough && <Text style={{color: theme.colors.textTertiary}}>{t('web.libraryChannels.healthSchedule')}: {defaultI18n.date(channel.generatedThrough)}</Text>}
        {channel.config.description && <Text style={{color: theme.colors.textSecondary}}>{channel.config.description}</Text>}
      </Focusable>
      <Switch checked={channel.config.enabled} disabled={blocked} onCheckedChange={value => {if (commands() && listed(channel) && value !== channel.config.enabled) void actions.perform(channel, 'toggle');}}>{t('builder.on')}</Switch>
    </View>)}
    <BottomSheet open={!!heldTemplates} onOpenChange={value => {if (!value) closeTemplates();}} title={t('builder.newTitle')}>
      <View style={{gap: 12}}>
        {state.templatesLoading && <Text style={{color: theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}
        {state.templatesError && <Button variant="glass" onPress={() => {if (heldTemplates && current() && view.templates === heldTemplates) void reader.templates();}}>{t('action.tryAgain')}</Button>}
        {state.templates?.map(template => <View key={template.id} style={{gap: 4}}><Button size="compact" variant="glass" disabled={!template.applicable || blocked || !group.timezone} onPress={() => chooseTemplate(template)}>{template.name}</Button>{!template.applicable && <Text style={{color: theme.colors.textTertiary}}>{t('server.channels.notEnough')}</Text>}</View>)}
        <Button size="compact" variant="glass" disabled={blocked || !group.timezone} onPress={() => chooseTemplate()}>{t('web.libraryChannels.startFromScratch')}</Button>
      </View>
    </BottomSheet>
    <BottomSheet open={!!heldMenu} onOpenChange={value => {if (!value) closeMenu();}} title={heldMenu?.channel.config.name}>
      {heldMenu && <View style={{gap: 10}}>
        <Button size="compact" variant="glass" disabled={blocked} onPress={() => menuAction(open)}>{t('web.selection.edit')}</Button>
        {logoAvailable && <NativeChannelLogo group={group} channel={heldMenu.channel} isCurrent={() => menuCurrent() && logoCurrent()} claim={token => menuCurrent() && claimLogo(token)} release={releaseLogo}/>}
        <Button size="compact" variant="glass" disabled={blocked || state.channels?.indexOf(heldMenu.channel) === 0} onPress={() => {if ((reader.getSnapshot().channels?.indexOf(heldMenu.channel) ?? -1) > 0) menuAction(channel => {void actions.perform(channel, 'move', -1);});}}>{t('web.profile.moveUp')}</Button>
        <Button size="compact" variant="glass" disabled={blocked || state.channels?.indexOf(heldMenu.channel) === (state.channels?.length ?? 0) - 1} onPress={() => {const rows = reader.getSnapshot().channels; if (rows && rows.indexOf(heldMenu.channel) < rows.length - 1) menuAction(channel => {void actions.perform(channel, 'move', 1);});}}>{t('web.profile.moveDown')}</Button>
        <Button size="compact" variant="glass" disabled={blocked} onPress={() => menuAction(channel => {void actions.perform(channel, 'regenerate');})}>{t('web.libraryChannels.regenSchedule')}</Button>
        <Button size="compact" variant="glass" onPress={() => menuAction(channel => {const next = {channel}; view.health = next; setHealth(next); void reader.health(channel);}, false)}>{t('web.libraryChannels.checkHealth')}</Button>
        <Button size="compact" variant="danger" disabled={blocked} onPress={() => menuAction(ask)}>{t('action.delete')}</Button>
      </View>}
    </BottomSheet>
    <BottomSheet open={!!held} onOpenChange={value=>{if(!value)close();}} title={held?.channel.config.name} description={t('web.libraryChannels.deleteBody')} footer={<View style={{flexDirection:'row',gap:8}}><Button variant="glass" onPress={close}>{t('action.cancel')}</Button><Button variant="danger" disabled={action.busy} loading={action.busy} onPress={()=>{void confirm();}}>{t('action.delete')}</Button></View>}><View/></BottomSheet>
    <BottomSheet open={!!heldHealth} onOpenChange={value=>{if(!value)closeHealth();}} title={heldHealth?.channel.config.name} description={t('web.libraryChannels.healthLede')} footer={<View style={{flexDirection:'row',gap:8}}><Button variant="glass" disabled={state.healthLoading} onPress={()=>{if(heldHealth&&current()&&view.health===heldHealth&&listed(heldHealth.channel))void reader.health(heldHealth.channel);}}>{t('server.remote.checkAgain')}</Button><Button onPress={closeHealth}>{t('action.done')}</Button></View>}><View style={{gap:8}}>{state.healthLoading&&<Text style={{color:theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}{state.healthError&&<Text style={{color:theme.colors.record}}>{t('error.unavailable')}</Text>}{state.health&&<><Text style={{color:state.health.healthy?theme.colors.healthy:theme.colors.amber}}>{state.health.message||t(state.health.healthy?'web.libraryChannels.onAir':'web.libraryChannels.offAir')}</Text><Text style={{color:theme.colors.textSecondary}}>{t('web.libraryChannels.healthPrograms')}: {defaultI18n.number(state.health.scheduledEntries)}</Text><Text style={{color:theme.colors.textSecondary}}>Eligible: {defaultI18n.number(state.health.candidates)}</Text><Text style={{color:theme.colors.textSecondary}}>Unplaceable: {defaultI18n.number(state.health.unresolved)}</Text><Text style={{color:theme.colors.textSecondary}}>Building: {state.health.pendingGeneration ? t('web.filters.yes') : t('web.filters.no')}</Text>{state.health.generatedThrough&&<Text style={{color:theme.colors.textSecondary}}>{t('web.libraryChannels.healthSchedule')}: {defaultI18n.date(state.health.generatedThrough)}</Text>}</>}</View></BottomSheet>
    <NativeBlockPresets group={group} isCurrent={presetsCurrent} onEditing={presetEditing}/>
    {attempt&&view.editor===attempt&&<NativeChannelEditor key={attempt.id} group={group} runtime={runtime} isCurrent={editorCurrent}/>}
  </View>;
}
