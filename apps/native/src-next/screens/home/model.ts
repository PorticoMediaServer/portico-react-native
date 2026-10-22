import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {HomeDocument, HomeRow} from '../../../../../packages/client-core/src/home';
import {cardText, type CardSubject, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import type {ShellAuthority} from '../../shell/model';

export function homeSubject(entry: ContentEntry): CardSubject {
  return {
    id: entry.id, kind: entry.kind, title: entry.title, year: entry.year,
    contentRating: entry.contentRating, genres: entry.genres, durationSeconds: entry.duration,
    positionSeconds: entry.progressSeconds, seasonCount: entry.seasonCount, seasonNumber: entry.seasonNumber,
    artist: entry.artist?.name, album: entry.album?.name, author: entry.author,
    ...(entry.show ? {show: {id: entry.show.id, title: entry.show.name}} : {}),
    ...(entry.kind !== 'episode' ? {} : {episode: entry.absoluteNumber !== undefined ? {mode: 'absolute' as const, number: entry.absoluteNumber}
      : entry.seasonNumber === 0 ? {mode: 'special' as const}
      : {mode: 'seasonal' as const, season: entry.seasonNumber, episode: entry.episodeNumber}}),
  };
}

export const homeCardText = (entry: ContentEntry, continuation: boolean, env: TextEnvironment) => cardText(homeSubject(entry), continuation ? 'continuation' : 'ordinary', env);
export function authorizedHome(document: HomeDocument | undefined, authority: ShellAuthority): HomeDocument | undefined {
  return document?.serverId === authority.serverId && document.viewerFence === authority.viewerFence ? document : undefined;
}

/** Platform eligibility is server-authored; Read is additionally hidden from the TV shell. */
export function platformRows(document: HomeDocument, platform: 'phone' | 'tv', readLibraryIds: ReadonlySet<string>): readonly HomeRow[] {
  return document.rows.filter(row => (!row.platforms || row.platforms.includes(platform)) && (platform !== 'tv' || !row.libraryId || !readLibraryIds.has(row.libraryId)));
}

export function pageAtVisibleEnd(row: HomeRow, last: number, preload = 3): boolean {
  const count = row.live?.channels.length ?? row.collection?.members.length ?? row.entries.length;
  return !!row.nextCursor && last >= Math.max(0, count - preload);
}

/** A continuation may be a show with an explicit server-selected episode target. */
export function homePlayTarget(row: HomeRow, entry: ContentEntry): ContentEntry | undefined {
  const target = row.resumes?.find(resume => resume.entryId === entry.id)?.target ?? entry;
  return target.playback && target.available !== false && !target.missing ? target : undefined;
}

export function initialHomeFocus(rows: readonly HomeRow[]): Readonly<{rowId: string; entryId: string}> | undefined {
  const row = rows.find(candidate => candidate.kind === 'continue' && candidate.entries.length) ?? rows.find(candidate => candidate.entries.length);
  return row && {rowId: row.id, entryId: row.entries[0].id};
}
