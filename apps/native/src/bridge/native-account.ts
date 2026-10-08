import {NativeModules} from 'react-native';
import {HostedAccountClient, parseAccountReturn, parseNativeAccountContinuation, type AccountReturn, type NativeAccountContinuation, type MFAChallenge} from '../../../../packages/client-core/src/index';

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
export class NativeAccountOwner {
 readonly origin:string;api:HostedAccountClient;private value:NativeAccountContinuation;private writes:Promise<void>=Promise.resolve();
 constructor(origin:string,value:NativeAccountContinuation){this.origin=origin;this.value=value;this.api=new HostedAccountClient(origin,'native',undefined,value.binding);}
 get continuation(){return this.value;}
 /** Expected binding fences late callbacks from a cancelled or replaced attempt. */
 async update(expected:string,change:{transactionId?:string;completionCode?:string;mfa?:MFAChallenge}):Promise<void>{
  const write=this.writes.then(async()=>{if(this.value.binding!==expected)throw new Error('This sign-in attempt was replaced.');
   const value:NativeAccountContinuation={version:1,binding:expected,expiresAt:this.value.expiresAt,...change};
   await accountBridge().saveContinuation(this.origin,JSON.stringify(value));this.value=value;
  });this.writes=write.catch(()=>{});return write;
 }
 async reset():Promise<void>{
  const write=this.writes.then(async()=>{const value:NativeAccountContinuation={version:1,binding:await accountBridge().newBinding(),expiresAt:new Date(Date.now()+86400000).toISOString()};
   await accountBridge().saveContinuation(this.origin,JSON.stringify(value));this.value=value;this.api=new HostedAccountClient(this.origin,'native',undefined,value.binding);
  });this.writes=write.catch(()=>{});return write;
 }
}
const owners=new Map<string,Promise<NativeAccountOwner>>();
export function nativeAccount(origin:string):Promise<NativeAccountOwner>{
 let pending=owners.get(origin);if(pending)return pending;
 pending=(async()=>{const bridge=accountBridge();let value=parseNativeAccountContinuation(await bridge.loadContinuation(origin));
  if(!value){value={version:1,binding:await bridge.newBinding(),expiresAt:new Date(Date.now()+86400000).toISOString()};await bridge.saveContinuation(origin,JSON.stringify(value));}
  return new NativeAccountOwner(origin,value);
 })();owners.set(origin,pending);void pending.catch(()=>{if(owners.get(origin)===pending)owners.delete(origin);});return pending;
}
