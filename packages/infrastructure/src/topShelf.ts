import {NativeModules} from 'react-native';

export interface PorticoTopShelfItem {
  id: string;
  title: string;
  imageURL?: string;
  imageHeaders?: Readonly<Record<string, string>>;
  progress?: number;
}

interface PorticoTopShelfNativeModule {
  clear(): Promise<void>;
  update(items: readonly PorticoTopShelfItem[]): Promise<void>;
}

function nativeModule(): PorticoTopShelfNativeModule | undefined {
  return NativeModules.PorticoTopShelf as PorticoTopShelfNativeModule | undefined;
}

/**
 * Publishes a bounded, profile-scoped Continue Watching snapshot to tvOS.
 * Artwork credentials are handed directly to the native downloader and are
 * never persisted in the shared Top Shelf payload.
 */
export async function updatePorticoTopShelf(
  items: readonly PorticoTopShelfItem[],
): Promise<void> {
  const module = nativeModule();
  if (!module) return;
  await module.update(items.slice(0, 12));
}

/** Removes the prior viewer's snapshot before sign-out or profile selection. */
export async function clearPorticoTopShelf(): Promise<void> {
  const module = nativeModule();
  if (!module) return;
  await module.clear();
}
