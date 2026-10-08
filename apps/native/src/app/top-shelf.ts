import {NativeModules} from 'react-native';

type Api = {request<T>(path: string, method?: string, body?: unknown): Promise<T>; mediaUrl(path: string): string};
const native = NativeModules.PorticoTopShelf as undefined | {
  configure(baseUrl: string, token: string, expiresAt: string, owner: string): Promise<void>; expiresAt(): Promise<null | {baseUrl: string; expiresAt: string; owner?: string}>; clear(): Promise<void>; changed(): void;
};
const RENEW_WITH_LEFT_MS = 20 * 86400000;

/** Keeps the Apple TV home-screen shelf supplied. The shelf's extension cannot sign in, so the
 * app gives it a token that reads one small feed; it is renewed when it is two-thirds used, which
 * for a television opened at all in a month means the shelf never goes empty. One request, and
 * only when a renewal is actually due. */
/** `owner` is the signed-in viewer (server and profile): a shelf held for anyone else is replaced,
 * never reused, so another profile's Continue Watching doesn't stay on the home screen. */
export async function refreshTopShelf(api: Api, installationId: string, owner: string): Promise<void> {
  if (!native) return;
  try {
    const origin = new URL(api.mediaUrl('/v1/topshelf')).origin;
    const held = await native.expiresAt();
    if (held && held.baseUrl === origin && held.owner === owner && Date.parse(held.expiresAt) - Date.now() > RENEW_WITH_LEFT_MS) return;
    const issued = await api.request<{token?: string; expiresAt?: string}>('/v1/topshelf/token', 'POST', {installationId});
    if (typeof issued.token === 'string' && typeof issued.expiresAt === 'string') await native.configure(origin, issued.token, issued.expiresAt, owner);
  } catch { /* the shelf keeps whatever it had */ }
}
export const clearTopShelf = () => void native?.clear().catch(() => {});
/** Something was watched: let the home screen ask for a fresh Continue Watching. */
export const topShelfChanged = () => native?.changed();
