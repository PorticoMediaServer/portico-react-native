import {audioTrackLabel} from '../../../../packages/client-core/src/index';
import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import type {PlaybackService,HttpLocalApi,LocalSession} from '../../../../packages/client-core/src/index';
import {PlayerOffersService} from '../../../../packages/client-core/src/player-offers';
import {NativeAudioSelection} from './NativeAudioSelection';
/** `planned` is the audio track the server chose for the presentation being played (its stream
 * index), read when the track list is installed, so the menu ticks what is really playing. */
export function useNativeAudioSelection(service:PlaybackService,api:HttpLocalApi,viewer:LocalSession|undefined,libraryId:string|undefined,planned?:{readonly current:number|null}) {
  const state=useSyncExternalStore(service.subscribe,service.getSnapshot);
  const coordinator=useMemo(()=>new NativeAudioSelection(service),[service]);
  useEffect(()=>{coordinator.start();return()=>coordinator.stop();},[coordinator]);
  const command=useSyncExternalStore(coordinator.subscribe,coordinator.getSnapshot);
  const [retryRevision,setRetryRevision]=useState(0);
  const serverId=viewer?.viewer.serverId ?? 'signed-out';
  const viewerId=JSON.stringify([viewer?.viewer.authority,viewer?.viewer.accountId,viewer?.viewer.profileId]);
  const [readState,setReadState]=useState({loading:false,canRetry:false});
  useEffect(()=>{
    const offers=new PlayerOffersService({api,scope:{serverId,viewerId}});
    setReadState({loading:false,canRetry:false});
    const captured=service.getSnapshot(),intent=captured.intentId,session=captured.session,itemId=captured.itemId;
    let active=true,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
    const valid=()=>active&&service.getSnapshot().intentId===intent&&service.getSnapshot().session?.id===session?.id&&service.getSnapshot().session?.generation===session?.generation;
    async function read() {
      if(captured.channel){service.audioUnavailable(intent,'The channel uses its selected program audio.');return;}
      if(!session||!itemId||!libraryId||!valid())return;
      setReadState({loading:true,canRetry:false});
      await offers.select({libraryId,itemId,sessionId:session.id});if(!valid())return;
      const result=offers.getSnapshot(),data=result.data;
      setReadState({loading:false,canRetry:!!result.error||service.getSnapshot().phase==='starting'});
      const source=data?.sources.find(s=>s.id===data.current?.sourceId);
      if(source){const tracks=source.streams.filter(s=>s.type==='audio'&&s.enabled);service.installAudioTracks(intent,tracks.map((s,i)=>({streamIndex:s.index,label:audioTrackLabel(s,i+1),language:s.language,channels:s.channels,codec:s.codec})),planned?.current??null);}
      if(result.error){service.invalidateAudioPlan(intent,'Audio options could not be read. Retry to check available tracks.');return;}
      const reason=service.getSnapshot().phase==='starting'?'preparing':session.mode==='direct'?'direct_delivery':source?.factsStatus!=='known'?'facts_unavailable':'unsupported_source';
      if(reason==='preparing'&&++attempts<20){service.audioUnavailable(intent,'The server is preparing audio choices…');timer=setTimeout(()=>void read(),1000);return;}
      const messages:Record<string,string>={preparing:'Audio preparation is taking longer than expected. Retry to check again.',direct_delivery:'Audio selection is unavailable for direct playback.',session_inactive:'Audio options are no longer available for this session.',facts_unavailable:'Audio track information is unavailable for this media.',unsupported_source:'Audio selection is unavailable for this stream.'};
      service.audioUnavailable(intent,messages[reason??'']??'Audio selection is unavailable for this stream.');
    }
    void read();return()=>{active=false;if(timer)clearTimeout(timer);offers.dispose();};
  },[api,serverId,viewerId,service,libraryId,state.intentId,state.session?.id,state.session?.generation,retryRevision]);
  return {coordinator,command,canRetry:readState.canRetry,loading:readState.loading,retry:()=>setRetryRevision(x=>x+1)};
}
