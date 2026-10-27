import {NativeModules} from 'react-native';
import {ApiError, HostedAccountClient, parseAccountReturn, parseNativeAccountContinuation, type AccountReturn, type AccountTransport, type NativeAccountContinuation, type MFAChallenge} from '../../../../packages/client-core/src/index';
import {nativeNetworkFetch} from './server-connections';
import {serializeContinuation} from './continuation-queue';

/** SEC-01: a provider return for the sign-in this app started, or undefined for any other. */
export function accountReturnOf(raw:string,expected:string,accountOrigin:string):AccountReturn|undefined {
 try{return parseAccountReturn(raw,expected,accountOrigin);}catch{return undefined;}
}

type AccountBridge={bundleId:string;canSignInApple:boolean;canOpenBrowser:boolean;newBinding():Promise<string>;newRequestId():Promise<string>;loadContinuation(origin:string):Promise<string|null>;saveContinuation(origin:string,value:string):Promise<void>;openBrowser(url:string,transactionId:string):Promise<string>;signInApple(nonce:string):Promise<{idToken:string;displayName:string}>;cancel():Promise<void>};
export function accountBridge():AccountBridge {
 const bridge=NativeModules.PorticoAccountAuth as AccountBridge|undefined;
 if(!bridge||typeof bridge.loadContinuation!=='function'||typeof bridge.newBinding!=='function')throw new Error('The account authorization module is missing from this build. Rebuild the native target.');
 return bridge;
}
/**
 * NS-03: Portico Account requests (password, second factor, provider completion) go through the
 * app's native transport, never React Native's `fetch`, which follows a redirect on Apple and would
 * send the password on to wherever it points. The native transport refuses every redirect, keeps no
 * cookies or cache, and never settles an owner's certificate for the account service (NS-02), as
 * for the account's own sign-in renewal (`credentials.ts`). Everything else is the shared client's
 * default transport as it was: the same headers, 15-second bound, response limit and errors.
 */
export function nativeAccountTransport(origin:string,binding:string,fetcher:typeof fetch=nativeNetworkFetch):AccountTransport {
 return async(path,method,body,signal,token,completion)=>{
  const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();const timer=setTimeout(abort,15000);
  try{const response=await fetcher(origin+path,{method,signal:controller.signal,headers:{'Content-Type':'application/json','X-Portico-Continuation':binding,...(token?{Authorization:'Bearer '+token}:{}),...(completion?{'X-Portico-Completion':completion}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
   const raw=await response.text();if(raw.length>262144)throw new Error('The account response is too large.');let value:unknown;try{value=raw?JSON.parse(raw):undefined;}catch{throw new Error('The account service returned unreadable data.');}
   if(!response.ok){const failure=value&&typeof value==='object'?(value as {error?:unknown}).error:undefined,e=(failure&&typeof failure==='object'?failure:{}) as {code?:unknown;message?:unknown;retryable?:unknown};
    // The shared transport's own fallback text, never shown: screens present this error by its code and status.
    throw new ApiError(response.status,typeof e.code==='string'?e.code:'request_failed',typeof e.message==='string'?e.message:'The account request did not finish.',e.retryable===true||response.status>=500);} // lint-strings-allow
   return value;
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
 };
}
export class NativeAccountOwner {
 readonly origin:string;api:HostedAccountClient;private value:NativeAccountContinuation;private writes:Promise<void>=Promise.resolve();
 constructor(origin:string,value:NativeAccountContinuation){this.origin=origin;this.value=value;this.api=new HostedAccountClient(origin,'native',nativeAccountTransport(origin,value.binding),value.binding);}
 get continuation(){return this.value;}
 /** Expected binding fences late callbacks from a cancelled or replaced attempt. */
 async update(expected:string,change:{transactionId?:string;completionCode?:string;mfa?:MFAChallenge}):Promise<void>{
  const original=this.value;
  const current=()=>{if(this.value.binding!==expected||original.binding!==expected)throw new Error('This sign-in attempt was replaced.');};
  current();const value:NativeAccountContinuation={version:1,binding:expected,expiresAt:original.expiresAt,...change},bytes=JSON.stringify(value);
  const write=this.writes.then(()=>serializeContinuation(this.origin,async()=>{current();await accountBridge().saveContinuation(this.origin,bytes);current();this.value=value;}));
  this.writes=write.catch(()=>{});return write;
 }
 async reset():Promise<void>{
  const originalBinding=this.value.binding,current=()=>{if(this.value.binding!==originalBinding)throw new Error('This sign-in attempt was replaced.');};
  const write=this.writes.then(()=>serializeContinuation(this.origin,async()=>{current();const binding=await accountBridge().newBinding();current();
   const value:NativeAccountContinuation={version:1,binding,expiresAt:new Date(Date.now()+86400000).toISOString()},bytes=JSON.stringify(value);
   await accountBridge().saveContinuation(this.origin,bytes);current();this.value=value;this.api=new HostedAccountClient(this.origin,'native',nativeAccountTransport(this.origin,value.binding),value.binding);
  }));this.writes=write.catch(()=>{});return write;
 }
}
const owners=new Map<string,Promise<NativeAccountOwner>>();
export function nativeAccount(origin:string):Promise<NativeAccountOwner>{
 let pending=owners.get(origin);if(pending)return pending;
 pending=serializeContinuation(origin,async()=>{const bridge=accountBridge();let value=parseNativeAccountContinuation(await bridge.loadContinuation(origin));
  if(!value){value={version:1,binding:await bridge.newBinding(),expiresAt:new Date(Date.now()+86400000).toISOString()};const bytes=JSON.stringify(value);await bridge.saveContinuation(origin,bytes);}
  return new NativeAccountOwner(origin,value);
 });owners.set(origin,pending);void pending.catch(()=>{if(owners.get(origin)===pending)owners.delete(origin);});return pending;
}
