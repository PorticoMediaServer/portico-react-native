import type {LibraryChannel, LibraryChannelPreview} from '../../../../../../../packages/client-core/src/library-channels';
import {defaultI18n, type MessageId} from '../../../../../../../packages/i18n/src';

/** Unknown states and server health problems must never be presented as on air. */
export function channelStatus(channel: Pick<LibraryChannel, 'state' | 'healthCode'>): Readonly<{label: MessageId; tone: 'healthy' | 'warning' | 'neutral'}> {
  const state = !channel.healthCode && ['ready', 'generating', 'stale', 'disabled', 'degraded'].includes(channel.state) ? channel.state : 'degraded';
  return {label: `server.channels.state.${state}` as MessageId, tone: state === 'ready' ? 'healthy' : state === 'disabled' ? 'neutral' : 'warning'};
}
export function previewMatches(eligible: number, complete: boolean, t: typeof defaultI18n.t): string {
  return complete ? t('builder.matches', {count: eligible}) : `At least ${defaultI18n.number(eligible)} ${eligible === 1 ? 'title matches' : 'titles match'}`;
}
export function previewDuration(preview: Pick<LibraryChannelPreview, 'durationMs' | 'complete' | 'rules'>): string {
  return `${preview.complete && preview.rules.every(rule => rule.complete) ? '≈' : '≥'} ${defaultI18n.number(preview.durationMs / 3600000, {minimumFractionDigits: 1, maximumFractionDigits: 1})} h`;
}
