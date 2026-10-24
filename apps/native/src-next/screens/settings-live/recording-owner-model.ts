import {parseRecordingGrants, parseRecordingOwners, type RecordingGrant, type RecordingOwner, type RecordingOwnerChoice} from '../../../../../packages/client-core/src/server-admin/recording-policy';

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= max;
const signed = (v: unknown, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER): v is number => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const flag = (v: unknown): v is boolean => typeof v === 'boolean';
const oneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => typeof v === 'string' && (values as readonly string[]).includes(v);
function invalid(): never { throw new Error('invalid_response'); }
const body = (v: unknown, serverId: string): Record<string, any> => {
  if (!object(v) || v.serverId !== serverId || !object(v.result)) invalid();
  return v.result;
};
const result = (v: unknown, serverId: string): unknown => {
  if (!object(v) || v.serverId !== serverId || v.result === undefined) invalid();
  return v.result;
};

export type KeepPolicy = Readonly<{mode: 'keep-all' | 'keep-count' | 'keep-days'; keepCount: number; keepDays: number; keepUntilWatched: boolean}>;
export type DVRDefaults = Readonly<{
  prePaddingMs: number; postPaddingMs: number; keepPolicy: KeepPolicy;
  conversion: Readonly<{mode: string; ladderId: string; deleteOriginal: boolean}>;
  folderTemplate: string; movieFolderTemplate: string; recordingProfile: string;
  sidecars: Readonly<{nfo: boolean; poster: boolean; fanart: boolean; thumbnail: boolean}>;
  tunerPreference: string; liveTunerConflict: string;
}>;
export type DVRDocument = Readonly<{revision: number; settings: DVRDefaults; enumerations: Readonly<Record<string, readonly string[]>>}>;
const keep = (v: unknown): KeepPolicy => {
  if (!object(v) || !oneOf(v.mode, ['keep-all', 'keep-count', 'keep-days'] as const) || !count(v.keepCount, 1000) || !count(v.keepDays, 3650) || !flag(v.keepUntilWatched)) invalid();
  return Object.freeze({mode: v.mode, keepCount: v.keepCount, keepDays: v.keepDays, keepUntilWatched: v.keepUntilWatched});
};
const dvrDefaults = (v: unknown): DVRDefaults => {
  if (!object(v) || !count(v.prePaddingMs, 1800000) || !count(v.postPaddingMs, 7200000) || !object(v.conversion) || !text(v.conversion.mode, 64) || !text(v.conversion.ladderId ?? '', 128) || !flag(v.conversion.deleteOriginal)) invalid();
  if (!text(v.folderTemplate, 512) || !text(v.movieFolderTemplate, 512) || !text(v.recordingProfile, 64) || !object(v.sidecars) || !text(v.tunerPreference, 64) || !text(v.liveTunerConflict, 64)) invalid();
  if (!flag(v.sidecars.nfo) || !flag(v.sidecars.poster) || !flag(v.sidecars.fanart) || !flag(v.sidecars.thumbnail)) invalid();
  return Object.freeze({
    prePaddingMs: v.prePaddingMs, postPaddingMs: v.postPaddingMs, keepPolicy: keep(v.keepPolicy),
    conversion: Object.freeze({mode: v.conversion.mode, ladderId: v.conversion.ladderId ?? '', deleteOriginal: v.conversion.deleteOriginal}),
    folderTemplate: v.folderTemplate, movieFolderTemplate: v.movieFolderTemplate, recordingProfile: v.recordingProfile,
    sidecars: Object.freeze({nfo: v.sidecars.nfo, poster: v.sidecars.poster, fanart: v.sidecars.fanart, thumbnail: v.sidecars.thumbnail}),
    tunerPreference: v.tunerPreference, liveTunerConflict: v.liveTunerConflict,
  });
};
export function parseDVRDocument(v: unknown, serverId: string): DVRDocument {
  const value = body(v, serverId);
  if (!count(value.revision) || !object(value.settings)) invalid();
  const enumerations: Record<string, readonly string[]> = {};
  if (object(value.enumerations)) for (const [key, list] of Object.entries(value.enumerations)) if (Array.isArray(list) && list.every(item => text(item, 64))) enumerations[key] = Object.freeze([...list]) as readonly string[];
  return Object.freeze({revision: value.revision, settings: dvrDefaults(value.settings), enumerations: Object.freeze(enumerations)});
}

