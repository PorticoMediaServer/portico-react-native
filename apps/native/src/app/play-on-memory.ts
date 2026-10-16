/**
 * The last title this device sent to another one with Play on, kept so the app can pick the
 * controls back up after it was closed: which handoff it was, whose it was, and what to call the
 * device it went to. Platform-neutral (the store is handed in): tested under Node.
 *
 * It holds no credential. The server decides again, with this device's own sign-in, whether the
 * handoff is still this viewer's to control.
 */
export type SentPlayback = Readonly<{viewer: string; handoffId: string; device: string; title?: string; at: number}>;

/** A destination is forgotten after this long: a film that started yesterday is not still playing. */
export const SENT_PLAYBACK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\x00-\x1f\x7f]/.test(v);

/** What was stored, when it can still be used by this viewer now; anything else reads as nothing. */
export function readSentPlayback(raw: unknown, viewer: string, now: number): SentPlayback | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const v = raw as Record<string, unknown>;
  // The viewer is compared whole with the signed-in one, so it needs no shape of its own.
  if (typeof v.viewer !== 'string' || !viewer || v.viewer !== viewer || !text(v.handoffId, 128) || !/^[A-Za-z0-9_.:-]+$/.test(v.handoffId) || !text(v.device, 128)) return undefined;
  if (typeof v.at !== 'number' || !Number.isFinite(v.at) || v.at > now + 60_000 || now - v.at > SENT_PLAYBACK_MAX_AGE_MS) return undefined;
  return Object.freeze({viewer: v.viewer, handoffId: v.handoffId, device: v.device, ...(text(v.title, 300) ? {title: v.title} : {}), at: v.at});
}
