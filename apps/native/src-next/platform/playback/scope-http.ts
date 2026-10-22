import type {V1Http, V1Request} from '../../../../../packages/client-core/src/playback-v1/http';

/** Cancels the previous principal's work and refuses both late responses and new sends. */
export class PlaybackScopeHttp implements V1Http {
  private closed = false;
  private controllers = new Set<AbortController>();
  private inner: V1Http;
  private current: () => boolean;
  constructor(inner: V1Http, current: () => boolean) { this.inner = inner; this.current = current; }
  send = async (request: V1Request) => {
    if (this.closed || !this.current()) throw new Error('Playback authority retired.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.signal?.addEventListener('abort', abort, {once: true});
    if (request.signal?.aborted) controller.abort();
    this.controllers.add(controller);
    try {
      const response = await this.inner.send({...request, signal: controller.signal});
      if (this.closed || !this.current() || controller.signal.aborted) throw new Error('Playback authority retired.');
      return response;
    } finally { request.signal?.removeEventListener('abort', abort); this.controllers.delete(controller); }
  };
  dispose(): void {
    this.closed = true;
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }
}
