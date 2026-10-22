import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {HomeChannel, HomeCollection} from '../../../../packages/client-core/src/home';
import {authorityKey, type ShellAuthority, type ShellDestination} from './model';

/** Public verification contract. Identity comes from the authority fence and real entities. */
export function tvFocusIds(authority: ShellAuthority) {
  const prefix = `tv.${authorityKey(authority)}`;
  const spotlight = `${prefix}.home.spotlight`, customize = `${prefix}.home.customize`, rail = `${prefix}.rail`;
  return {
    spotlight, customize, rail,
    row: (rowId: string) => `${prefix}.home.row.${JSON.stringify(rowId)}`,
    entry: (entry: Pick<ContentEntry, 'kind' | 'libraryId' | 'id'>) => JSON.stringify([entry.kind, entry.libraryId, entry.id]),
    channel: (channel: HomeChannel) => JSON.stringify(['channel', channel.channel.sourceId, channel.channel.id]),
    collection: (collection: HomeCollection) => JSON.stringify(['collection', collection.collection.libraryId, collection.collection.id]),
    destination: tvRailDestinationId,
    profile: `profile:${authority.profileId}`,
    start: {regionId: spotlight, childId: 'play'},
    last: {regionId: customize, childId: 'customize'},
  };
}

export function tvRailDestinationId(destination: ShellDestination): string {
  return destination.kind === 'library' ? `library:${destination.libraryId}` : destination.kind;
}

export function sameDestination(a: ShellDestination, b: ShellDestination): boolean {
  return tvRailDestinationId(a) === tvRailDestinationId(b);
}
