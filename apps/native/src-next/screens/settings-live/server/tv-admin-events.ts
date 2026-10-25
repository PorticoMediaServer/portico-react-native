/**
 * TV39: the administrator's Troubleshooting page reads the server's coded event
 * projection, and this is the whole vocabulary it may show. Each code is one
 * server-wide maintenance action the server records in its own audit trail;
 * one viewer's own download activity is not part of it, so its timing never
 * reaches an administrator.
 *
 * The server omits any action outside this list, and this parser drops an
 * unknown code rather than rendering a sentence that would misstate what
 * happened. A record keeps only its recorded time and its code, so no message,
 * path, title, asset, session or account token can reach the screen.
 *
 * The canonical home for this projection is the shared administration parser in
 * client-core's server-administration.ts, which is mirrored from portico-server.
 * This copy is local until that parser is authored on the server and mirrored,
 * because a mirrored package is never edited by hand here.
 */
export const adminServerEventCodes = [
  'alert.acknowledge',
  'downloads.settings',
  'job.cancel',
  'job.pause',
  'job.resume',
  'job.retry',
  'optimization.cancel',
  'optimization.delete',
  'optimization.request',
  'optimization.retry',
  'schedule.apply',
  'settings.apply',
] as const;
export type AdminServerEventCode = typeof adminServerEventCodes[number];
export type AdminServerEvent = Readonly<{at: string; code: AdminServerEventCode}>;

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const mismatch = (): never => {throw new Error('The administration response does not match this server. Refresh before continuing.');};
const instant = (value: unknown): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || /[\x00-\x1f]/.test(value)) return mismatch();
  if (!Number.isFinite(Date.parse(value))) return mismatch();
  return value;
};

/** The bounded list is the latest eligible events, not the latest log lines. A
 * document that claims more than the eight-record bound is refused, and an
 * unknown code is dropped instead of being shown under a nearest-match sentence. */
export function parseAdminServerEvents(raw: unknown): readonly AdminServerEvent[] {
  if (!record(raw)) return mismatch();
  const items = raw.items;
  if (!Array.isArray(items)) return mismatch();
  if (raw.limit !== 8 || items.length > 8) return mismatch();
  const events: AdminServerEvent[] = [];
  for (const entry of items) {
    if (!record(entry)) return mismatch();
    if (typeof entry.code !== 'string' || !(adminServerEventCodes as readonly string[]).includes(entry.code)) continue;
    events.push(Object.freeze({at: instant(entry.at), code: entry.code as AdminServerEventCode}));
  }
  return Object.freeze(events);
}
