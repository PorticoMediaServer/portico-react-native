import type {RememberedServer} from '../../../../packages/client-core/src/server-connections';

/**
 * Which list a signed-in server belongs on in Settings › Servers: a sign-in kept with its Portico
 * route source (a Portico Account member, including one who joined by an invitation link) is one
 * of "Your servers"; any other server-local sign-in is "Signed in directly". One entry, never both.
 */
export function directEntryFor(saved: Pick<RememberedServer, 'hosted' | 'pin'> | undefined, serverId: string): 'portico' | 'direct' {
  return saved?.hosted && saved.pin.serverId === serverId ? 'portico' : 'direct';
}
