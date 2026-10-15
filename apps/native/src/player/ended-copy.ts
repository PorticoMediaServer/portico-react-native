import type {I18n} from '../../../../packages/i18n/src/index';
import {sessionEndMessage} from '../../../../packages/client-core/src/session-end';

/**
 * What the player says when the server ended the session (`PlaybackSnapshot.ended`), in web's
 * words: the server owner's stop with their message when they wrote one, otherwise the reason's
 * fixed text. `short` is the one line the mini bar and the TV pill have room for.
 */
export function endedCopy(ended: Readonly<{reason: string; message?: string}>, t: I18n['t']): {title: string; message?: string; short: string} {
  if (ended.reason === 'terminated') {
    const written = ended.message ? sessionEndMessage(ended) : '';
    const fallback = sessionEndMessage({reason: 'terminated'});
    return {
      title: t('web.player.ownerStopped'),
      ...(written && written !== fallback ? {message: t('web.player.ownerStopped.message', {message: written})} : {}),
      short: t('web.player.ownerStopped.short'),
    };
  }
  if (ended.reason === 'tuner_reserved') {
    // A recording took this channel's tuner (the owner's "Stop watching" setting).
    return {title: t('live.handover.stoppedTitle'), message: t('live.handover.stopped'), short: t('live.handover.stoppedTitle')};
  }
  const text = sessionEndMessage(ended);
  return {title: t('error.title.load', {subject: 'playback'}), message: text, short: text};
}
