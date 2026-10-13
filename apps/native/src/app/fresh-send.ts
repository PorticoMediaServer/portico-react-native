import {ALREADY_DONE, isStaleAnswer, rebaseDraft, sendWithFreshRecord} from '../../../../packages/client-core/src/freshness-actions';

/**
 * Saves that survive the server moving on underneath them, for the owner's pages: the shared
 * retry path (client-core `freshness-actions`) with the two shapes those pages need. Nothing here
 * decides what a person sees; a save that still makes sense is sent again without a word, and
 * only a real contradiction comes back as the server's first answer.
 */

/**
 * A change to one record that carries a revision (a webhook, a title waiting for a match, a
 * source's switch). When the server says the record moved, it is read again and the change is
 * sent again while `applies` says it still makes sense; `'done'` means it already is what was
 * asked for. A record that is gone ends with the first answer.
 */
export async function sendFresh<R, T>(record: R, send: (record: R) => Promise<T>, reread: () => Promise<R | undefined | null>, applies?: (now: R, was: R) => boolean | 'done'): Promise<T | undefined> {
  const out = await sendWithFreshRecord(record, send, {reread, applies});
  return out === ALREADY_DONE ? undefined : out;
}

/** One record of a list that is read a page at a time, as the server has it now; nothing when it is not within `pages` pages. */
export async function findInPages<T>(page: (cursor: string) => Promise<{items: readonly T[]; nextCursor: string}>, match: (item: T) => boolean, pages = 8): Promise<T | undefined> {
  let cursor = '';
  for (let n = 0; n < pages; n++) {
    const next = await page(cursor);
    const found = next.items.find(match);
    if (found) return found;
    // A cursor that does not move would read the same page for ever.
    if (!next.nextCursor || next.nextCursor === cursor) return undefined;
    cursor = next.nextCursor;
  }
  return undefined;
}

export type RebasedSave<T> = Readonly<{
  /** What the draft was edited from, and the revision it was read at. */
  base: T; revision: number;
  draft: T;
  put(revision: number, value: T): Promise<unknown>;
  /** The document as the server has it now. */
  reread(): Promise<Readonly<{revision: number; value: T}>>;
  /** The draft was carried onto a newer document: what the screen should now compare against (and at which revision), and show. */
  onRebased?(fresh: T, merged: T, revision: number): void;
}>;

/**
 * Saves a draft of a document guarded by a revision. When the document moved since it was read,
 * it is read again and the edits are carried onto it: what was not touched takes the server's
 * value, what was changed keeps the owner's. It is then saved once more. Only when the same
 * setting was changed to something else underneath does the first answer come back.
 */
export async function saveRebased<T>(save: RebasedSave<T>): Promise<void> {
  try { await save.put(save.revision, save.draft); return; } catch (error) {
    if (!isStaleAnswer(error)) throw error;
    // A re-read that fails leaves the owner with the first answer: the save itself did not go through.
    const fresh = await save.reread().catch(() => { throw error; });
    const rebased = rebaseDraft(save.base, save.draft, fresh.value);
    save.onRebased?.(fresh.value, rebased.merged, fresh.revision);
    if (rebased.conflict) throw error;
    await save.put(fresh.revision, rebased.merged);
  }
}

/** Runs a server action that works in passes until it says nothing is left, within a bound. Returns whether it finished. */
export async function untilDone(pass: () => Promise<{more: boolean}>, passes = 200): Promise<boolean> {
  for (let n = 0; n < passes; n++) if (!(await pass()).more) return true;
  return false;
}
