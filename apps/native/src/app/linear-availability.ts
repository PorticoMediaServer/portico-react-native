import {useEffect, useState} from 'react';
import {guideWindow, type ChannelKind} from '../../../../packages/client-core/src/channel-guide';
import {hasRealOrigin, useSession} from './session';

/**
 * APL-SHELL-02 / APL-LIVE-01: whether this server has Live TV sources and Library Channels, so the
 * rail and tab bar only offer destinations that exist. The server publishes no capability for
 * this yet, so the guide is asked for one channel of each kind. The last answer per server is kept
 * (the navigation doesn't jump while it's re-checked), and anything unknown counts as present.
 */
type Availability = {live: boolean; channels: boolean};
const known = new Map<string, Availability>();

async function probe(api: {request<T>(path: string, method?: string): Promise<T>}, kind: ChannelKind): Promise<boolean | undefined> {
  const window = guideWindow();
  const q = new URLSearchParams({kind, start: window.start, end: window.end, timezone: 'UTC', search: '', sourceId: '', limit: '1', cursor: ''});
  try {
    const raw = await api.request<{state?: unknown; sources?: unknown[]; channels?: unknown[]}>('/v1/guide?' + q.toString(), 'GET');
    if (raw?.state === 'no-sources') return false;
    return (raw?.sources?.length ?? 0) > 0 || (raw?.channels?.length ?? 0) > 0;
  } catch (e) {
    const status = (e as {status?: number})?.status;
    // A server without the feature answers 404; anything else is "don't know yet".
    return status === 404 ? false : undefined;
  }
}

export function useLinearAvailability(): Availability {
  const {api, session} = useSession();
  const key = session?.viewer.serverId ?? '';
  const [value, setValue] = useState<Availability>(() => known.get(key) ?? {live: true, channels: true});
  useEffect(() => {
    if (!key || !hasRealOrigin(api)) return;
    let live = true;
    setValue(known.get(key) ?? {live: true, channels: true});
    void Promise.all([probe(api, 'live-source'), probe(api, 'library-channel')]).then(([liveTV, channels]) => {
      const previous = known.get(key) ?? {live: true, channels: true};
      const next = {live: liveTV ?? previous.live, channels: channels ?? previous.channels};
      known.set(key, next);
      if (live) setValue(next);
    });
    return () => { live = false; };
  }, [api, key]);
  return value;
}
