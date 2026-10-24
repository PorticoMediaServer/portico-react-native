/** One download intent raised from a title page. The shell owns the sheet, so a
 * title renderer only names the real item (or container) and its drawn title. */
export type NativeDownloadContainerKind = 'show' | 'season' | 'album' | 'book' | 'playlist';
export type NativeDownloadRequest = Readonly<{
  title: string;
  /** The single item to ask the server's real quality menu for. */
  itemId?: string;
  /** A whole show/season/album/book/playlist goes through the durable request. */
  container?: Readonly<{kind: NativeDownloadContainerKind; id: string}>;
}>;

let current: NativeDownloadRequest | undefined;
const listeners = new Set<() => void>();
const publish = () => {for (const listener of [...listeners]) listener();};

/** A newer intent replaces the sheet's request; the sheet is never stacked. */
export function askNativeDownload(request: NativeDownloadRequest): void {
  if (!request.title || !(request.itemId || request.container?.id)) return;
  current = Object.freeze({...request});
  publish();
}

export function closeNativeDownload(): void {
  if (!current) return;
  current = undefined;
  publish();
}

export function getNativeDownloadSnapshot(): NativeDownloadRequest | undefined {
  return current;
}

export function subscribeNativeDownload(listener: () => void): () => void {
  listeners.add(listener);
  return () => {listeners.delete(listener);};
}
