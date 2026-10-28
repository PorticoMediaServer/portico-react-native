import {NativeModules} from 'react-native';
import {validateUserMutationState, type DurableUserMutationStore, type UserMutationScope, type UserMutationState, UserMutationError} from '../../../../packages/client-core/src/user-mutations';

export interface NativeUserMutationBridge {
 userMutationTransaction(operation:'read'|'cas'|'scope',payload:string):Promise<string|boolean>;
}
/** Entire aggregate CAS executes in the platform storage owner. Bounded inactive
 * pages plus one durable manifest commit include every scope in the same quota. */
export class NativeUserMutationStore implements DurableUserMutationStore {
 constructor(private readonly bridge:NativeUserMutationBridge=NativeModules.PorticoRuntime){}
 private async call(operation:'read'|'cas'|'scope',payload:unknown):Promise<string|boolean>{
  if(typeof this.bridge?.userMutationTransaction!=='function')throw new UserMutationError('mutation_store_unavailable');
  return this.bridge.userMutationTransaction(operation,JSON.stringify(payload));
 }
 async read():Promise<UserMutationState>{
  const raw=await this.call('read',{});
  if(typeof raw!=='string')throw new UserMutationError('mutation_store_damaged');
  return validateUserMutationState(JSON.parse(raw));
 }
 async compareAndSwap(expectedRevision:number,next:UserMutationState):Promise<boolean>{
  validateUserMutationState(next);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||next.revision!==expectedRevision+1)throw new UserMutationError('mutation_store_damaged');
  const result=await this.call('cas',{expectedRevision,next});
  if(typeof result!=='boolean')throw new UserMutationError('mutation_store_damaged');
  return result;
 }
 /** Activating a different family quarantines pending work atomically. No later
  * login restores it to pending, including a login to the same account. */
 async activate(scope:UserMutationScope|undefined):Promise<void>{await this.call('scope',{scope:scope??null});}
}
