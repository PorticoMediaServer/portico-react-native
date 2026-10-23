import type {Group} from '../../../../../packages/client-core/src/social-playback';
import type {ProfileOption} from '../../kit/artwork';

type ViewerFace = Pick<ProfileOption, 'id' | 'initial' | 'color' | 'source'>;
export type NativeTogetherLobbyFace = Readonly<{id: string; private: true}> | Readonly<{id: string; private: false; initial: string; color?: ProfileOption['color']; source?: ProfileOption['source']}>;

/** The illustrative friends in tv-more11 never become fixture participants.
 * A private member contributes no name/initial/art. Only the actual viewer-member
 * identity can borrow this selected profile's art; names are never identity joins. */
export function nativeTogetherLobbyFaces(group: Pick<Group, 'members' | 'viewerMemberId'> | undefined, viewer: ViewerFace): readonly NativeTogetherLobbyFace[] {
  const members = group?.members.filter(member => member.state === 'joined').slice(0, 3) ?? [];
  if (!members.length) return [{id: `profile:${viewer.id}`, private: false, initial: viewer.initial, color: viewer.color, source: viewer.source}];
  return members.map((member): NativeTogetherLobbyFace => member.private ? {id: member.id, private: true} : {
    id: member.id, private: false, initial: [...member.displayName.trim()][0] ?? '',
    ...(member.id === group?.viewerMemberId ? {color: viewer.color, source: viewer.source} : {}),
  });
}
