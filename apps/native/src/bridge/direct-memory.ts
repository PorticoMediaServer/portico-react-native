import {NativeQueueStore} from './queue-storage';

/**
 * The last direct sign-in on this device: the server address and the username that the server
 * accepted (never the password). When a sign-in ends and the person is sent back to sign in, the
 * form opens with both filled in, so signing in again is the password alone.
 */
const store = new NativeQueueStore();
const KEY = 'direct.lastSignIn';
export type DirectMemory = Readonly<{address: string; username: string}>;

const host = (address: string) => address.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '').toLowerCase();

export async function rememberDirectSignIn(address: string, username: string): Promise<void> {
  const value = {address: address.trim(), username: username.trim()};
  if (!value.address || !value.username || value.username.length > 256 || value.address.length > 2048) return;
  await store.change(KEY, () => ({record: value, value: undefined}));
}

/** The remembered username for `address`, or undefined (another server, or none saved). */
export async function rememberedUsername(address: string): Promise<string | undefined> {
  const saved = await store.change(KEY, raw => ({record: raw, value: raw as Partial<DirectMemory> | null}));
  if (!saved || typeof saved.address !== 'string' || typeof saved.username !== 'string' || !address.trim()) return undefined;
  return host(saved.address) === host(address) ? saved.username : undefined;
}
