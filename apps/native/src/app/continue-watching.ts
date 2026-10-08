/**
 * X-12: Remove from Continue Watching, from a Continue Watching card's long-press menu (iPhone,
 * iPad and television alike). The server's dismissal (`continueDismissed`, shared helper in
 * client-core) keeps the resume point; the title returns the next time it is played.
 *
 * The removal is optimistic: the card leaves the row at once and a toast offers Undo. A refused
 * request puts the card back with a message. Hidden titles live here, per viewer, until a Home the
 * server composed after the dismissal no longer lists them (so a later playback shows them again).
 * No React Native imports: the store and the flow are tested under Node.
 */
import {setContinueDismissed} from '../../../../packages/client-core/src/continue-watching';
import type {HomeRow} from '../../../../packages/client-core/src/home';

type Api = Parameters<typeof setContinueDismissed>[0];
type Hidden = Readonly<{scope: string; itemId: string; confirmed: boolean}>;
export type ContinueToast = {message: string; icon?: 'check' | 'warning'; action?: {label: string; onPress: () => void}};
export type ContinueRemoval = {
  api: Api;
  /** `continueScope(...)` of the signed-in viewer. */
  scope: string;
  itemId: string;
  title: string;
  /** The title's personal revision, when its detail is already loaded. */
  revision?: number;
  operationId: () => string | Promise<string>;
  toast: (toast: ContinueToast) => void;
  t: (key: 'entry.continueRemoved' | 'entry.continueRemoveFailed' | 'entry.continueRestoreFailed' | 'action.undo', values?: {title: string}) => string;
};

/**
 * The Continue Watching row: `continue` on the rows API (whose Continue Listening shares the
 * `continue` kind under its own ID), `continue_watching` as a kind on the older Home.
 */
export const isContinueRow = (row: Pick<HomeRow, 'id' | 'kind'>) => row.id === 'continue' || row.kind === 'continue_watching';
/** One viewer on one server; the same key Home caches its document under. */
export const continueScope = (server: string, account = '', profile = '') => `${server}|${account}|${profile}`;

let hidden: ReadonlyMap<string, Hidden> = new Map();
const listeners = new Set<() => void>();
const key = (scope: string, itemId: string) => scope + '\u0000' + itemId;
function write(next: Map<string, Hidden>) { hidden = next; for (const l of [...listeners]) l(); }
function set(scope: string, itemId: string, confirmed: boolean) { const next = new Map(hidden); next.set(key(scope, itemId), {scope, itemId, confirmed}); write(next); }
function drop(scope: string, itemId: string) { if (!hidden.has(key(scope, itemId))) return; const next = new Map(hidden); next.delete(key(scope, itemId)); write(next); }

/** Home reloads when the server's Continue Watching changed (a dismissal or an Undo landed). */
const changed = new Set<(scope: string) => void>();
export const onContinueChanged = (listener: (scope: string) => void) => { changed.add(listener); return () => { changed.delete(listener); }; };
const announce = (scope: string) => { for (const l of [...changed]) l(scope); };

export const subscribeContinueHidden = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const continueHiddenSnapshot = () => hidden;
/** The titles this viewer has removed and Home should not show. */
export function hiddenFor(snapshot: ReadonlyMap<string, Hidden>, scope: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const h of snapshot.values()) if (h.scope === scope) out.add(h.itemId);
  return out;
}

/** Home's rows with the removed titles taken out of Continue Watching (and its count). */
export function withoutRemoved<R extends Pick<HomeRow, 'id' | 'kind' | 'entries' | 'total'>>(rows: readonly R[], removed: ReadonlySet<string>): readonly R[] {
  if (!removed.size) return rows;
  return rows.map(row => {
    if (!isContinueRow(row)) return row;
    const entries = row.entries.filter(e => !removed.has(e.id));
    return entries.length === row.entries.length ? row : {...row, entries, total: Math.max(entries.length, row.total - (row.entries.length - entries.length))};
  });
}

/**
 * Called with each Home document as it arrives: a confirmed removal the server's Continue Watching
 * no longer lists is the server's to keep out from now on.
 */
export function settleContinueHidden(scope: string, rows: readonly Pick<HomeRow, 'id' | 'kind' | 'entries'>[]) {
  const listed = new Set(rows.filter(isContinueRow).flatMap(r => r.entries.map(e => e.id)));
  for (const h of [...hidden.values()]) if (h.scope === scope && h.confirmed && !listed.has(h.itemId)) drop(scope, h.itemId);
}

/** Takes the title off Continue Watching now, then tells the server; Undo puts it back. */
export async function removeFromContinueWatching(input: ContinueRemoval): Promise<boolean> {
  const {api, scope, itemId, title, toast, t, operationId} = input;
  set(scope, itemId, false);
  let revision: number;
  try {
    ({revision} = await setContinueDismissed(api, {itemId, dismissed: true, revision: input.revision, operationId}));
  } catch {
    drop(scope, itemId);
    toast({message: t('entry.continueRemoveFailed', {title}), icon: 'warning'});
    return false;
  }
  set(scope, itemId, true);
  announce(scope);
  const undo = async () => {
    drop(scope, itemId);
    try {
      await setContinueDismissed(api, {itemId, dismissed: false, revision, operationId});
      announce(scope);
    } catch {
      set(scope, itemId, true);
      toast({message: t('entry.continueRestoreFailed', {title}), icon: 'warning'});
    }
  };
  toast({message: t('entry.continueRemoved', {title}), icon: 'check', action: {label: t('action.undo'), onPress: () => void undo()}});
  return true;
}
