import {defaultI18n, type MessageId} from '../../../../packages/i18n/src';
import type {HomeSelectionMember} from '../../../../packages/client-core/src/home-selection/index';
import type {RepairFieldSpec} from '../../../../packages/client-core/src/metadata-repair';
import {homeCardText} from '../screens/home/model';
import type {NativeShellRuntime} from './runtime';

export function memberTitle(member: HomeSelectionMember, runtime: NativeShellRuntime): string | undefined {
  return member.entry ? homeCardText(member.entry, false, runtime.text).title : member.collection?.collection.name ?? member.channel?.channel.name;
}

/** Server fields require real catalogue labels; an unknown schema is never displayed as an id. */
export function metadataFieldLabel(field: RepairFieldSpec): string {
  const key = field.field === 'genres' ? 'web.metadata.genres' : field.field === 'metadataLanguage' ? 'web.libraries.metadataLanguage' : `web.metadata.field.${field.field}`;
  if (!defaultI18n.has(key)) throw new Error('metadata_field_copy_required');
  return defaultI18n.t(key as MessageId);
}
