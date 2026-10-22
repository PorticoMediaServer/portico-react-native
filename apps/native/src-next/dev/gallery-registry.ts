import type {ComponentType} from 'react';
import type {NextMessageId} from '../../../../packages/i18n/src/catalog/en-US/next/index';

/** web is the genuine >=1024 desktop theme column, never a phone alias. */
export type GalleryPlatform = 'phone' | 'tablet' | 'web' | 'tv';
export type Gallery = Readonly<{id: string; title: NextMessageId; render: ComponentType; platforms?: readonly GalleryPlatform[]}>;
export type GalleryContext = {keys(): string[]; (key: string): {default: Gallery | readonly Gallery[]}};
declare const require: {context(directory: string, recursive: boolean, filter: RegExp): GalleryContext};

export function galleriesForPlatform(galleries: readonly Gallery[], platform: GalleryPlatform): readonly Gallery[] {
  return galleries.filter(gallery => !gallery.platforms || gallery.platforms.includes(platform));
}

/** The existing Portico URL scheme opens a development gallery without editing an entry file. */
export function kitSelectionFromURL(value: string | null): {gallery?: string} | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== 'portico:' || url.hostname !== 'kit' || !['', '/'].includes(url.pathname)) return;
    const gallery = url.searchParams.get('gallery');
    return gallery ? {gallery} : {};
  } catch {return;}
}

/** Each family owns dev/families/<family>/*.gallery.tsx; registration never edits this file. */
export function collectGalleries(context: GalleryContext): readonly Gallery[] {
  const entries = context.keys().sort().flatMap(key => {
    const value = context(key).default;
    return Array.isArray(value) ? value : [value as Gallery];
  });
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || typeof entry.render !== 'function' || typeof entry.title !== 'string' || !entry.title.startsWith('next.')) throw new Error('Invalid native gallery registration.');
    if (ids.has(entry.id)) throw new Error(`Duplicate native gallery: ${entry.id}`);
    ids.add(entry.id);
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

export function discoverGalleries(): readonly Gallery[] {
  return collectGalleries(require.context('./', true, /^\.\/families\/.*\.gallery\.tsx?$/));
}
