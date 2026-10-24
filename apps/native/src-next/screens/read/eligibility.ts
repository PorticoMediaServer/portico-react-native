import {ReadingError, type ReadingClient} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
export type NativeReadEligibility = Awaited<ReturnType<ReadingClient['versions']>>;
/** Authoritative producer only. A book-labelled audiobook is never inferred as Read. */
export async function nativeReadEligibility(client: ReadingClient, itemId: string, signal?: AbortSignal): Promise<NativeReadEligibility | null> {
  try {const result = await client.versions(itemId, signal); return result.versions.length ? result : null;}
  catch (error) {if (error instanceof ReadingError && error.status === 404) return null; throw error;}
}
/** The caller supplies an actual selected version. There is no format/default
 * preference, inventory fallback, URL, or server credential in a route. */
export async function openNativeRead(context: NativeShellBootstrapContext, target: Readonly<{itemId: string; sourceId: string}>, signal?: AbortSignal): Promise<boolean> {
  const selected = context.session(), route = context.navigation.getSnapshot();
  if (!selected || !context.current()) return false;
  const current = () => context.current() && context.session()?.sessionFamilyId === selected.sessionFamilyId && context.navigation.getSnapshot() === route;
  const client = context.api.reading({viewer: selected.viewer, isCurrent: current, signal});
  try {
    const eligibility = await nativeReadEligibility(client, target.itemId, signal);
    if (!current() || !eligibility?.versions.some(version => version.sourceId === target.sourceId && version.inventoryAvailable)) return false;
    const destination: NativeShellRoute = {kind: 'read', itemId: target.itemId, sourceId: target.sourceId};
    return context.navigation.open(destination, context.authority());
  } finally {client.dispose();}
}
