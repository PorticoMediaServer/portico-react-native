import {useMemo, useSyncExternalStore} from 'react';
import {continueScope} from './continue-watching';
import {notInterestedFor, notInterestedSnapshot, subscribeNotInterested} from './not-interested';
import {useSession} from './session';

/** The recommendation cards this viewer turned down (./not-interested.ts), for the screens that show them. */
export function useTurnedDown(): ReadonlySet<string> {
  const {session, api} = useSession();
  const scope = continueScope(session?.viewer.serverId ?? api.baseUrl, session?.viewer.accountId, session?.viewer.profileId);
  const all = useSyncExternalStore(subscribeNotInterested, notInterestedSnapshot);
  return useMemo(() => notInterestedFor(all, scope), [all, scope]);
}
