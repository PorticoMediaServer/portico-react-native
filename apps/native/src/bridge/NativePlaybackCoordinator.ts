import type {
  PlaybackService,
  PlaybackSnapshot,
} from '../../../../packages/client-core/src/index';
import {isLocalSource} from './local-playback';
export type NativeLease = Readonly<{ lease: string; instanceId: string }>;
export type NativeBinding = Readonly<{
  lease: string;
  intentId: number;
  sessionId: string;
  generation: number;
  itemId: string;
}>;
export interface NativePlaybackTransport {
  acquire(owner: string): Promise<NativeLease>;
  command(value: Record<string, unknown>): Promise<unknown>;
  release(lease: string): Promise<unknown>;
  subscribe(listener: (fact: any) => void): () => void;
}
const key = (b: NativeBinding) =>
  JSON.stringify([b.lease, b.intentId, b.sessionId, b.generation, b.itemId]);
/** Sole RN command adapter. Construction is inert; view lifetime is unrelated to this lease. */
export class NativePlaybackCoordinator {
  private active = false;
  private listeningOwner:string|undefined;
  private lifecycle = 0;
  private lease: NativeLease | null = null;
  private binding: NativeBinding | null = null;
  private acquiring = false;
  private commandRevision = 0;
  private factSequence = 0;
  private lastSemantic = '';
  private barrier = 0;
  private rate = 1;
  private audio: unknown = null;
  private subtitles: unknown = null;
  private routeReady=true;
  private routeRevision=0;
  private routeSource='';
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  private unsubscribeFacts?: () => void;
  private queued = false;
  private service: PlaybackService;
  private transport: NativePlaybackTransport;
  private ownerId: () => string;
  private source: (snapshot: PlaybackSnapshot) => string;
  private accept: (fact: any) => void;
  constructor(
    service: PlaybackService,
    transport: NativePlaybackTransport,
    ownerId: () => string,
    source: (snapshot: PlaybackSnapshot) => string,
    accept: (fact: any) => void,
  ) {
    this.service = service;
    this.transport = transport;
    this.ownerId = ownerId;
    this.source = source;
    this.accept = accept;
  }
  getSnapshot = () => this.lease?.lease ?? '';
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  private publish() {
    this.listeners.forEach(f => f());
  }
  start() {
    if (this.active) return;
    this.active = true;
    this.lifecycle++;
    this.unsubscribe = this.service.subscribe(this.schedule);
    this.unsubscribeFacts = this.transport.subscribe(this.fact);
    this.schedule();
  }
  stop() {
    if (!this.active) return;
    this.active = false;
    this.lifecycle++;
    this.queued = false;
    this.unsubscribe?.();
    this.unsubscribeFacts?.();
    this.release();
  }
  /** OS-07: a downloaded file on this device plays whatever the server route is doing. */
  /** What a start is waiting on (PlaybackService.setStartupProbe; development builds log it). */
  diagnostics():Readonly<Record<string,unknown>>{
    const s=this.service.getSnapshot();
    return {active:this.active,routeReady:this.routeReady,connected:this.connected(),routeSource:!!this.routeSource,leaseAcquired:!!this.lease,acquiring:this.acquiring,commandSent:this.lastSemantic!=='',commandRevision:this.commandRevision,factSequence:this.factSequence,boundSession:this.binding?.sessionId??null,snapshotSession:s.session?.id??null,nativeListening:!!s.nativeListening};
  }
  private connected():boolean{return this.routeReady||isLocalSource(this.service.getSnapshot().session?.streamUrl);}
  setConnection(ready:boolean) {
    if(this.routeReady===ready)return;
    this.routeReady=ready;this.routeRevision++;
    // Fence queued facts immediately, not only after the next native command.
    // A route change preserves the item/lease, so binding identity alone cannot
    // distinguish progress/end/error emitted by the superseded AVPlayerItem.
    this.barrier=this.commandRevision+1;
    this.schedule();
  }
  setOptions(rate: number, audio: unknown, subtitles: unknown = null) {
    this.rate = rate;
    this.audio = audio;
    this.subtitles = subtitles;
    this.schedule();
  }
  private release() {
    const lease = this.lease;
    this.lease = null;
    this.binding = null;
    this.lastSemantic = '';
    this.routeSource='';
    this.acquiring = false;
    this.publish();
    if (lease) {
      const state = this.service.getSnapshot();
      this.service.engineLost(state.intentId);
      void this.transport.release(lease.lease).catch(() => {});
    }
  }
  private schedule = () => {
    if (!this.active || this.queued) return;
    this.queued = true;
    const life = this.lifecycle;
    queueMicrotask(() => {
      if (!this.active || life !== this.lifecycle) return;
      this.queued = false;
      this.sync();
    });
  };
  private sync() {
    const state = this.service.getSnapshot();
    if (!state.session || !state.itemId) {
      if (this.lease) this.release();
      return;
    }
    if (!this.lease) {
      if (state.phase === 'error'||!this.connected()) return;
      if (!this.acquiring) void this.acquire();
      return;
    }
    const listening=state.nativeListening;
    if(listening&&this.listeningOwner!==listening.owner){
      if(this.listeningOwner&&this.lease){this.listeningOwner=listening.owner;this.release();this.schedule();return;}
      this.listeningOwner=listening.owner;
    // The native owner alone says a session is native.
    }else if(!listening){
      // The owner took the player's lease with it when it retired: what plays next takes a fresh one.
      if(this.listeningOwner&&this.lease){this.listeningOwner=undefined;this.release();this.schedule();return;}
      this.listeningOwner=undefined;
    }
    if(listening)this.commandRevision=Math.max(this.commandRevision,listening.commandRevision);
    const binding: NativeBinding = {
      lease: this.lease.lease,
      intentId: state.intentId,
      sessionId: state.session.id,
      generation: state.session.generation,
      itemId: state.itemId,
    };
    const audioBinding = (this.audio as any)?.binding;
    const audio =
      audioBinding &&
      audioBinding.intentId === binding.intentId &&
      audioBinding.sessionId === binding.sessionId &&
      audioBinding.generation === binding.generation
        ? this.audio
        : null;
    const subtitleBinding=(this.subtitles as any)?.binding;
    const subtitles=subtitleBinding && subtitleBinding.intentId===binding.intentId && subtitleBinding.sessionId===binding.sessionId && subtitleBinding.generation===binding.generation ? this.subtitles : null;
    const candidate=this.connected()?this.source(state):'';
    if(candidate)this.routeSource=candidate;
    if(!this.routeSource)return;
    const semantic = {
      binding,
      listeningOwner:listening?.owner??null,
      source: this.routeSource,
      connectionState:this.connected()?'ready':'verifying',
      routeRevision:this.routeRevision,
      paused:
        !this.connected() || state.intent === 'paused' ||
        state.phase === 'error' ||
        state.phase === 'ended' ||
        !!state.failedSeek || !!state.seekError,
      rate: state.channel?1:this.rate,
      timelineOriginMs:state.linear?.media.originMs??null,
      pendingSeek: listening?null:state.pendingSeek ?? null,
      audio,
      audioRender: null,
      subtitles,
    };
    const encoded = JSON.stringify(semantic);
    if (encoded === this.lastSemantic) return;
    this.lastSemantic = encoded;
    this.binding = binding;
    const revision = ++this.commandRevision;
    // Reject a progress event queued before the command that introduced or settled a seek.
    if (state.pendingSeek || state.failedSeek) this.barrier = revision;
    void this.transport
      .command({ ...semantic, commandRevision: revision })
      .catch(() => {
        if (
          this.active &&
          this.binding &&
          key(this.binding) === key(binding) &&
          this.commandRevision === revision
        )
          this.service.fail(
            binding.intentId,
            'The player could not accept a control change. Close playback and try again.',
          );
      });
  }
  private async acquire() {
    this.acquiring = true;
    const life = this.lifecycle,
      intent = this.service.getSnapshot().intentId;
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      if (this.active && life === this.lifecycle) {
        this.acquiring = false;
        this.service.fail(
          intent,
          'The player could not attach. Close playback and try again.',
        );
      }
    }, 5000);
    try {
      const lease = await this.transport.acquire(this.ownerId());
      if (
        expired ||
        !this.active ||
        life !== this.lifecycle ||
        !this.service.getSnapshot().session ||
        intent !== this.service.getSnapshot().intentId
      ) {
        await this.transport.release(lease.lease);
        return;
      }
      this.lease = lease;
      this.commandRevision = 0;
      this.factSequence = 0;
      this.barrier = 0;
      this.lastSemantic = '';
      this.publish();
      this.schedule();
    } catch {
      if (this.active && life === this.lifecycle)
        this.service.fail(
          intent,
          'The player could not attach. Close playback and try again.',
        );
    } finally {
      clearTimeout(timer);
      if (life === this.lifecycle) {
        this.acquiring = false;
        this.schedule();
      }
    }
  }
  private fact = (f: any) => {
    const native=!!this.service.getSnapshot().nativeListening;
    if(native&&!(typeof f?.type==='string'&&(['audioMapped','audioObserved','audioApplied','audioFailed','subtitleStatus'].includes(f.type))))return;
    if (
      !this.active || !this.connected() ||
      !this.lease ||
      !this.binding ||
      !f?.binding ||
      f.instanceId !== this.lease.instanceId ||
      key(f.binding) !== key(this.binding) ||
      f.binding.sessionId !== this.service.getSnapshot().session?.id ||
      f.binding.generation !== this.service.getSnapshot().session?.generation ||
      !Number.isSafeInteger(f.factSequence) ||
      f.factSequence <= this.factSequence
    )
      return;
    if (!native&&(
      !Number.isSafeInteger(f.lastCommandRevision) ||
      f.lastCommandRevision < this.barrier ||
      f.lastCommandRevision > this.commandRevision
    ))
      return;
    this.factSequence = f.factSequence;
    if (f.type === 'progress' || f.type === 'ended') {
      const state = this.service.getSnapshot();
      if (f.seeking || state.pendingSeek || state.failedSeek) return;
    }
    if(f.type==='audioPrepared'){this.service.audioPrepared(f.token);return;}
    if(f.type==='audioCommit'){this.service.audioCommit(f.token);return;}
    if(f.type==='audioBoundary'){this.service.audioBoundary(f.token,f.position);return;}
    if(f.type==='audioPreparationFailed'){this.service.audioPreparationFailed('The next item could not be buffered. This edge will use ordinary playback.');return;}
    if(f.type==='audioRenderFailed'){this.service.audioRenderFailed('Audio decoding or output failed. Retry playback to reconnect.');return;}
    this.accept(f);
  };
}
