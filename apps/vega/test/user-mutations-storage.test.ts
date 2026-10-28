import test from 'node:test';
import assert from 'node:assert/strict';
import {userMutationTransaction} from '../src/bridge/user-mutations.ts';
import {KeplerFileSystem as files} from '@amazon-devices/kepler-file-system';
import type {UserMutationState,UserMutationEntry} from '../../../packages/client-core/src/user-mutations.ts';
const scope={serverId:'server',origin:'http://192.0.2.1:3240',authority:'local',accountId:'account',profileId:'profile',familyId:'family'};
const key=(n:number)=>`p251_1793200000000_${n.toString(16).padStart(32,'0')}`;
const entry=(n:number):UserMutationEntry=>({key:key(n),operation:'stop_playback_session',method:'DELETE',path:'/v1/playback/sessions/original',target:'stop:original:7',intentId:'stop:original:7',fingerprint:'original',scope,body:{generation:7,positionMs:1234},headers:{'Idempotency-Key':key(n)},state:'pending',attempts:0,dueMs:1793200000000});
const state=(revision:number,entries:UserMutationEntry[]=[]):UserMutationState=>({version:1,revision,entries});
class Store {
 async read():Promise<UserMutationState>{return JSON.parse(await userMutationTransaction('read','{}') as string);}
 compareAndSwap(expectedRevision:number,next:UserMutationState){return userMutationTransaction('cas',JSON.stringify({expectedRevision,next}));}
 async activate(scope:unknown){await userMutationTransaction('scope',JSON.stringify({scope}));}
}
const originalWrite=files.writeStringToFile;
test('whole atomic CAS: concurrent owners cannot both win',async()=>{
 const a=new Store(),b=new Store(),before=await a.read();
 const answers=await Promise.all([a.compareAndSwap(before.revision,state(before.revision+1,[entry(1)])),b.compareAndSwap(before.revision,state(before.revision+1,[entry(2)]))]);
 assert.deepEqual(answers.sort(),[false,true]);assert.equal((await a.read()).entries.length,1);
});
test('paged aggregate exceeds legacy 256KiB cap and survives a fresh adapter',async()=>{
 const a=new Store(),before=await a.read();
 const entries=Array.from({length:12},(_,i)=>({...entry(i+20),body:{draft:'é'.repeat(20000)}}));
 assert.equal(await a.compareAndSwap(before.revision,state(before.revision+1,entries)),true);
 const restored=await new Store().read();
 assert.deepEqual(restored.entries,entries);assert.ok(Buffer.byteLength(JSON.stringify(restored))>262144);
});
test('torn inactive page and manifest writes preserve committed aggregate',async()=>{
 const a=new Store(),before=await a.read();let calls=0;
 files.writeStringToFile=async(path:string,text:string)=>{if(++calls===2){await originalWrite(path,text.slice(0,10));throw new Error('simulated power loss');}await originalWrite(path,text);};
 try{await assert.rejects(a.compareAndSwap(before.revision,state(before.revision+1,Array.from({length:15},(_,i)=>({...entry(i+50),body:{draft:'x'.repeat(40000)}})))));}finally{files.writeStringToFile=originalWrite;}
 assert.deepEqual(await a.read(),before);
 assert.equal(await a.compareAndSwap(before.revision,state(before.revision+1,[entry(90)])),true);
 const committed=await a.read();calls=0;
 files.writeStringToFile=async(path:string,text:string)=>{if(++calls===2){await originalWrite(path,text.slice(0,10));throw new Error('manifest power loss');}await originalWrite(path,text);};
 try{await assert.rejects(a.compareAndSwap(committed.revision,state(committed.revision+1,[entry(91)])));}finally{files.writeStringToFile=originalWrite;}
 assert.deepEqual(await a.read(),committed);
});
test('scope switch quarantines original family without reactivation on later login',async()=>{
 const a=new Store();await a.activate({...scope,familyId:'successor'});
 let current=await a.read();assert.equal(current.entries[0].state,'quarantined');assert.equal(current.entries[0].scope.familyId,'family');assert.deepEqual(current.entries[0].body,{generation:7,positionMs:1234});
 await a.activate(scope);current=await a.read();assert.equal(current.entries[0].state,'quarantined');
});
