/**
 * Not interested (Recommendations P5), from a recommendation card's long-press menu (iPhone, iPad
 * and television alike). The title leaves every recommendation and similar titles rank a little
 * lower; client-core `setNotInterested` sends it on the personal batch route and Undo sends `false`.
 *
 * Like Remove from Continue Watching (./continue-watching.ts) it is optimistic: the card leaves its
 * recommendation rows at once and a toast offers Undo; a refused request puts the card back with a
 * message. Turned-down titles stay hidden here, per viewer, until an Undo or a Reset
 * recommendations: the server's own rows stop listing them from the next load anyway.
 * No React Native imports: the store and the flow are tested under Node.
 */
import {isRecommendationRow, notInterestedTarget, setNotInterested} from '../../../../packages/client-core/src/recommendation-feedback';

type Api = Parameters<typeof setNotInterested>[0];
export type NotInterestedToast = {message: string; icon?: 'check' | 'warning'; action?: {label: string; onPress: () => void}};
export type NotInterestedInput = {
  api: Api;
  /** `continueScope(...)` of the signed-in viewer (one viewer on one server). */
  scope: string;
  serverId: string;
  entry: {id: string; title: string; kind?: string; navigation?: {entityId?: string}};
  operationId: () => string | Promise<string>;
  toast: (toast: NotInterestedToast) => void;
  t: (key: 'entry.notInterestedDone' | 'entry.notInterestedFailed' | 'entry.notInterestedUndoFailed' | 'action.undo', values?: {title: string}) => string;
};

let hidden: ReadonlyMap<string, {scope: string; id: string}> = new Map();
const listeners = new Set<() => void>();
const key = (scope: string, id: string) => scope + '\u0000' + id;
function write(next: Map<string, {scope: string; id: string}>) { hidden = next; for (const l of [...listeners]) l(); }
function hide(scope: string, id: string) { const next = new Map(hidden); next.set(key(scope, id), {scope, id}); write(next); }
function show(scope: string, id: string) { if (!hidden.has(key(scope, id))) return; const next = new Map(hidden); next.delete(key(scope, id)); write(next); }

export const subscribeNotInterested = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const notInterestedSnapshot = () => hidden;
/** The card ids this viewer turned down. */
export function notInterestedFor(snapshot: typeof hidden, scope: string): ReadonlySet<string> {
  const out = new Set<string>();
  for (const h of snapshot.values()) if (h.scope === scope) out.add(h.id);
  return out;
}
/** After Reset recommendations: every title this viewer turned down may be offered again. */
export function forgetNotInterested(scope: string) {
  const next = new Map([...hidden].filter(([, h]) => h.scope !== scope));
  if (next.size !== hidden.size) write(next);
}

/** One recommendation row (or section) without the titles turned down; the same row when none is. */
export function withoutNotInterested<R extends {id: string; kind?: string; entries: readonly {id: string}[]; total?: number; totalCount?: number}>(row: R, turnedDown: ReadonlySet<string>, recommendation = isRecommendationRow(row)): R {
  if (!recommendation || !turnedDown.size || !row.entries.some(e => turnedDown.has(e.id))) return row;
  const entries = row.entries.filter(e => !turnedDown.has(e.id));
  const gone = row.entries.length - entries.length;
  return {...row, entries, ...(row.total !== undefined ? {total: Math.max(entries.length, row.total - gone)} : {}), ...(row.totalCount !== undefined ? {totalCount: Math.max(entries.length, row.totalCount - gone)} : {})};
}

/** Takes the title out of recommendations now, then tells the server; Undo puts it back. */
export async function markNotInterested(input: NotInterestedInput): Promise<boolean> {
  const {api, scope, serverId, entry, toast, t} = input;
  const itemId = notInterestedTarget(entry);
  const title = entry.title;
  hide(scope, entry.id);
  try {
    await setNotInterested(api, {itemId, notInterested: true, serverId, operationId: String(await input.operationId())});
  } catch {
    show(scope, entry.id);
    toast({message: t('entry.notInterestedFailed', {title}), icon: 'warning'});
    return false;
  }
  const undo = async () => {
    show(scope, entry.id);
    try {
      await setNotInterested(api, {itemId, notInterested: false, serverId, operationId: String(await input.operationId())});
    } catch {
      hide(scope, entry.id);
      toast({message: t('entry.notInterestedUndoFailed', {title}), icon: 'warning'});
    }
  };
  toast({message: t('entry.notInterestedDone', {title}), icon: 'check', action: {label: t('action.undo'), onPress: () => void undo()}});
  return true;
}
