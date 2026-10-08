import {NativeModules} from 'react-native';
/** The app's small durable records (servers, preferences, the v1 queue id…) in the native
 * Keychain-backed store: one atomic read-modify-write per key. */
// All hosts in this JS runtime serialize access to each native Keychain record.
// A native upsert completes durably before the next transaction may read it.
const tails=new Map<string,Promise<unknown>>();
export class NativeQueueStore {
 change<T>(key:string,update:(raw:unknown)=>{record:unknown;value:T}):Promise<T>{
  const run=(tails.get(key)??Promise.resolve()).catch(()=>{}).then(async()=>{
   const raw=await NativeModules.PorticoRuntime.loadQueueRecord(key);
   const out=update(raw==null?null:JSON.parse(raw));const json=JSON.stringify(out.record??null);
   if(json.length>262144)throw new Error('This could not be saved on this device.');
   // A read (or any change that leaves the record as it was) writes nothing: reading a saved
   // credential must never be able to damage it.
   if(json===(raw??'null')||(raw!=null&&json===JSON.stringify(JSON.parse(raw))))return out.value;
   await NativeModules.PorticoRuntime.saveQueueRecord(key,json);return out.value;
  });
  tails.set(key,run);void run.finally(()=>{if(tails.get(key)===run)tails.delete(key);}).catch(()=>{});return run;
 }
}
