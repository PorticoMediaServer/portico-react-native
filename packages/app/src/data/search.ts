import type {PorticoClient, SearchResponse} from '@portico/client-core';
import type {MediaViewModel} from './contracts';
import {mediaViewModel} from './mediaAdapters';

type ImageClient = Pick<PorticoClient, 'imageResourceUrl'>;

export interface SearchGroupViewModel {
  id: string;
  title: string;
  items: MediaViewModel[];
  hasMore: boolean;
  nextCursor?: string;
}

export function searchGroupViewModels(
  response: SearchResponse,
  client: ImageClient,
): SearchGroupViewModel[] {
  return response.groups
    .map(group => ({
      id: group.id,
      title: group.title,
      items: group.items.map(item => mediaViewModel(item, client)),
      hasMore: group.hasMore,
      nextCursor: group.nextCursor,
    }))
    .filter(group => group.items.length > 0);
}

export function hasSearchResults(groups: SearchGroupViewModel[]): boolean {
  return groups.some(group => group.items.length > 0);
}
