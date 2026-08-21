import type {MediaItem, PorticoClient} from '@portico/client-core';
import type {MediaViewModel} from './types';

export function mediaViewModel(item: MediaItem, client: Pick<PorticoClient, 'imageResourceUrl'>): MediaViewModel {
  const poster = imageURL(item, client, 'poster');
  const backdrop = imageURL(item, client, 'backdrop') ?? imageURL(item, client, 'fanart');
  const progressSeconds = item.state?.progressSeconds ?? 0;
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    subtitle: item.grandparentTitle ?? item.parentTitle,
    summary: item.summary,
    year: item.year,
    durationSeconds: item.durationSeconds,
    poster,
    backdrop,
    progress: item.durationSeconds ? Math.min(1, progressSeconds / item.durationSeconds) : undefined,
    raw: item,
  };
}

function imageURL(item: MediaItem, client: Pick<PorticoClient, 'imageResourceUrl'>, type: string): string | undefined {
  const image = item.images?.[type as keyof typeof item.images];
  if (!image) return undefined;
  return client.imageResourceUrl(image);
}
