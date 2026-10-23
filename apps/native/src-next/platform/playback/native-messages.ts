import {serviceText} from '../../../../../packages/client-core/src/presentation/service-text';
import type {MessageId} from '../../../../../packages/i18n/src/index';

// Native engines report facts and diagnostic codes. Product copy is resolved
// here, on the same catalogue as the shell, before it enters a UI snapshot.
const messages: Readonly<Record<string, MessageId>> = Object.freeze({
  playback_failed: 'queuePlayer.startFailed',
  playback_reconnecting: 'player.reconnecting',
  playback_confirmation_expired: 'playback.message.lease_expired',
  audio_render_failed: 'queuePlayer.startFailed',
  media_unavailable: 'queuePlayer.unsupported',
  seek_unavailable: 'playback.message.seek_mismatch',
  rate_unavailable: 'player.opt.speedUnsupported',
  listening_storage_unavailable: 'player.nativeHandoverFailed',
  listening_authorization_invalid: 'playback.message.unauthorized',
  listening_reconnecting: 'player.reconnecting',
  listening_lease_expired: 'playback.message.lease_expired',
  listening_change_rejected: 'queuePlayer.changeFailed',
  listening_queue_changed: 'queuePlayer.changeFailed',
  listening_queue_unavailable: 'queuePlayer.notFound',
  listening_queue_advance_failed: 'queuePlayer.moveFailed',
  listening_next_failed: 'queuePlayer.startFailed',
  listening_ended: 'error.sessionEnded',
});

/** Unknown engine text is diagnostic, including text from a different native host. */
export function nativePlaybackMessage(code: unknown, fallback: MessageId = 'queuePlayer.startFailed'): string {
  const key = typeof code === 'string' && Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : fallback;
  return serviceText(key);
}

export function nativeRateError(code: string | undefined): string | undefined {
  return code ? serviceText('player.opt.speedUnsupported') : undefined;
}
