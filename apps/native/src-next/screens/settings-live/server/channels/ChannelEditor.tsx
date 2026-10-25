import React,{useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {Modal,ScrollView,Text,View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {applyChannelConditions} from '../../../../../../../packages/client-core/src/server-admin/channel-conditions';
import {librarySampleLabel,type LibraryChannelConfig,type LibraryChannelRule,type LibraryChannelOrder} from '../../../../../../../packages/client-core/src/library-channels';
import {defaultI18n,type MessageId} from '../../../../../../../packages/i18n/src';
import type {NativeShellRuntime} from '../../../../shell/runtime';
import {Button,Select,Switch,TextField} from '../../../../kit/controls';
import {shellType} from '../../../../kit/shell/visual';
import {useTheme} from '../../../../kit/theme';
import type {NativeChannelsGroup} from './model';
import {NativeChannelConditions} from './ChannelConditions';
import {NativeChannelPins} from './ChannelPins';
import {NativeChannelHours} from './ChannelHours';
const MODES=['sequential','shuffle-bag','weighted-random','sequential-then-shuffle'] as const;
const MODE_WORDS=['builder.order.inOrder','builder.order.shuffle','builder.order.random','builder.order.thenShuffle'] as const;
const ORDERS=['title','recent','oldest','year','episode','release','rating'] as const;
const ORDER_WORDS:Readonly<Record<LibraryChannelOrder,MessageId>>={title:'builder.sort.title',recent:'builder.sort.recent',oldest:'builder.sort.oldest',year:'builder.sort.year',episode:'builder.sort.episode',release:'builder.sort.release',rating:'builder.sort.rating','least-played':'builder.preset.leastPlayed'};
const QUALITY_WORDS:Readonly<Record<LibraryChannelConfig['quality']['mode'],MessageId>>={automatic:'builder.quality.automatic',original:'builder.quality.original',limited:'builder.quality.limited'};
const EPISODES=['none','in-order','marathon','randomized','rotate'] as const;
const RECENT_DAYS=[0,1,7,30,90,365] as const;
const EPISODE_WORDS=['builder.episodes.none','builder.episodes.inOrder','builder.episodes.marathon','builder.episodes.randomized','builder.episodes.rotate'] as const;
export function NativeChannelEditor({group,runtime,isCurrent}:{group:NativeChannelsGroup;runtime:NativeShellRuntime;isCurrent:()=>boolean}) {
  const {editor,fields,presets}=group,state=useSyncExternalStore(editor.subscribe,editor.getSnapshot,editor.getSnapshot),presetState=useSyncExternalStore(presets.subscribe,presets.getSnapshot,presets.getSnapshot),theme=useTheme(),insets=useSafeAreaInsets(),t=runtime.text.t as typeof defaultI18n.t;
  const [tried,setTried]=useState(false),[conditionsValid,setConditionsValid]=useState(true),[hoursEditing,setHoursEditing]=useState(false);
  const validation=useMemo(()=>({source:editor,conditions:true,hours:true}),[editor]);
  const config=state.config,rule=config?.rules.find(value=>value.id===config.defaultRuleId),libraryIds=rule?.query.libraryIds,locked=state.busy||state.pending;
  useEffect(()=>{if(isCurrent()&&state.phase==='editing'&&!presets.getSnapshot().loaded)void presets.load();},[group,presets,isCurrent,state.phase]);
  useEffect(()=>{if(isCurrent()&&libraryIds)void fields.select(libraryIds);},[fields,isCurrent,libraryIds]);
  const current=()=>isCurrent()&&group.current()&&editor.getSnapshot().phase==='editing'&&editor.getSnapshot().config===config;
  const unlocked=()=>current()&&!editor.getSnapshot().busy&&!editor.getSnapshot().pending;
  const change=(update:(old:LibraryChannelConfig)=>LibraryChannelConfig)=>{if(!unlocked())return false;editor.change(update);return editor.getSnapshot().config!==config;};
  const changeRule=(patch:Partial<LibraryChannelRule>)=>{if(rule)change(old=>({...old,rules:old.rules.map(value=>value.id===rule.id?{...value,...patch}:value)}));};
  const query=(patch:Partial<LibraryChannelRule['query']>)=>{if(rule)changeRule({query:{...rule.query,...patch}});};
  let zoneValid=false;try{if(config?.timezone){new Intl.DateTimeFormat(undefined,{timeZone:config.timezone});zoneValid=true;}}catch{}
  const leastSupported=!!presetState.applicationOrders?.includes('least-played'),valid=!!config?.name.trim()&&!!rule?.query.libraryIds.length&&!!rule.query.kinds.length&&zoneValid&&(rule.query.order!=='least-played'||leastSupported);
  const allowed=()=>current()&&!editor.getSnapshot().busy&&validation.conditions&&validation.hours&&valid;
  const close=()=>{if(!isCurrent()||editor.getSnapshot().busy)return;editor.close();};
  const save=()=>{if(!current()||state.busy)return;setTried(true);if(allowed())void(state.pending?editor.retry():editor.save());};
  const orderOptions=[...ORDERS.map(value=>({value,label:t(ORDER_WORDS[value]),disabled:false})),...(leastSupported||rule?.query.order==='least-played'?[{value:'least-played',label:t('builder.preset.leastPlayed'),disabled:!leastSupported}]:[])];
  return <Modal visible={isCurrent()&&state.phase!=='closed'} animationType="slide" presentationStyle="fullScreen" onRequestClose={close}><View style={{flex:1,backgroundColor:theme.colors.ink,paddingTop:insets.top,paddingBottom:insets.bottom}}>
    <View style={{height:56,paddingHorizontal:14,flexDirection:'row',alignItems:'center',gap:10}}><Button variant="text" size="compact" disabled={state.busy} onPress={close}>{t('builder.cancel')}</Button><Text numberOfLines={1} style={[shellType(17,700),{flex:1,textAlign:'center',color:theme.colors.text}]}>{t(state.templateName?'builder.reviewTemplate':'builder.editTitle',{name:state.templateName??''})}</Text><Button size="compact" disabled={state.busy||!config||!conditionsValid||hoursEditing} loading={state.busy} onPress={save}>{t(state.pending?'action.tryAgain':'builder.save')}</Button></View>
    <ScrollView contentContainerStyle={{padding:20,gap:14,paddingBottom:40}} keyboardShouldPersistTaps="handled">
      {state.phase==='loading'&&<Text style={{color:theme.colors.textSecondary}}>{t('next.settings.loading')}</Text>}{state.error&&<Text accessibilityRole="alert" style={{color:theme.colors.record}}>{t(state.pending?'error.unconfirmedChange':'error.unavailable')}</Text>}
      {config&&rule&&<><TextField label={t('builder.name')} value={config.name} maxLength={120} editable={!locked} error={tried&&!config.name.trim()?t('builder.error.name'):undefined} onChangeText={name=>change(old=>({...old,name}))}/><TextField label={t('builder.description')} value={config.description} maxLength={2048} editable={!locked} onChangeText={description=>change(old=>({...old,description}))}/>
      <Text style={[shellType(17,800),{color:theme.colors.text}]}>{t('builder.libraries')}</Text>{!group.libraries.length&&<Text style={{color:theme.colors.textSecondary}}>{t('builder.noVideoLibraries')}</Text>}{group.libraries.map(library=><Switch key={library.id} checked={rule.query.libraryIds.includes(library.id)} disabled={locked} onCheckedChange={checked=>query({libraryIds:checked?[...rule.query.libraryIds.filter(id=>id!==library.id),library.id]:rule.query.libraryIds.filter(id=>id!==library.id)})}>{library.name}</Switch>)}{tried&&!rule.query.libraryIds.length&&<Text style={{color:theme.colors.record}}>{t('builder.error.libraries')}</Text>}
      {(['movie','episode'] as const).map(kind=><Switch key={kind} checked={rule.query.kinds.includes(kind)} disabled={locked} onCheckedChange={checked=>query({kinds:checked?[...rule.query.kinds.filter(value=>value!==kind),kind]:rule.query.kinds.filter(value=>value!==kind)})}>{t(kind==='movie'?'builder.movies':'builder.shows')}</Switch>)}
      <NativeChannelConditions source={fields} query={rule.query} locked={locked} isCurrent={unlocked} t={t} onChange={(tree,complete)=>{if(!unlocked())return false;validation.conditions=complete;setConditionsValid(complete);if(complete)editor.change(old=>applyChannelConditions(old,tree));return true;}}/>
      <TextField label={t('builder.mentions')} description={t('builder.mentionsHint')} value={rule.query.text??''} maxLength={200} editable={!locked} onChangeText={text=>query({text})}/>
      <NativeChannelPins source={group.includeFields} libraryIds={rule.query.libraryIds} ids={rule.query.includeItemIds??[]} locked={locked} isCurrent={unlocked} t={t} onChange={includeItemIds=>query({includeItemIds})}/><NativeChannelPins source={group.excludeFields} libraryIds={rule.query.libraryIds} ids={rule.query.excludeItemIds??[]} excluded locked={locked} isCurrent={unlocked} t={t} onChange={excludeItemIds=>query({excludeItemIds})}/>
      <Select label={t('builder.order')} value={rule.mode} disabled={locked} options={MODES.map((value,index)=>({value,label:t(MODE_WORDS[index]!)}))} onValueChange={value=>{if(MODES.some(mode=>mode===value))changeRule({mode:value as LibraryChannelRule['mode']});}}/>
      <Select label={t('builder.sortBy')} value={rule.query.order} disabled={locked} options={orderOptions} onValueChange={value=>{if(orderOptions.some(option=>option.value===value&&!option.disabled))query({order:value as LibraryChannelRule['query']['order']});}}/>
      <Select label={t('builder.recent')} value={String(rule.query.recentDays)} disabled={locked} options={RECENT_DAYS.map(value=>({value:String(value),label:value===0?t('builder.recent.any'):t('builder.recent.days',{count:value})}))} onValueChange={value=>{const days=RECENT_DAYS.find(day=>String(day)===value);if(days!==undefined)query({recentDays:days});}}/>
      <Select label={t('builder.episodes')} value={rule.episodeMode} disabled={locked} options={EPISODES.map((value,index)=>({value,label:t(EPISODE_WORDS[index]!)}))} onValueChange={value=>{if(EPISODES.some(mode=>mode===value))changeRule({episodeMode:value as LibraryChannelRule['episodeMode']});}}/>
      <Switch checked={config.enabled} disabled={locked} onCheckedChange={enabled=>change(old=>({...old,enabled}))}>{t('builder.on')}</Switch>
      <TextField label={t('builder.timeZone')} value={config.timezone} editable={!locked} error={tried&&!zoneValid?t('builder.error.timeZone'):undefined} onChangeText={timezone=>change(old=>({...old,timezone}))}/>
      <Select label={t('builder.quality')} value={config.quality.mode} disabled={locked} options={(['automatic','original','limited'] as const).map(value=>({value,label:t(QUALITY_WORDS[value])}))} onValueChange={value=>{if(['automatic','original','limited'].includes(value))change(old=>({...old,quality:{...old.quality,mode:value as LibraryChannelConfig['quality']['mode']}}));}}/>
      <NativeChannelHours config={config} presets={presets} locked={locked} isCurrent={unlocked} onChange={change} t={t} onEditing={value=>{if(isCurrent()){validation.hours=!value;setHoursEditing(value);}}}/>
      <Text style={{color:theme.colors.textSecondary}}>{t('builder.audience')}</Text><Button size="compact" variant="glass" disabled={locked||!valid||!conditionsValid||hoursEditing} loading={state.previewLoading} onPress={()=>{if(allowed())void editor.preview();}}>{t('builder.preview')}</Button>
      {state.preview&&<View style={{gap:8}}>{state.preview.rules.map(value=><View key={value.ruleId}><Text style={{color:theme.colors.text}}>{t('builder.matches',{count:value.eligible})}</Text>{value.sample.map(sample=><Text key={sample.itemId} style={{color:theme.colors.textSecondary}}>{librarySampleLabel(sample)}</Text>)}</View>)}{state.preview.firstDay.map(value=><Text key={value.id} style={{color:theme.colors.textSecondary}}>{new Intl.DateTimeFormat(runtime.text.locale,{timeZone:config.timezone,hour:'numeric',minute:'2-digit'}).format(value.startMs)} · {value.title}</Text>)}</View>}
      </>}
    </ScrollView>
  </View></Modal>;
}
