import {serviceText} from '../../../../packages/client-core/src/presentation/service-text';
import type {AudioBinding, PlaybackService} from '../../../../packages/client-core/src/index';
const bindingKey=(b:AudioBinding)=>JSON.stringify([b.intentId,b.sessionId,b.generation,b.sourceId,b.planRevision]);
export type NativeAudioCommand = Readonly<{
  binding: AudioBinding;
  epoch: number;
  renditions: readonly Readonly<{id: string; name: string}>[];
  defaultRenditionId: string;
  pending: Readonly<{revision: number; renditionId: string}> | null;
}>;
/** Per-service bridge coordinator; shared PlaybackService remains the command/fact owner. */
export class NativeAudioSelection {
  private value: NativeAudioCommand | null = null;
  private binding: AudioBinding | null = null;
  private epoch: number | null = null;
  private key = '';
  private queued = false;
  private disposed = false;
  private started = false;
  private lifecycle = 0;
  private listeners = new Set<() => void>();
  private unsubscribe?: () => void;
  constructor(private service: PlaybackService) {}
  start() {
    if(this.disposed||this.started)return;
    this.started=true;this.lifecycle++;this.unsubscribe=this.service.subscribe(this.schedule);this.schedule();
  }
  stop() {
    if(!this.started)return;
    this.started=false;this.lifecycle++;this.queued=false;this.unsubscribe?.();this.unsubscribe=undefined;
    if(this.binding&&this.epoch!==null)this.service.detachAudioEngine(this.binding,this.epoch);
    this.binding=null;this.epoch=null;this.key='';this.value=null;
  }
  getSnapshot = () => this.value;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private schedule = () => {
    if (this.disposed || !this.started || this.queued) return;
    this.queued = true;
    const lifecycle=this.lifecycle;
    queueMicrotask(() => {if(lifecycle!==this.lifecycle)return;this.queued = false;if (!this.disposed&&this.started) this.sync();});
  };
  private sync() {
    const {audio} = this.service.getSnapshot();
    const key = audio.binding ? bindingKey(audio.binding) : '';
    if (key !== this.key) {
      const old = this.binding, epoch = this.epoch;
      this.key = key; this.binding = audio.binding; this.epoch = null;
      if (old && epoch !== null) this.service.detachAudioEngine(old, epoch);
      // attach publishes synchronously. The key is installed first; emission waits for the returned epoch.
      if (this.binding) this.epoch = this.service.attachAudioEngine(this.binding);
    }
    const current = this.service.getSnapshot().audio;
    const next = this.binding && this.epoch !== null && current.plan && current.binding && bindingKey(current.binding) === this.key
      ? {binding: this.binding, epoch: this.epoch, defaultRenditionId:current.plan.defaultRenditionId, renditions: current.plan.renditions.map(r => ({id: r.id, name: r.manifestIdentity.name})), pending: current.pending ?? null}
      : null;
    if (JSON.stringify(next) === JSON.stringify(this.value)) return;
    this.value = next; for (const listener of this.listeners) listener();
  }
  acceptFact(f: any): boolean {
    if (typeof f?.type !== 'string' || !f.type.startsWith('audio')) return false;
    if (this.disposed || !this.started || !this.binding || this.epoch === null || f.audioEpoch !== this.epoch || (!f.audioBinding || bindingKey(f.audioBinding) !== this.key)) return true;
    const b = this.binding, e = this.epoch;
    if (f.type === 'audioMapped') this.service.audioMapped(b, e, Array.isArray(f.renditionIds) ? f.renditionIds : []);
    else if (f.type === 'audioObserved') this.service.audioObserved(b, e, f.audioSequence, typeof f.renditionId === 'string' ? f.renditionId : null);
    else if (f.type === 'audioApplied') this.service.audioApplied(b, e, f.audioRevision, f.renditionId);
    else if (f.type === 'audioUnavailable' && typeof f.renditionId==='string') this.service.audioRenditionUnavailable(b,e,f.renditionId);
    else if (f.type === 'audioFailed') this.service.audioFailed(b, e, f.audioRevision, serviceText('player.opt.audioChangeFailed'));
    return true;
  }
  retryMapping() {
    if(this.disposed || !this.started || !this.binding || this.epoch===null)return;
    const b=this.binding,e=this.epoch;
    this.epoch=null;this.service.detachAudioEngine(b,e);
    this.epoch=this.service.attachAudioEngine(b);this.schedule();
  }
  dispose() {
    if (this.disposed) return;
    this.stop();this.disposed = true;
    this.listeners.clear();this.value = null;
  }
}
