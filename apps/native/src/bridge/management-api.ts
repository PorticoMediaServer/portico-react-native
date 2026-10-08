import type {CredentialSessionService} from '../../../../packages/client-core/src/index';
import type {ProfileAPI} from '../../../../packages/client-core/src/profile-management';
import {profileAPI} from './profile-transport';
export function nativeManagementAPI(credentials:CredentialSessionService,origin:string,scope:{accountId:string;familyId:string}):ProfileAPI{
 const assert=()=>{const live=credentials.getSnapshot().session;if(live?.account.id!==scope.accountId||live.familyId!==scope.familyId)throw new Error('Your Portico Account changed. Reopen this page.');};
 return {async request<T>(path:string,method='GET',body?:unknown,signal?:AbortSignal):Promise<T>{const live=await credentials.accessSession();assert();if(live.account.id!==scope.accountId||live.familyId!==scope.familyId)throw new Error('Your Portico Account changed.');const value=await profileAPI(origin,live.accessToken).request<T>(path,method,body,signal);assert();if(signal?.aborted)throw new Error('Account request cancelled.');return value;}};
}
