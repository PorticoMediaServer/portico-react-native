import {viewerScope as describeViewer} from '../../../../packages/client-core/src/presentation/index';

export type ViewerScope = {viewerId: string; serverId: string};

/** Scopes handed out so far, by value. A device sees a handful of viewers in one run. */
const known = new Map<string, ViewerScope>();
const LIMIT = 32;

/**
 * The viewer a screen's data belongs to, as one object per viewer and server.
 *
 * A renewed sign-in publishes a new session object for the same person. Screens key their
 * services on this scope, so it has to stay the same object for as long as the person and the
 * server are the same; otherwise every open screen would throw its content away and load it
 * again each time the sign-in is renewed.
 */
export function viewerScope(session: Parameters<typeof describeViewer>[0], api: {baseUrl: string}): ViewerScope {
  const next = describeViewer(session, api);
  const key = next.viewerId + '\n' + next.serverId;
  const hit = known.get(key);
  if (hit) return hit;
  if (known.size >= LIMIT) known.delete(known.keys().next().value as string);
  const scope = Object.freeze(next);
  known.set(key, scope);
  return scope;
}
