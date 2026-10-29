import {SPLITTABLE_KINDS} from '../../../../../packages/client-core/src/title-identity';
import type {SearchGroup} from '../../../../../packages/client-core/src/search';
import {fileInfoTrackKey, type FileInfoSession, type FileInfoSnapshot} from '../../../../../packages/client-core/src/file-info-session';
import {fileInfoPanelModel} from '../../../../../packages/client-core/src/presentation/file-info-versions';
import type {FileInfoFileRow, FileInfoGroupRow} from '../../../../../packages/client-core/src/file-info-pages';
import type {FileInfoModel, ManageAction, TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';

export const nativeFileInfoMergeGroups: Readonly<Partial<Record<string, SearchGroup>>> = Object.freeze({movie: 'movies', show: 'shows', episode: 'episodes', song: 'songs', album: 'albums', artist: 'artists', book: 'books', author: 'authors'});

/** One file the owner sees under its version: its exact occurrence, path and actions. */
export type NativeFileInfoLocation = Readonly<{id: string; versionId: string; path?: string; actions: readonly ManageAction[]}>;
/** The measured disc title behind one version: a probed number and its chapter count. */
export type NativeFileInfoDisc = Readonly<{id: string; titleNumber: number; chapterCount: number}>;
/** File info for one opening of one accepted Detail. The session holds the windows; it is retired
 * with the overlay. `changed` refreshes the title after an owner's command. */
export type NativeFileInfoOwner = Readonly<{session: FileInfoSession; kind: string; changed: () => Promise<void>}>;
export type NativeFileInfoView = Readonly<{model: FileInfoModel; locations?: readonly NativeFileInfoLocation[]; disc: readonly NativeFileInfoDisc[]; versionCount: number}>;

/** The versions directory as the panel shows it: groups, each with whatever windows of its head's
 * offered tracks and (owner) files are resident. Nothing is inferred from a count. */
export function nativeFileInfoView(snapshot: FileInfoSnapshot, kind: string, text: TextEnvironment, isTV: boolean): NativeFileInfoView | undefined {
  const groups = snapshot.groups.rows?.rows, surface = snapshot.surface;
  if (!groups || !surface) return undefined;
  // Native lists each version head's offered tracks; Split only for a kind that can be split.
  const model = fileInfoPanelModel(snapshot, {tracks: 'offered', context: isTV ? 'desktop' : 'phone', manageSurface: isTV ? 'desktop' : 'phone',
    split: SPLITTABLE_KINDS.includes(kind), merge: !!nativeFileInfoMergeGroups[kind]}, text)!;
  const locations: readonly NativeFileInfoLocation[] | undefined = model.owner?.locations.map(location => Object.freeze({id: location.id, versionId: location.versionId, path: location.path, actions: location.actions}));
  // A version's own probed disc title, where the server measured one; a multipart version has none.
  const disc = groups.flatMap(group => group.disc ? [Object.freeze({id: group.id, titleNumber: group.disc.titleNumber, chapterCount: group.disc.chapterCount})] : []);
  return Object.freeze({model, ...(locations ? {locations} : {}), disc: Object.freeze(disc), versionCount: surface.groupCount});
}

/** Read what a resident version shows: its head's offered tracks, and for an owner its files. */
export function nativeFileInfoShowVersion(session: FileInfoSession, group: FileInfoGroupRow): void {
  const snapshot = session.getSnapshot();
  for (const lane of ['audio', 'subtitles'] as const) {
    if ((lane === 'audio' ? group.audioCount : group.subtitleCount) > 0 && !snapshot.headTracks.has(fileInfoTrackKey(group.id, lane))) void session.headTracks(group.id, lane);
  }
  if (snapshot.surface?.manage && !snapshot.members.has(group.id)) void session.members(group.id);
}

/** The owner file an action was chosen for, as it was listed. */
export function nativeFileInfoFile(snapshot: FileInfoSnapshot, occurrence: string): Readonly<{group: FileInfoGroupRow; file: FileInfoFileRow}> | undefined {
  for (const group of snapshot.groups.rows?.rows ?? []) {
    const file = snapshot.members.get(group.id)?.rows?.rows.find(row => row.occurrence === occurrence);
    if (file) return Object.freeze({group, file});
  }
  return undefined;
}

/** Versions that are one file on their own, the only ones Split can make a title of. Their file is
 * the listed one; a version whose files were not read yet is named by its head. */
export function nativeSplitCandidates(snapshot: FileInfoSnapshot): readonly Readonly<{group: FileInfoGroupRow; occurrence: string; file?: FileInfoFileRow}>[] {
  return Object.freeze((snapshot.groups.rows?.rows ?? []).filter(group => group.memberCount === 1).map(group => {
    const file = snapshot.members.get(group.id)?.rows?.rows[0];
    return Object.freeze({group, occurrence: file?.occurrence ?? group.headOccurrence, ...(file ? {file} : {})});
  }));
}
