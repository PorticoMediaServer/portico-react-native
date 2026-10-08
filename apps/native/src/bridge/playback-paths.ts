import type {QueueController} from '../../../../packages/client-core/src/queue-controller';
import type {V1PlaybackApi} from '../../../../packages/client-core/src/playback-v1/legacy-bridge';

/**
 * The device's installed queue player (Playback Protocol v1). One is connected at a time: it
 * observes the one playback service, so two would both act on a completion. A downloaded title
 * (OS-07) has no queue, so the player goes while it plays and a fresh one is installed by the
 * next play from the server.
 */
export class PlaybackQueue {
  private active?: QueueController;
  /** OS-07: a downloaded title is playing; no queue is installed until the next server play. */
  private local = false;
  private readonly make: () => QueueController;
  constructor(make: () => QueueController) {
    this.make = make;
  }

  get controller(): QueueController | undefined { return this.active; }
  get playingLocal(): boolean { return this.local; }

  /** Installs `controller` (a relaunch's reopened queue). */
  install(controller: QueueController): void {
    this.local = false;
    if (this.active === controller) return;
    this.active?.dispose();
    this.active = controller;
    controller.connect();
  }

  /** Before a play from the server: a player is installed. */
  ensure(): QueueController {
    this.local = false;
    if (!this.active) this.install(this.make());
    return this.active!;
  }

  /** OS-07: before a downloaded title plays. It has no queue (no Up Next, no server completion). */
  goLocal(): void {
    this.active?.dispose();
    this.active = undefined;
    this.local = true;
  }

  dispose(): void {
    this.active?.dispose();
    this.active = undefined;
  }
}

/** Forwards the device's `session.updated` events to the v1 bridge, so a session the server ended
 * stops at once with its reason (`PlaybackSnapshot.ended`). Returns the unsubscribe. */
export function forwardSessionEnds(events: Readonly<{on(type: string, listener: (event: Readonly<{resource?: Readonly<{kind: string; id: string}>; data?: unknown}>) => void): () => void}>, v1: Pick<V1PlaybackApi, 'sessionUpdated'>): () => void {
  return events.on('session.updated', event => {
    if (event.resource?.kind === 'session' && event.resource.id) v1.sessionUpdated(event.resource.id, event.data);
  });
}
