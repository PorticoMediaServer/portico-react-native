import {readFileInfo, type DetailApi, type DetailScope, type DetailTarget, type TitleFile} from '../../../../../packages/client-core/src/detail';
import {SPLITTABLE_KINDS} from '../../../../../packages/client-core/src/title-identity';
import type {SearchGroup} from '../../../../../packages/client-core/src/search';
import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import {fileInfoModel, type FileFacts, type ManageAction, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';

export const nativeFileInfoMergeGroups: Readonly<Partial<Record<string, SearchGroup>>> = Object.freeze({movie: 'movies', show: 'shows', episode: 'episodes', song: 'songs', album: 'albums', artist: 'artists', book: 'books', author: 'authors'});

export type NativeFileInfoLocation = Readonly<{id: string; versionId: string; path?: string; actions: readonly ManageAction[]}>;

/** Exact catalog token equality only; Options owns groups, never FileInfo partIndex/shape/count. */
export function nativeFileInfoGroups(files: readonly TitleFile[], options: PlaybackOptions, itemId: string) {
  if (options.itemId !== itemId || new Set(options.versions.map(version => version.id)).size !== options.versions.length) throw new Error('native_file_info_options');
  const byId = new Map(files.map(file => [file.id, file]));
  if (byId.size !== files.length) throw new Error('native_file_info_duplicate');
  const memberIds = new Set<string>();
  return options.versions.map(version => {
    if (version.parts.length && version.parts[0]?.id !== version.id) throw new Error('native_file_info_version_head');
    const members: TitleFile[] = [];
    for (const part of version.parts) {
      if (memberIds.has(part.id)) throw new Error('native_file_info_ambiguous_member');
      memberIds.add(part.id);
      const file = byId.get(part.id);
      if (file?.available) members.push(file);
    }
    return Object.freeze({version, members: Object.freeze(members)});
  }).filter(group => group.members.length);
}

/** All pages come from lazy File info. Ordinary title details never supply this surface. */
export async function readNativeFileInfo(api: DetailApi, scope: DetailScope, target: DetailTarget, options: PlaybackOptions, text: TextEnvironment, isTV: boolean, signal: AbortSignal) {
  let page = await readFileInfo(api, scope, target, {limit: 37}, signal);
  const first = page, files = [...page.files], seen = new Set(files.map(file => file.id)), cursors = new Set<string>();
  if (seen.size !== files.length) throw new Error('native_file_info_duplicate');
  while (page.nextCursor) {
    if (signal.aborted) throw new Error('native_file_info_cancelled');
    if (cursors.has(page.nextCursor)) throw new Error('native_file_info_cursor');
    cursors.add(page.nextCursor);
    page = await readFileInfo(api, scope, target, {limit: 37, cursor: page.nextCursor}, signal);
    if (page.revision.catalog !== first.revision.catalog || page.revision.viewer !== first.revision.viewer || page.scope.viewerFence !== first.scope.viewerFence
      || JSON.stringify(page.manage) !== JSON.stringify(first.manage)) throw new Error('native_file_info_stale');
    for (const file of page.files) {
      if (seen.has(file.id)) throw new Error('native_file_info_duplicate');
      seen.add(file.id); files.push(file);
    }
  }
  if (signal.aborted) throw new Error('native_file_info_cancelled');
  const groups = nativeFileInfoGroups(files, options, target.itemId);
  // These are offered version facts, not a selected file or selected track inference.
  const facts: FileFacts[] = groups.map(({version}) => ({id: version.id, name: version.label, available: true, edition: version.edition, container: version.container,
    sizeBytes: version.sizeBytes, durationSeconds: version.durationMs / 1000, bitRate: version.bitrateKbps === undefined ? undefined : version.bitrateKbps * 1000,
    width: version.video[0]?.width, height: version.video[0]?.height, videoCodec: version.video[0]?.codec, videoProfile: version.video[0]?.profile,
    dynamicRange: version.video[0]?.hdr, frameRate: version.video[0]?.fps, bitDepth: version.video[0]?.bitDepth,
    audio: version.audio.map(track => ({...track, channelLayout: track.layout, objectAudio: track.atmos ? 'atmos' : undefined})),
    subtitles: version.subtitles.map(track => ({...track, hearingImpaired: track.sdh, external: track.source === 'sidecar'}))}));
  const model = fileInfoModel(facts, first.manage ? {audience: 'owner', ownerFacts: {
    locations: groups.map(({version}) => ({id: version.id, canDelete: first.manage!.delete})), // A multipart member is not a whole version to split. Keep server permissions
    // intact below; expose only the real installed per-file/search flows here.
    canSplit: first.manage.split && SPLITTABLE_KINDS.includes(first.kind) && groups.length >= 2 && groups.some(group => group.members.length === 1),
    canMerge: first.manage.merge && !!nativeFileInfoMergeGroups[first.kind],
  }, manageSurface: isTV ? 'desktop' : 'phone'} : {audience: 'viewer'}, text, isTV ? 'desktop' : 'phone');
  const locations: readonly NativeFileInfoLocation[] | undefined = model.owner ? groups.flatMap(({version, members}) => members.map(file => ({
    id: file.id, versionId: version.id, path: file.path, actions: model.owner!.locations.find(location => location.id === version.id)?.actions ?? [],
  }))) : undefined;
  return Object.freeze({model, locations, groups: Object.freeze(groups), scope: first.scope, revision: first.revision, kind: first.kind,
    files: Object.freeze(files), manage: first.manage});
}

export type NativeFileInfo = Awaited<ReturnType<typeof readNativeFileInfo>>;
