import type {OfflineEntry} from '../bridge/offline-downloads';

/**
 * Offline, a downloaded episode carries on to the next downloaded episode of the same show, as
 * the server's queue does online: the next one by season and episode number among this viewer's
 * finished downloads. Specials (season 0) are left out unless the episode that ended is one, as
 * a show's play from the server leaves them out. Nothing is asked of the server: what is on the
 * device is the whole choice. Pure, so node tests cover it (test/offline-next.test.ts).
 */
export function nextDownloadedEpisode(entries: readonly OfflineEntry[], current: OfflineEntry | undefined): OfflineEntry | undefined {
  const show = current && isEpisode(current) ? current.info?.parentId : undefined;
  if (!current || !show) return undefined;
  const [season, episode] = place(current);
  let best: OfflineEntry | undefined;
  for (const e of entries) {
    if (e.state !== 'ready' || e.itemId === current.itemId || !isEpisode(e) || e.info?.parentId !== show) continue;
    const [s, n] = place(e);
    if (s === 0 && season !== 0) continue;
    if (s < season || (s === season && n <= episode)) continue;
    if (!best || before(e, best)) best = e;
  }
  return best;
}

const isEpisode = (e: OfflineEntry) => (e.info?.kind ?? e.kind) === 'episode';
/** Season and episode: no season is season 1; no number sorts first. */
const place = (e: OfflineEntry): [number, number] => [e.info?.groupNumber ?? 1, e.info?.number ?? 0];
function before(a: OfflineEntry, b: OfflineEntry): boolean {
  const [sa, na] = place(a), [sb, nb] = place(b);
  return sa !== sb ? sa < sb : na !== nb ? na < nb : a.itemId < b.itemId;
}
