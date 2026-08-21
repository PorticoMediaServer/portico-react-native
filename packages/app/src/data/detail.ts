import type {MediaCard, MediaItem, MediaPerson, PorticoClient} from '@porticomediaserver/client-core';
import {consumerMediaActions, type PorticoPlatform} from '@portico-react-native/infrastructure';
import type {MediaDetailViewModel, MediaViewModel} from './contracts';
import {mediaCardViewModel, mediaViewModel} from './mediaAdapters';

type ImageClient = Pick<PorticoClient, 'imageResourceUrl'>;

export interface DetailPersonViewModel {
  id: string;
  name: string;
  role: string;
  character?: string;
  imageUrl?: string;
}

export interface DetailRelationshipViewModel {
  id: string;
  title: string;
  items: MediaViewModel[];
}

export interface DetailViewModel {
  media: MediaDetailViewModel;
  actions: string[];
  people: DetailPersonViewModel[];
  extras: DetailRelationshipViewModel[];
  recommendations: DetailRelationshipViewModel[];
  facts: Array<{label: string; value: string}>;
  episodes: MediaViewModel[];
}

export function detailViewModel(item: MediaItem, client: ImageClient, platform: PorticoPlatform): DetailViewModel {
  return {
    media: mediaViewModel(item, client),
    actions: consumerMediaActions(item.actions, platform === 'tv' ? 'tvos' : 'ios'),
    people: (item.people ?? []).map(person => personViewModel(person, client)),
    extras: (item.extras ?? [])
      .map((relationship, index) => ({
        id: `extra-${relationship.type}-${index}`,
        title: relationship.label || extraLabel(relationship.type),
        items: relationship.items.map(candidate => mediaViewModel(candidate, client)),
      }))
      .filter(relationship => relationship.items.length > 0),
    recommendations: (item.recommendationRows ?? [])
      .map(row => ({
        id: row.id,
        title: row.title,
        items: row.items.map(candidate => mediaViewModel(candidate, client)),
      }))
      .filter(row => row.items.length > 0),
    facts: mediaFacts(item),
    episodes: episodeItems(item).map(candidate => mediaViewModel(candidate, client)),
  };
}

export function personMediaViewModels(items: MediaCard[], client: ImageClient): MediaViewModel[] {
  return items.map(item => mediaCardViewModel(item, client));
}

export function initialTVSeasonId(
  show: Pick<MediaItem, 'children' | 'playbackTarget'>,
  requestedSeasonId?: string,
): string | undefined {
  const seasons = (show.children ?? []).filter(child => child.type === 'season');
  if (requestedSeasonId && seasons.some(season => season.id === requestedSeasonId)) {
    return requestedSeasonId;
  }
  const playbackSeasonId = show.playbackTarget?.parentId;
  if (playbackSeasonId && seasons.some(season => season.id === playbackSeasonId)) {
    return playbackSeasonId;
  }
  return seasons[0]?.id;
}

export function shouldContinueToDeepLinkedEpisode(
  episodeId: string | undefined,
  loadedEpisodeIds: readonly string[],
  hasNextPage: boolean,
  continuationFailed: boolean,
): boolean {
  return Boolean(
    episodeId &&
      !loadedEpisodeIds.includes(episodeId) &&
      hasNextPage &&
      !continuationFailed,
  );
}

function personViewModel(person: MediaPerson, client: ImageClient): DetailPersonViewModel {
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    character: person.character,
    imageUrl: resolveImage(person.imageUrl, client),
  };
}

function resolveImage(value: string | undefined, client: ImageClient): string | undefined {
  if (!value) return undefined;
  if (/^(https?:|data:)/i.test(value)) return value;
  return client.imageResourceUrl(value, {width: 320});
}

function episodeItems(item: MediaItem): MediaItem[] {
  const children = item.children ?? [];
  if (children.some(child => child.type === 'episode')) return children.filter(child => child.type === 'episode');
  return children.flatMap(child => child.children ?? []).filter(child => child.type === 'episode');
}

function mediaFacts(item: MediaItem): Array<{label: string; value: string}> {
  const streams = item.streams ?? [];
  const video = streams.find(stream => stream.kind === 'video');
  const audio = streams.find(stream => stream.kind === 'audio');
  const subtitles = streams.filter(stream => stream.kind === 'subtitle');
  return [
    video ? {label: 'Video', value: [video.codec?.toUpperCase(), video.width && video.height ? `${video.width} × ${video.height}` : undefined].filter(Boolean).join(' · ')} : undefined,
    audio ? {label: 'Audio', value: [audio.codec?.toUpperCase(), audio.channels ? `${audio.channels} channels` : undefined, audio.language].filter(Boolean).join(' · ')} : undefined,
    {label: 'Subtitles', value: subtitles.length ? `${subtitles.length} available` : 'None'},
    item.edition ? {label: 'Edition', value: item.edition} : undefined,
  ].filter((fact): fact is {label: string; value: string} => Boolean(fact?.value));
}

function extraLabel(type: string): string {
  return type.split('_').map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join(' ');
}
