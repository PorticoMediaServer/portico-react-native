import type {Group, GroupMember, GroupTimeline} from '../../../../packages/client-core/src/social-playback';
import type {MessageId, MessageValues} from '../../../../packages/i18n/src/index';

/**
 * Watch Together in words, and the two small rules the room screen needs about who may take the
 * host's place. No React and no native code: tested under Node.
 */
type Translate = (id: MessageId, values?: MessageValues) => string;

/** A group's state as its badge says it. While the group holds for everyone after a seek or a new title, it says it is waiting. */
export function groupStateLabel(t: Translate, state: Group['state']): string {
  switch (state) {
    case 'lobby': case 'creating': return t('web.together.state.lobby');
    case 'preparing': return t('web.together.state.preparing');
    case 'waiting': return t('web.together.state.waiting');
    case 'ready': return t('web.together.state.ready');
    case 'playing': case 'degraded': return t('web.together.state.playing');
    case 'paused': return t('web.downloads.state.paused');
    case 'host-reconnecting-playing': case 'host-reconnecting-paused': return t('web.together.state.hostReconnecting');
    case 'ending': return t('web.together.state.ending');
    default: return t('web.together.state.ended');
  }
}

export function groupEndedReason(t: Translate, reason: string): string {
  return reason === 'host-ended' ? t('web.together.ended.host') : reason === 'host-unavailable' ? t('web.together.ended.away') : reason === 'empty' ? t('web.together.ended.empty') : t('web.together.ended.other');
}

/** "Everyone is ready." or "2 of 3 ready · waiting for one person". */
export function readinessLine(t: Translate, readiness: Group['readiness']): string {
  if (readiness.aggregate === 'ready') return readiness.memberCount > 1 ? t('web.together.allReady') : t('web.together.state.ready');
  return t('web.together.waiting', {ready: readiness.ready, total: readiness.memberCount, count: readiness.buffering + readiness.lagging + readiness.stale});
}

export function memberStatus(t: Translate, member: Pick<GroupMember, 'presence' | 'readiness'>): string {
  return member.presence !== 'connected' ? t('web.together.away') : member.readiness === 'ready' ? t('web.together.inStep') : member.readiness === 'buffering' ? t('web.together.loading') : t('web.together.catchingUp');
}

/** Someone who keeps their activity private is in the room and counted, without a name. */
export function memberName(t: Translate, member: Pick<GroupMember, 'private' | 'displayName'>): string {
  return member.private ? t('together.privateViewer') : member.displayName;
}

/**
 * What the group is on. A title this viewer may not see arrives without its id but with the place
 * it holds in the queue: that is "a title that isn't in your libraries", never "nothing chosen".
 */
export function currentTitle(timeline: Pick<GroupTimeline, 'itemId' | 'currentEntryId'>): 'none' | 'hidden' | 'chosen' {
  return timeline.itemId ? 'chosen' : timeline.currentEntryId ? 'hidden' : 'none';
}

/** Someone the host role can go to: in the room, connected, and in step with the group right now. */
export function mayBeMadeHost(member: Pick<GroupMember, 'state' | 'presence' | 'readiness' | 'role'>): boolean {
  return member.role !== 'host' && member.state === 'joined' && member.presence === 'connected' && member.readiness === 'ready';
}

/**
 * Whether this member may take the host's place: only once the host has been silent for the
 * whole wait the server gives (`host.pauseAt`, two minutes after it was last seen), and only for
 * someone the role can go to. Before that the server refuses the claim.
 */
export function mayClaimHost(group: Pick<Group, 'host' | 'permissions'>, me: Pick<GroupMember, 'state' | 'presence' | 'readiness' | 'role'> | undefined, serverNow: number): boolean {
  if (!me || group.permissions.isHost || group.host.presence === 'connected' || !mayBeMadeHost(me)) return false;
  const due = group.host.pauseAt ? Date.parse(group.host.pauseAt) : NaN;
  return Number.isFinite(due) && due <= serverNow;
}
