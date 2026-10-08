/**
 * Relaunch on Playback Protocol v1: the device's current v1 queue id, kept in the native store per
 * viewer, so a relaunch can `open(queueId)` and show Up Next where the person left off (nothing
 * starts playing). A queue the server no longer has (404) is forgotten quietly; any other failure
 * keeps the id for the next launch.
 */
export type QueueMemoryStore = {change<T>(key: string, update: (raw: unknown) => {record: unknown; value: T}): Promise<T>};
export type QueueMemoryViewer = Readonly<{serverId: string; authority: string; accountId: string; profileId: string}>;

const validId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

export const v1QueueKey = (v: QueueMemoryViewer) => `playback.v1.queue|${v.serverId}|${v.authority}|${v.accountId}|${v.profileId}`;

export class V1QueueMemory {
  private readonly store: QueueMemoryStore;
  private readonly key: string;
  private last?: string | null;
  constructor(store: QueueMemoryStore, viewer: QueueMemoryViewer) {
    this.store = store;
    this.key = v1QueueKey(viewer);
  }

  async read(): Promise<string | undefined> {
    const value = await this.store.change(this.key, raw => ({record: raw, value: raw}));
    const id = validId(value) ? value : undefined;
    this.last = id ?? null;
    return id;
  }

  /** The v1 queue this device now plays. Writes only when it changed. */
  async save(queueId: string): Promise<void> {
    if (!validId(queueId) || this.last === queueId) return;
    this.last = queueId;
    await this.store.change(this.key, () => ({record: queueId, value: undefined}));
  }

  /** No v1 queue to come back to (a /v2 play took over, or the server forgot it). */
  async clear(): Promise<void> {
    if (this.last === null) return;
    this.last = null;
    await this.store.change(this.key, () => ({record: null, value: undefined}));
  }
}

/** At launch: show the saved queue without playing. */
export async function restoreV1Queue(memory: V1QueueMemory, open: (queueId: string) => Promise<void>): Promise<'none' | 'opened' | 'forgotten' | 'kept'> {
  const id = await memory.read().catch(() => undefined);
  if (!id) return 'none';
  try {
    await open(id);
    return 'opened';
  } catch (e) {
    if ((e as {status?: unknown} | null)?.status === 404) {
      await memory.clear().catch(() => {});
      return 'forgotten';
    }
    return 'kept';
  }
}
