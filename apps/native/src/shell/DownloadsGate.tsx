import React, {useEffect, useState} from 'react';
import {IdentityClient} from '../../../../packages/client-core/src/identity-client';
import {useSession} from '../app/session';
import {useOffline} from '../app/downloads';

/**
 * Whether the Downloads tab is offered (Justin: hide only what is disabled). Two things the server
 * says turn it off:
 * - the server doesn't offer downloads: every `/v1/downloads/*` read answers 503
 *   `downloads_unavailable` (no downloads service configured) or 404;
 * - this profile may not download: its `allowDownloads` restriction, readable for a direct sign-in
 *   at `/v1/direct/profiles/{id}/restrictions` (a Portico Account sign-in has none to read).
 * Anything else (offline, a failed read) keeps the tab, and it always shows while titles are on
 * this device: they stay playable offline.
 */
export function DownloadsGate({children, showing, onHidden}: {children: (offered: boolean) => React.ReactNode; /** The Downloads tab is the one on screen. */ showing?: boolean; /** It was just hidden while on screen: Home instead. */ onHidden?: (key: 'Home') => void}) {
  const {api, session} = useSession();
  const offline = useOffline();
  const [allowed, setAllowed] = useState(true);
  const local = session?.viewer.authority === 'local';
  const profileId = session?.viewer.profileId;
  useEffect(() => {
    setAllowed(true);
    if (!profileId) return;
    const controller = new AbortController();
    const off = () => { if (!controller.signal.aborted) setAllowed(false); };
    api.request('/v1/downloads/preparations?limit=1', 'GET', undefined, controller.signal).then(() => {
      if (local) new IdentityClient(api).restrictions(profileId, controller.signal).then(r => { if (!r.allowDownloads) off(); }, () => {});
    }, (e: {status?: number; code?: string} | null) => { if (e?.status === 404 || (e?.status === 503 && e.code === 'downloads_unavailable')) off(); });
    return () => controller.abort();
  }, [api, local, profileId]);
  const offered = allowed || offline.entries.length > 0;
  useEffect(() => { if (!offered && showing) onHidden?.('Home'); }, [offered, showing, onHidden]);
  return <>{children(offered)}</>;
}
