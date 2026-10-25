import type {ReadingHostContentsTarget} from '../../../../../packages/client-core/src/reading-host';
import {ReadingError, type ReadingClient, type ReadingItem} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
export type NativeReadEligibility = Awaited<ReturnType<ReadingClient['versions']>>;
export type NativeReadNavigationContext = Pick<NativeShellBootstrapContext, 'api' | 'session' | 'current' | 'navigation' | 'authority'>;
/** Authoritative producer only. A book-labelled audiobook is never inferred as Read. */
export async function nativeReadEligibility(client: ReadingClient, itemId: string, signal?: AbortSignal): Promise<NativeReadEligibility | null> {
  try {const result = await client.versions(itemId, signal); return result.versions.length ? result : null;}
  catch (error) {if (error instanceof ReadingError && error.status === 404) return null; throw error;}
}
/** The caller supplies an actual selected version. There is no format/default
 * preference, inventory fallback, URL, or server credential in a route. */
export async function openNativeRead(context: NativeReadNavigationContext, target: Readonly<{itemId: string; sourceId: string; contentsTarget?: ReadingHostContentsTarget}>, signal?: AbortSignal): Promise<boolean> {
  const selected = context.session(), route = context.navigation.getSnapshot();
  const destination: NativeShellRoute = {kind: 'read', itemId: target.itemId, sourceId: target.sourceId, ...(target.contentsTarget ? {contentsTarget: target.contentsTarget} : {})};
  if (target.contentsTarget && (target.contentsTarget.sourceId !== target.sourceId || !target.contentsTarget.sourceRevision
    || !Number.isInteger(target.contentsTarget.index) || target.contentsTarget.index < 0 || target.contentsTarget.index > 511)) return false;
  if (signal?.aborted || !selected || !context.current() || !context.navigation.allows(destination)) return false;
  const current = () => context.current() && context.session()?.sessionFamilyId === selected.sessionFamilyId && context.navigation.getSnapshot() === route;
  const client = context.api.reading({viewer: selected.viewer, isCurrent: current, signal});
  try {
    const eligibility = await nativeReadEligibility(client, target.itemId, signal);
    if (!current() || !eligibility?.versions.some(version => version.sourceId === target.sourceId && version.inventoryAvailable)) return false;
    return context.navigation.open(destination, context.authority());
  } finally {client.dispose();}
}

/** The phone's drawn book destination: a real Reading item's own page, not the
 * generic title screen and not a second reader host. */
export async function openNativeReadBook(context: NativeReadNavigationContext, target: Readonly<{libraryId: string; item: ReadingItem}>, signal?: AbortSignal): Promise<boolean> {
  const selected = context.session(), route = context.navigation.getSnapshot();
  const destination: NativeShellRoute = {kind: 'read-book', libraryId: target.libraryId, item: target.item};
  if (target.item.libraryId !== target.libraryId || signal?.aborted || !selected || !context.current() || !context.navigation.allows(destination)) return false;
  const current = () => context.current() && context.session()?.sessionFamilyId === selected.sessionFamilyId && context.navigation.getSnapshot() === route;
  const client = context.api.reading({viewer: selected.viewer, isCurrent: current, signal});
  try {
    const eligibility = await nativeReadEligibility(client, target.item.id, signal);
    // The page may select any real available version; the reader door still
    // revalidates the exact selected source before it opens the host session.
    if (!current() || !eligibility?.versions.some(version => version.inventoryAvailable)) return false;
    return context.navigation.open(destination, context.authority());
  } finally {client.dispose();}
}

/** The series' signed membership id from the item projection, never a label hash. */
export async function openNativeReadSeries(context: NativeReadNavigationContext, target: Readonly<{libraryId: string; seriesId: string}>, signal?: AbortSignal): Promise<boolean> {
  const selected = context.session(), route = context.navigation.getSnapshot();
  if (!/^[A-Za-z0-9_-]{43}$/.test(target.seriesId) || signal?.aborted || !selected || !context.current()) return false;
  const destination: NativeShellRoute = {kind: 'read-series', libraryId: target.libraryId, seriesId: target.seriesId};
  return context.navigation.allows(destination) && context.navigation.getSnapshot() === route ? context.navigation.open(destination, context.authority()) : false;
}
