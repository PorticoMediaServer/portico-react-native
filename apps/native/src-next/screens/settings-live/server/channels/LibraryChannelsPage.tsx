import React,{useCallback,useEffect,useLayoutEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Text,View} from 'react-native';
import type {LibraryChannel,LibraryChannelTemplate} from '../../../../../../../packages/client-core/src/library-channels';
import {defaultI18n} from '../../../../../../../packages/i18n/src';
import type {NativeSettingsLivePorts} from '../../ports';
import type {NativeShellRuntime} from '../../../../shell/runtime';
import {Button,Switch} from '../../../../kit/controls';
import {BottomSheet} from '../../../../kit/overlays';
import {shellType} from '../../../../kit/shell/visual';
import {useTheme} from '../../../../kit/theme';
import {createNativeChannels,type NativeChannelsGroup} from './model';
import {NativeChannelEditor} from './ChannelEditor';

type Confirmation=Readonly<{channel:LibraryChannel}>;
let nextEditorAttempt=0;
type EditorAttempt=Readonly<{id:number}>;
export function NativeLibraryChannelsPage({ports,runtime}:{ports:Pick<NativeSettingsLivePorts,'context'|'requestId'>;runtime:NativeShellRuntime}) {
  const context=ports.context,reportError=runtime.reportError,[group,setGroup]=useState<NativeChannelsGroup>();
  useLayoutEffect(()=>{const next=createNativeChannels(context,reportError);setGroup(next);return next.dispose;},[context,reportError]);
  return group?.context===context?<Channels group={group} runtime={runtime}/>:null;
}
function Channels({group,runtime}:{group:NativeChannelsGroup;runtime:NativeShellRuntime}) {
  const {reader,editor,actions}=group,theme=useTheme(),t=runtime.text.t as typeof defaultI18n.t,state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot),editing=useSyncExternalStore(editor.subscribe,editor.getSnapshot,editor.getSnapshot),action=useSyncExternalStore(actions.subscribe,actions.getSnapshot,actions.getSnapshot);
  const [confirmation,setConfirmation]=useState<Confirmation>(),[attempt,setAttempt]=useState<EditorAttempt>(),[health,setHealth]=useState<Readonly<{channel:LibraryChannel}>>();
  const view=useMemo(()=>({reader,active:true,confirmation:undefined as Confirmation|undefined,editor:undefined as EditorAttempt|undefined,health:undefined as Readonly<{channel:LibraryChannel}>|undefined}),[reader]);
  useLayoutEffect(()=>{view.active=true;return()=>{view.active=false;view.confirmation=undefined;view.editor=undefined;view.health=undefined;};},[view]);
  useEffect(()=>{void reader.load();void reader.templates();},[reader]);
  const current=useCallback(()=>view.active&&view.reader===reader&&group.current(),[view,reader,group]);
  const editorCurrent=useCallback(()=>current()&&!!attempt&&view.editor===attempt,[current,attempt,view]);
  const commands=()=>current()&&editor.getSnapshot().phase==='closed'&&!editor.getSnapshot().pending&&!editor.getSnapshot().busy&&!actions.getSnapshot().busy&&!actions.getSnapshot().pending;
  const listed=(channel:LibraryChannel)=>!!reader.getSnapshot().channels?.includes(channel);
  const open=(channel?:LibraryChannel,template?:LibraryChannelTemplate)=>{
    if(!commands()||channel&&!listed(channel)||!channel&&!group.timezone)return;
    const next={id:++nextEditorAttempt};view.editor=next;setAttempt(next);view.confirmation=undefined;setConfirmation(undefined);
    if(channel)editor.edit(channel);else if(template)editor.template(template,group.timezone!);else void editor.blank(group.timezone!);
  };
  const resume=()=>{if(!current()||editor.getSnapshot().phase!=='closed'||!editor.getSnapshot().pending||editor.getSnapshot().busy||actions.getSnapshot().busy||actions.getSnapshot().pending)return;const next={id:++nextEditorAttempt};view.editor=next;setAttempt(next);editor.resume();};
  const held=confirmation&&view.confirmation===confirmation&&current()&&listed(confirmation.channel)?confirmation:undefined;
  const close=()=>{if(!held||!current()||view.confirmation!==held)return;view.confirmation=undefined;setConfirmation(undefined);};
  const confirm=async()=>{const captured=held;if(!captured||!current()||view.confirmation!==captured||!listed(captured.channel))return;const done=await actions.perform(captured.channel,'delete');if(done&&current()&&view.confirmation===captured){view.confirmation=undefined;setConfirmation(undefined);}};
  const ask=(channel:LibraryChannel)=>{if(!commands()||!listed(channel))return;const next={channel};view.confirmation=next;setConfirmation(next);};
  const heldHealth=health&&view.health===health&&current()&&state.selected===health.channel&&listed(health.channel)?health:undefined;
  const closeHealth=()=>{if(!heldHealth||!current()||view.health!==heldHealth)return;view.health=undefined;setHealth(undefined);reader.closeHealth(heldHealth.channel);};
  const busy=action.busy||editing.busy,blocked=busy||!!action.pending||editing.pending||editing.phase!=='closed';
  return <View style={{marginTop:14,gap:12}} testID="server-library-channels">
    <Text style={[shellType(17,800),{color:theme.colors.text}]}>{t('settings.server.libraryChannels')}</Text>
    {state.phase==='loading'&&<Text style={{color:theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}{(state.phase==='error'||action.error)&&<Text accessibilityRole="alert" style={{color:theme.colors.record}}>{t(action.pending?'error.unconfirmedChange':'error.unavailable')}</Text>}
    <View style={{flexDirection:'row',gap:8}}><Button size="compact" disabled={busy||!!action.pending||editing.pending||!group.timezone} onPress={()=>open()}>{t('builder.newTitle')}</Button><Button size="compact" variant="glass" disabled={busy} onPress={()=>{if(current())void reader.load();}}>{t('web.selection.refresh')}</Button></View>
    {editing.pending&&<Button size="compact" variant="glass" disabled={editing.busy} onPress={resume}>{t('action.tryAgain')}</Button>}
    {action.pending&&<View style={{gap:8}}><Text style={{color:theme.colors.textSecondary}}>{action.pending.name}</Text><Button size="compact" variant="glass" disabled={action.busy} onPress={()=>{if(current()&&actions.getSnapshot().pending===action.pending)void actions.retry();}}>{t('action.tryAgain')}</Button></View>}
    {state.channels?.map((channel,index)=><View key={channel.config.id} style={{padding:12,gap:8,borderRadius:12,backgroundColor:theme.colors.raised}}><Text style={[shellType(15,700),{color:theme.colors.text}]}>{channel.config.name}</Text>{channel.config.description&&<Text style={{color:theme.colors.textSecondary}}>{channel.config.description}</Text>}<Switch checked={channel.config.enabled} disabled={blocked} onCheckedChange={value=>{if(commands()&&listed(channel)&&value!==channel.config.enabled)void actions.perform(channel,'toggle');}}>{t('builder.on')}</Switch><View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}><Button size="compact" variant="glass" disabled={busy||editing.pending} onPress={()=>open(channel)}>{t('web.selection.edit')}</Button><Button size="compact" variant="glass" disabled={blocked||index===0} onPress={()=>{if(commands()&&listed(channel))void actions.perform(channel,'move',-1);}}>{t('web.profile.moveUp')}</Button><Button size="compact" variant="glass" disabled={blocked||index===(state.channels?.length??0)-1} onPress={()=>{if(commands()&&listed(channel))void actions.perform(channel,'move',1);}}>{t('web.profile.moveDown')}</Button><Button size="compact" variant="glass" disabled={blocked} onPress={()=>{if(commands()&&listed(channel))void actions.perform(channel,'regenerate');}}>{t('web.libraryChannels.regenSchedule')}</Button><Button size="compact" variant="glass" onPress={()=>{if(!current()||!listed(channel))return;const next={channel};view.health=next;setHealth(next);void reader.health(channel);}}>{t('web.libraryChannels.checkHealth')}</Button><Button size="compact" variant="glass" disabled={blocked} onPress={()=>ask(channel)}>{t('action.delete')}</Button></View></View>)}
    {state.templates?.map(template=><Button key={template.id} size="compact" variant="glass" disabled={!template.applicable||busy||editing.pending||!group.timezone} onPress={()=>{if(current()&&reader.getSnapshot().templates?.includes(template))open(undefined,template);}}>{template.name}</Button>)}
    <BottomSheet open={!!held} onOpenChange={value=>{if(!value)close();}} title={held?.channel.config.name} description={t('web.libraryChannels.deleteBody')} footer={<View style={{flexDirection:'row',gap:8}}><Button variant="glass" onPress={close}>{t('action.cancel')}</Button><Button disabled={action.busy} loading={action.busy} onPress={()=>{void confirm();}}>{t('action.delete')}</Button></View>}><View/></BottomSheet>
    <BottomSheet open={!!heldHealth} onOpenChange={value=>{if(!value)closeHealth();}} title={heldHealth?.channel.config.name} description={t('web.libraryChannels.healthLede')} footer={<Button onPress={closeHealth}>{t('action.done')}</Button>}><View style={{gap:8}}>{state.healthLoading&&<Text style={{color:theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}{state.healthError&&<Text style={{color:theme.colors.record}}>{t('error.unavailable')}</Text>}{state.health&&<><Text style={{color:state.health.healthy?theme.colors.accentStrong:theme.colors.record}}>{state.health.message||t(state.health.healthy?'web.libraryChannels.onAir':'web.libraryChannels.offAir')}</Text><Text style={{color:theme.colors.textSecondary}}>{t('web.libraryChannels.healthPrograms')}: {defaultI18n.number(state.health.scheduledEntries)}</Text>{state.health.generatedThrough&&<Text style={{color:theme.colors.textSecondary}}>{t('web.libraryChannels.healthSchedule')}: {defaultI18n.date(state.health.generatedThrough)}</Text>}</>}</View></BottomSheet>
    {attempt&&view.editor===attempt&&<NativeChannelEditor key={attempt.id} group={group} runtime={runtime} isCurrent={editorCurrent}/>}
  </View>;
}
