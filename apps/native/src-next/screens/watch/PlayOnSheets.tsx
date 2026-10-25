import React, {useEffect, useSyncExternalStore} from 'react';
import {Text, View} from 'react-native';
import {clockText} from '../../../../../packages/client-core/src/presentation/kit-model/text';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork, type ArtworkSource} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {BottomSheet, Dialog} from '../../kit/overlays';
import {FocusBoundary} from '../../kit/overlays/surface';
import {nativeType, useTheme} from '../../kit/theme';
import {Icon} from '../../kit/Icon';
import type {NativePlayOn} from '../../platform/play-on/controller';

/** phone-player 7: Play on — the Portico devices this profile may send to, then the
 * remote that stays with the television once it has taken the title over. Google
 * Cast is offered only through the installed, server-configured native transport. */
export type NativePlayOnSheetsProps = Readonly<{
  controller?: NativePlayOn;
  artwork: (path?: string) => ArtworkSource | undefined;
  posterUrl?: string;
  onLinkTV: () => void;
}>;

export function NativePlayOnSheets({controller, artwork, posterUrl, onLinkTV}: NativePlayOnSheetsProps) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(controller?.subscribe ?? (() => () => {}), controller?.getSnapshot ?? (() => undefined));
  useEffect(() => () => controller?.close(), [controller]);
  if (!controller || !state) return null;
  const cast=state.cast,castState=cast?.cast,castReport=cast?.receiver;
  if(castState?.takeover)return <Dialog open title={t('cast.takeover.title')} onOpenChange={open=>{if(!open)controller.castCommand('deny-takeover');}}>
    <Text style={[theme.type.body,{color:theme.colors.textSecondary}]}>{t('cast.takeover.body',{requester:castState.takeover.requester})}</Text>
    <Button variant="glass" onPress={()=>controller.castCommand('deny-takeover')}>{t('cast.takeover.deny')}</Button>
    <Button variant="primary" onPress={()=>controller.castCommand('allow-takeover')}>{t('action.accept')}</Button>
  </Dialog>;
  const isCast=state.castRemoteOpen&&!!cast?.source;
  const castKnown=!!castReport&&castReport.itemId===castState?.itemId;
  const remote=isCast&&cast?.source?{id:cast.source.id,device:castState?.deviceName??t('cast.theTV'),title:cast.title,
    positionSeconds:castReport?.positionSeconds??0,durationSeconds:castReport?.durationSeconds??0,
    playing:castState?.phase==='casting'&&castKnown&&!castReport?.paused,stopped:cast?.stopped===true,
    allows:{pause:castState?.phase==='casting'&&castKnown,resume:castState?.phase==='casting'&&castKnown,seek:castState?.phase==='casting'&&castKnown&&(castReport?.durationSeconds??0)>0,stop:castState?.phase!=='off'}}:state.remote;
  const closeRemote=isCast?controller.closeCastRemote:controller.closeRemote;
  const pause=(id:string)=>isCast?controller.castCommand('pause'):void controller.pause(id);
  const resume=(id:string)=>isCast?controller.castCommand('resume'):void controller.resume(id);
  const seek=(delta:number,id:string)=>isCast?controller.castCommand('seek',Math.max(0,(castReport?.positionSeconds??0)+delta)):void controller.skip(delta,id);
  const restart=(id:string)=>isCast?controller.castCommand('seek',0):void controller.startOver(id);
  const stop=(id:string)=>isCast?controller.castCommand('stop'):void controller.stop(id);
  if ((isCast || state.remoteOpen) && remote) {
    const control = (id: string, icon: 'i-rew' | 'i-ffw' | 'i-play' | 'i-pause' | 'i-restart' | 'i-stop', label: string, onPress: () => void, primary = false, disabled = false) =>
      <Focusable key={id} focusId={`remote-${id}`} testID={`remote-${id}`} accessibilityRole="button" accessibilityLabel={label} disabled={disabled}
        onPress={onPress} style={{height: primary ? 64 : 52, width: primary ? 64 : 52, borderRadius: primary ? 32 : 26, alignItems: 'center', justifyContent: 'center',
          backgroundColor: primary ? theme.colors.text : 'rgba(237,245,250,.14)'}}>
        <Icon name={icon} size={primary ? 30 : 24} color={primary ? theme.colors.ink : theme.colors.text}/>
      </Focusable>;
    return <BottomSheet testID="play-on-remote" open onOpenChange={open => {if (!open) closeRemote();}} title={t('player.playOn')} showClose={false}
      detents={[Math.min(560, 300 + 120)]} contentStyle={{paddingHorizontal: 22, paddingBottom: 28}}>
      <View style={{flexDirection: 'row', gap: 16, alignItems: 'center'}}>
        <View style={{width: 92, height: 92, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
          <Artwork source={artwork(isCast?cast?.posterUrl:posterUrl)} width={92} height={92}/>
        </View>
        <View style={{flex: 1, minWidth: 0}}>
          <Text numberOfLines={1} style={[nativeType({size: 20, weight: 800, tracking: -.02, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{remote.title ?? t('player.queueNowPlaying')}</Text>
          <Text numberOfLines={1} style={[theme.type.body, {marginTop: 2, color: theme.colors.textSecondary}]}>{remote.device}</Text>
          <Text style={[theme.type.bodyStrong, {marginTop: 6, color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{[!isCast||castReport?clockText(remote.positionSeconds):undefined,
            remote.durationSeconds > 0 ? clockText(remote.durationSeconds) : undefined].filter(Boolean).join(' / ')}</Text>
        </View>
        <Button focusId="remote-close" variant="text" iconOnly icon="i-close" accessibilityLabel={t('action.close')} onPress={closeRemote}/>
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginTop: 26}}>
        {control('back', 'i-rew', t('player.skipBackSeconds', {seconds: 10}), () => {seek(-10, remote.id);}, false, !remote.allows.seek || remote.stopped)}
        {control('restart', 'i-restart', t('next.controls.startOver'), () => {restart(remote.id);}, false, !remote.allows.seek || remote.stopped)}
        {remote.playing
          ? control('pause', 'i-pause', t('action.pause'), () => {pause(remote.id);}, true, !remote.allows.pause || remote.stopped)
          : control('play', 'i-play', t('action.play'), () => {resume(remote.id);}, true, !remote.allows.resume || remote.stopped)}
        {control('forward', 'i-ffw', t('player.skipForwardSeconds', {seconds: 30}), () => {seek(30, remote.id);}, false, !remote.allows.seek || remote.stopped)}
        {control('stop', 'i-stop', t('next.dock.native.stopRemote', {device: remote.device}), () => {stop(remote.id);}, false, remote.stopped)}
      </View>
      <View style={{marginTop: 22, alignItems: 'center'}}>
        <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('playOn.volumeOnTV')}</Text>
      </View>
    </BottomSheet>;
  }
  if (!state.open) return null;
  return <Dialog open testID="play-on-sheet" title={t('player.playOn')} onOpenChange={open => {if (!open) controller.close();}} showClose
    description={state.message ?? t('playOn.chooseDevice')}>
    <View style={{paddingVertical: 8}}>
      {castState?.available&&<Focusable focusId="play-on-cast" testID="play-on-cast" focusKind="row" accessibilityRole="button"
        accessibilityLabel={t('playOn.googleCast')} disabled={state.sending||castState.transferPending||['connecting','pairing','waiting'].includes(castState.phase)}
        onPress={castState.phase==='casting'?controller.openCastRemote:controller.startCast}
        style={({focused})=>({minHeight:58,paddingHorizontal:12,borderRadius:12,flexDirection:'row',alignItems:'center',gap:14,backgroundColor:focused?'rgba(237,245,250,.12)':'transparent'})}>
        <Icon name="i-cast" size={24} color={theme.colors.textSecondary}/><View style={{flex:1}}>
          <Text style={[nativeType({size:16,weight:600,tracking:0,lineHeight:'normal'},theme.textScale),{color:theme.colors.text}]}>{t('playOn.googleCast')}</Text>
          <Text style={[theme.type.caption,{color:theme.colors.textTertiary}]}>{t('playOn.chooseDevice')}</Text>
        </View><Icon name="i-right" size={18} color={theme.colors.textTertiary}/>
      </Focusable>}
      {castState&&(['connecting','pairing','waiting'].includes(castState.phase)||castState.transferPending)&&<View style={{flexDirection:'row',gap:12,alignItems:'center',paddingVertical:12}}>
        <Text style={[theme.type.body,{flex:1,color:theme.colors.textSecondary}]}>{castState.phase==='connecting'?t('playOn.chooseDevice'):castState.phase==='waiting'?t('cast.waitingForAllow'):t('playOn.connectingTo',{device:castState.deviceName??t('cast.theTV')})}</Text>
        <Button variant="glass" onPress={()=>controller.castCommand('stop')}>{t('action.cancel')}</Button>
      </View>}
      {castState?.phase==='error'&&<Text style={[theme.type.body,{color:theme.colors.textSecondary,paddingVertical:12}]}>{castState.error??t('cast.error.unreachable')}</Text>}
      {state.directoryPhase === 'loading' && !state.receivers.length && <Text style={[theme.type.body, {color: theme.colors.textTertiary, paddingVertical: 14}]}>{t('playOn.looking')}</Text>}
      {state.directoryPhase === 'error' && <Text style={[theme.type.body, {color: theme.colors.textSecondary, paddingVertical: 14}]}>{state.directoryError || t('playOn.devicesUnavailable')}</Text>}
      {state.receivers.map(receiver => <Focusable key={receiver.id} focusId={`play-on-${receiver.id}`} testID={`play-on-${receiver.id}`} focusKind="row" accessibilityRole="button"
        accessibilityLabel={`${receiver.displayName}, ${receiver.kind === 'portico' ? t('playOn.porticoDevice') : t('playOn.castDevice')}`}
        disabled={state.sending||castState?.transferPending||castState?.phase==='casting'} onPress={() => {void controller.send(receiver);}}
        style={({focused}) => ({minHeight: 58, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 14,
          backgroundColor: focused ? 'rgba(237,245,250,.12)' : 'transparent'})}>
        <Icon name="i-tvdev" size={24} color={theme.colors.textSecondary}/>
        <View style={{flex: 1}}>
          <Text style={[nativeType({size: 16, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text}]}>{receiver.displayName}</Text>
          <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{receiver.kind === 'portico' ? t('playOn.porticoDevice') : t('playOn.castDevice')} · {receiver.presence === 'online' ? t('playOn.online') : t('playOn.offline')}</Text>
        </View>
      </Focusable>)}
      {state.directoryPhase === 'ready' && !state.receivers.length && <Text style={[theme.type.body, {color: theme.colors.textTertiary, paddingVertical: 14}]}>{t('playOn.noDevices')}</Text>}
      <Focusable focusId="play-on-link" testID="play-on-link" focusKind="row" accessibilityRole="button" onPress={onLinkTV}
        style={({focused}) => ({minHeight: 54, paddingHorizontal: 12, borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: focused ? 'rgba(237,245,250,.12)' : 'transparent'})}>
        <Icon name="i-plus" size={22} color={theme.colors.textSecondary}/>
        <Text style={[nativeType({size: 15, weight: 600, tracking: 0, lineHeight: 'normal'}, theme.textScale), {color: theme.colors.text, flex: 1}]}>{t('playOn.linkTV')}</Text>
      </Focusable>
      {state.phase !== 'idle' && state.phase !== 'done' && state.phase !== 'failed' && <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12}}>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary, flex: 1}]}>{state.message ?? t('playOn.connectingTo', {device: state.target?.displayName ?? ''})}</Text>
        <Button focusId="play-on-cancel" variant="glass" onPress={controller.close}>{t('action.cancel')}</Button>
      </View>}
      {state.phase === 'failed' && <View style={{paddingVertical: 12}}>
        <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{state.error ?? state.message ?? t('playOn.notReachable', {device: state.target?.displayName ?? ''})}</Text>
      </View>}
    </View>
  </Dialog>;
}
