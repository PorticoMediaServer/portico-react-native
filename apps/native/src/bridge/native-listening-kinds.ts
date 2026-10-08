/**
 * Which v1 audio kinds the native listening owner (PorticoListeningSessionOwner, plan §9.3 C3) plays.
 * A kind plays natively only when the server lists it in `features.playback_v1_kinds` AND it is
 * turned on here. Music is on (24 Sep): its queue entries are songs (`song`, or `track` from older
 * servers); albums, artists and discs are containers whose entries are songs. Audiobooks
 * (`audiobook_file`) are on too (24 Sep): the native harness passes resume, the book rate,
 * skips, the end-of-chapter timer and gapless parts.
 */
export const nativeV1ListeningKinds: readonly string[] = Object.freeze(['song', 'track', 'audiobook_file']);

/** The server's `features.playback_v1_kinds` (spec: GET /v1/capabilities), or none. */
export function serverPlaybackV1Kinds(capabilities: unknown): readonly string[] {
  const features = capabilities && typeof capabilities === 'object' ? (capabilities as {features?: unknown}).features : undefined;
  const kinds = features && typeof features === 'object' ? (features as Record<string, unknown>).playback_v1_kinds : undefined;
  // The server's features map is string to string, so the list comes comma-separated
  // ("movie,episode,…,song,track"); an array is accepted too.
  if (typeof kinds === 'string') return kinds.split(',').map(k => k.trim()).filter(Boolean);
  return Array.isArray(kinds) ? kinds.filter((k): k is string => typeof k === 'string') : [];
}

/** Whether an item kind plays under the native owner (both the server and this app say yes). */
export function nativeListeningFor(serverKinds: readonly string[], enabled: readonly string[] = nativeV1ListeningKinds) {
  return (kind: string) => serverKinds.includes(kind) && enabled.includes(kind);
}
