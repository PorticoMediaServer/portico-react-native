import {NativeQueueStore} from './queue-storage';

/**
 * Where this installation keeps the proofs that let it take back the controls of a Cast session
 * it started (client-core `CastController.controllerStorage`). The television hands one to the
 * sender that paired with it; a sender that returns later (the app was closed, the phone slept,
 * the system resumed the session) presents it and controls the same playback without pairing
 * again or starting the title over.
 *
 * The controller reads and writes at once, so the proofs are held in memory and kept in the
 * device's protected record store behind it. `castControllerStorageReady` settles when what was
 * saved has been read; a returning session is adopted only after that. The proofs never leave
 * this installation and are not part of any backup of the server.
 */
const KEY = 'cast.controllers:v1';
/** A phone meets a handful of televisions; the oldest proofs are let go beyond this. */
const LIMIT = 16;
const store = new NativeQueueStore();
const held = new Map<string, string>();

const usable = (key: unknown, value: unknown): value is string => typeof key === 'string' && key.length > 0 && key.length <= 512 && typeof value === 'string' && value.length > 0 && value.length <= 256;

/** What was saved, newest last. Anything that is not a proof this app could have written is left out. */
export function readControllerProofs(raw: unknown): [string, string][] {
  const items = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as {items?: unknown}).items : undefined;
  if (!Array.isArray(items)) return [];
  const out = new Map<string, string>();
  for (const row of items) {
    if (!Array.isArray(row) || row.length !== 2 || !usable(row[0], row[1])) continue;
    out.delete(row[0]);
    out.set(row[0], row[1]);
  }
  return [...out].slice(-LIMIT);
}

export const castControllerStorageReady: Promise<void> = store
  .change<[string, string][]>(KEY, raw => ({record: raw, value: readControllerProofs(raw)}))
  .then(saved => { for (const [key, value] of saved) if (!held.has(key)) held.set(key, value); }, () => {});

export const castControllerStorage = {
  get: (key: string): string | undefined => held.get(key),
  set: (key: string, value: string): void => {
    if (!usable(key, value)) return;
    held.delete(key);
    held.set(key, value);
    while (held.size > LIMIT) held.delete(held.keys().next().value as string);
    // Kept for later launches; a store that cannot be written only means pairing again next time.
    void castControllerStorageReady.then(() => store.change(KEY, () => ({record: {items: [...held]}, value: undefined}))).catch(() => {});
  },
};
