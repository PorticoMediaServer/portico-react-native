import {NativeModules} from 'react-native';
import {deviceModelName,devicePlatform} from './device-platform';
import {HttpLocalApi,type HostedSession,type LocalSession,type DeviceAuthorization} from '../../../../packages/client-core/src/index';
import {SetupCodeService,type SetupCodeStorage,type SetupCodeJournal,type SetupCodeEntry} from '../../../../packages/client-core/src/setup-code';
import {parseLocalSession} from '../../../../packages/client-core/src/local-session';
import {hostedGate} from '../../../../packages/client-core/src/hosted-gate';
import {activationGate} from './hosted-activation-gate';
import {NativeQueueStore} from './queue-storage';
import {nativeNetworkFetch} from './server-connections';
const store=new NativeQueueStore();
export function nativeSetupStorage<T>(authority:string):SetupCodeStorage<T>{
 const key='setup:'+authority;
 return {change:update=>store.change(key,raw=>{const record=update(raw===null?undefined:raw as SetupCodeJournal<T>);return{record,value:record};})};
}
function hostedGrant(raw:unknown):HostedSession{
 const s=raw as HostedSession;
 if(!s||typeof s.accessToken!=='string'||!s.accessToken||typeof s.refreshToken!=='string'||!s.refreshToken||typeof s.familyId!=='string'||!s.familyId||!s.account?.id||!Array.isArray(s.profiles)||!Number.isFinite(Date.parse(s.expiresAt))||!Number.isFinite(Date.parse(s.refreshExpiresAt)))throw new Error('The protected TV session was invalid.');
 return s;
}
/** The only clear TV grant exists after native private-key decryption. Both
 * the private key and the redemption receipt survive process termination.
 * Every request goes through the app's one gate for the account service
 * (`hosted-activation-gate`): `userActed` says a person just asked. */
export function nativeTVActivation(origin:string){
 const http=new HttpLocalApi(origin,'',nativeNetworkFetch);let advertised:string|undefined;
 const gate=activationGate(hostedGate(origin));gate.userActed();
 const display=(entry:SetupCodeEntry<HostedSession>|undefined)=>{
  const id=entry?.requestId;if(id===advertised)return;advertised=id;NativeModules.PorticoNetwork.stopTVAdvertisement();
  if(entry)void NativeModules.PorticoNetwork.tvPublicKey(id).then((publicKey:string)=>{
   if(advertised===id)return NativeModules.PorticoNetwork.advertiseTV({issuer:origin,code:entry.authorization.userCode,requestId:id,publicKey,expiresAt:entry.authorization.expiresAt});
  }).catch(()=>{/* Nearby is optional; the durable QR and manual code remain. */});
 };
 const service=new SetupCodeService<HostedSession>(origin+'#tv-x25519-v1',{
  create:async(requestId,signal)=>{const publicKey=await NativeModules.PorticoNetwork.tvPublicKey(requestId);if(signal.aborted)throw new Error('Activation paused.');const identity=await deviceIdentity();return gate.run('create',()=>http.request<DeviceAuthorization>('/v1/device-authorizations','POST',{requestId,...identity,platform:devicePlatform,protocol:'tv-x25519-v1',publicKey},signal));},
  poll:async(entry,signal)=>{const envelope=await gate.run('poll',()=>http.request<Record<string,unknown>>('/v1/tv-authorizations/token','POST',{deviceCode:entry.authorization.deviceCode},signal));const key=await NativeModules.PorticoNetwork.tvPublicKey(entry.requestId);if(envelope.issuer!==origin||envelope.requestId!==entry.requestId||envelope.recipientKey!==key)throw new Error('The TV approval does not belong to this device and account service.');return hostedGrant(JSON.parse(await NativeModules.PorticoNetwork.openTVGrant(entry.requestId,envelope)));},
  cancel:(entry,signal)=>gate.run('cancel',()=>http.request<void>('/v1/device-authorizations/cancel','POST',{deviceCode:entry.authorization.deviceCode},signal)),
  forgotten:entry=>{NativeModules.PorticoNetwork.forgetTVKey(entry.requestId);},displayed:display,
 },nativeSetupStorage(origin+'#tv-x25519-v1'),()=>NativeModules.PorticoRuntime.newRequestId().then((v:string)=>v.toLowerCase()));
 return Object.assign(service,{/** A person just asked for something on the activation screen. */userActed:()=>gate.userActed()});
}
/** APL-AUTH-06: what an approval screen calls this device: its own name ("Living Room"), or its
 *  model when the system only offers a generic one, plus the app version. */
const models:[RegExp,string][]=[[/^AppleTV14,/,'Apple TV 4K'],[/^AppleTV11,/,'Apple TV 4K'],[/^AppleTV6,/,'Apple TV 4K'],[/^AppleTV5,/,'Apple TV HD'],[/^iPad/,'iPad'],[/^iPhone/,'iPhone']];
let identity:Promise<{deviceName:string;appVersion:string}>|undefined;
export function deviceIdentity(){
 identity??=(async()=>{
  let facts:{deviceName?:string;model?:string;appVersion?:string}|null=null;
  try{facts=await NativeModules.PorticoCapabilities?.facts();}catch{/* an older native build */}
  const model=models.find(([re])=>re.test(facts?.model??''))?.[1]??deviceModelName;
  const name=(facts?.deviceName??'').trim();
  const generic=!name||/^(apple tv|iphone|ipad)$/i.test(name);
  return {deviceName:(generic?model:name).slice(0,64),appVersion:facts?.appVersion||'0.1.0'};
 })();
 return identity;
}

/** Server Quick Connect is the TV's: it shows the code, and a phone or computer signed in to the server approves it. */
export function nativeQuickConnect(api:HttpLocalApi){
 const serverId=api.getRouteConnection()?.pin.serverId;if(!serverId)throw new Error('Verify the server identity before using Quick Connect.');
 return new SetupCodeService<LocalSession>('local:'+serverId,{
  create:async(requestId,signal)=>api.request<DeviceAuthorization>('/v1/quick-connect','POST',{requestId,...(await deviceIdentity()),platform:devicePlatform},signal),
  poll:async(entry,signal)=>parseLocalSession(await api.request('/v1/quick-connect/token','POST',{deviceCode:entry.authorization.deviceCode},signal),{authority:'local',serverId}),
  cancel:(entry,signal)=>api.request<void>('/v1/quick-connect/cancel','POST',{deviceCode:entry.authorization.deviceCode},signal),
 },nativeSetupStorage('local:'+serverId),()=>NativeModules.PorticoRuntime.newRequestId().then((v:string)=>v.toLowerCase()));
}

export function nativeSetupDraft(serverId:string):import('../../../../packages/client-core/src/setup-onboarding').SetupDraftStore{const key='initialize:'+serverId;return {read:()=>store.change(key,raw=>({record:raw,value:raw===null?undefined:raw as import('../../../../packages/client-core/src/setup-onboarding').SetupDraft})),change:async update=>{await store.change(key,raw=>({record:update(raw===null?undefined:raw as import('../../../../packages/client-core/src/setup-onboarding').SetupDraft)??null,value:undefined}));}};}
