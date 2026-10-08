/**
 * X-13 (client): which failure view a failed connect gets. A stale offline
 * server gets the specific "can't reach" dialog; anything else keeps the
 * generic waiting notice (a server seen within the hour keeps the keep-trying
 * copy). Pure, no React Native imports: tested under Node. Mirrors web
 * `HostedChooser.chooserFailureView`, mapping Apple's `PorticoFailure` kind
 * instead of the web `PorticoOutcome`.
 */
import {needsOfflineServerDialog, type ServerPresence} from '../../../../../packages/client-core/src/index';

export type ChooserFailureView = 'offline-dialog' | 'waiting' | 'other';

export function chooserFailureView(presence: ServerPresence | undefined, unreachable: boolean, nowMs: number = Date.now()): ChooserFailureView {
  if (!unreachable) return 'other';
  return needsOfflineServerDialog(presence, true, nowMs) ? 'offline-dialog' : 'waiting';
}