export type TunerAssignment = Readonly<{kind: string; accountName: string; profileName: string; recordingId: string; title: string; state: string; startsAt: string; endsAt: string}>;
export type TunerAllocation = Readonly<{sourceId: string; sourceName: string; tunerCount: number; inUse: number; conflicts: number; active: readonly TunerAssignment[]; upcoming: readonly TunerAssignment[]}>;
export type TunerView = Readonly<{sources: readonly TunerAllocation[]; observedAt: string; upcomingWindowHours: number}>;
const assignment = (v: unknown): TunerAssignment => {
  if (!object(v) || !text(v.kind, 32) || !text(v.accountName ?? '', 256) || !text(v.profileName ?? '', 256) || !text(v.recordingId ?? '', 64) || !text(v.title, 512) || !text(v.state, 32) || !text(v.startsAt ?? '', 64) || !text(v.endsAt ?? '', 64)) invalid();
  return Object.freeze({kind: v.kind, accountName: v.accountName ?? '', profileName: v.profileName ?? '', recordingId: v.recordingId ?? '', title: v.title, state: v.state, startsAt: v.startsAt ?? '', endsAt: v.endsAt ?? ''});
};
export function parseTunerView(v: unknown, serverId: string): TunerView {
  const value = body(v, serverId);
  if (!Array.isArray(value.sources) || !text(value.observedAt ?? '', 64) || !count(value.upcomingWindowHours, 72)) invalid();
  return Object.freeze({observedAt: value.observedAt ?? '', upcomingWindowHours: value.upcomingWindowHours, sources: Object.freeze(value.sources.map(raw => {
    if (!object(raw) || !text(raw.sourceId, 64) || !text(raw.sourceName, 512) || !count(raw.tunerCount, 256) || !count(raw.inUse, 256) || !count(raw.conflicts, 256) || !Array.isArray(raw.active) || !Array.isArray(raw.upcoming)) invalid();
    return Object.freeze({sourceId: raw.sourceId, sourceName: raw.sourceName, tunerCount: raw.tunerCount, inUse: raw.inUse, conflicts: raw.conflicts, active: Object.freeze(raw.active.map(assignment)), upcoming: Object.freeze(raw.upcoming.map(assignment))});
  }))});
}

/** A standing series rule as the administration document names it. */
export type AdminRuleOptions = Readonly<{prePaddingMs: number | null; postPaddingMs: number | null; keepPolicy: KeepPolicy | null; newEpisodesOnly: boolean; priority: number; folderTemplate: string}>;
export type AdminRule = Readonly<{
  id: string; revision: number; owner: RecordingOwner; anchor?: Readonly<{sourceId: string; channelId: string; generation: string; programmeId: string}>;
  status: string; kind: string; name: string; match: string; sourceId: string; enabled: boolean; options: AdminRuleOptions;
}>;
export function parseAdminRules(v: unknown, serverId: string): readonly AdminRule[] {
  const value = body(v, serverId);
  if (!Array.isArray(value.items)) invalid();
  return Object.freeze(value.items.map(raw => {
    if (!object(raw) || !text(raw.id, 64) || !count(raw.revision) || !object(raw.owner) || !oneOf(raw.owner.authority, ['local', 'hosted'] as const) || !text(raw.owner.accountId, 64) || !text(raw.owner.profileId, 64)) invalid();
    if (!text(raw.status ?? '', 64) || !oneOf(raw.kind, ['series', 'keyword'] as const) || !text(raw.name, 512) || !text(raw.match, 512) || !text(raw.sourceId, 512) || !flag(raw.enabled) || !object(raw.options) || !signed(raw.options.priority, -1000, 1000) || !flag(raw.options.newEpisodesOnly) || !text(raw.options.folderTemplate ?? '', 512)) invalid();
    const pre = raw.options.prePaddingMs === null ? null : count(raw.options.prePaddingMs, 21600) ? raw.options.prePaddingMs : invalid();
    const post = raw.options.postPaddingMs === null ? null : count(raw.options.postPaddingMs, 21600) ? raw.options.postPaddingMs : invalid();
    return Object.freeze({
      id: raw.id, revision: raw.revision, owner: Object.freeze({authority: raw.owner.authority as RecordingOwner['authority'], accountId: raw.owner.accountId, profileId: raw.owner.profileId}),
      ...(object(raw.anchor) && text(raw.anchor.programmeId, 512) ? {anchor: Object.freeze({sourceId: text(raw.anchor.sourceId, 512) ? raw.anchor.sourceId : '', channelId: text(raw.anchor.channelId, 64) ? raw.anchor.channelId : '', generation: text(raw.anchor.generation, 128) ? raw.anchor.generation : '', programmeId: raw.anchor.programmeId})} : {}),
      status: raw.status ?? '', kind: raw.kind, name: raw.name, match: raw.match, sourceId: raw.sourceId, enabled: raw.enabled,
      options: Object.freeze({prePaddingMs: pre, postPaddingMs: post, keepPolicy: raw.options.keepPolicy ? keep(raw.options.keepPolicy) : null, newEpisodesOnly: raw.options.newEpisodesOnly, priority: raw.options.priority, folderTemplate: raw.options.folderTemplate ?? ''}),
    });
  }));
}

export type RecordingPolicy = Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>;
export function parseRecordingPolicy(owners: unknown, grants: unknown, serverId: string): RecordingPolicy {
  return Object.freeze({owners: Object.freeze(parseRecordingOwners(result(owners, serverId)).items), grants: Object.freeze(parseRecordingGrants(result(grants, serverId)))});
}
