/** Orders native continuation storage only within this JavaScript runtime. */
const pending = new Map<string, Promise<void>>();
export function serializeContinuation<T>(origin: string, work: () => Promise<T>): Promise<T> {
  const key = new URL(origin).origin;
  const previous = pending.get(key) ?? Promise.resolve();
  const result = previous.then(work);
  const settled = result.then(() => {}, () => {});
  pending.set(key, settled);
  void settled.then(() => {if (pending.get(key) === settled) pending.delete(key);});
  return result;
}
