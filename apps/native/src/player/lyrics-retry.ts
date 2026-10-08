/** The library is set to its own metadata only (local_metadata_only): trying again can't bring
 * lyrics from online, so no Try again is offered (P3, F-title). */
export function retryable(error: unknown): boolean {
  return (error as {code?: unknown} | null)?.code !== 'local_metadata_only';
}
