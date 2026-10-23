import type { PlaybackService } from '../../../../packages/client-core/src/index';
import {serviceText} from '../../../../packages/client-core/src/presentation/service-text';
import {nativeRateError} from '../../src-next/platform/playback/native-messages';
import {audiobookRates} from '../../../../packages/client-core/src/listening';
export const playbackRates = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
/** The Speed menu for what is playing: audiobooks go to 3×, as on web; video stays at 2×. */
export const ratesFor = (kind: string | undefined): readonly number[] => (kind === 'audiobook_file' ? audiobookRates : playbackRates);
export type SpeedSnapshot = Readonly<{
  desired: number;
  effective: number;
  supported: readonly number[];
  ready: boolean;
  waiting: boolean;
  error?: string;
}>;
// Device adapter state belongs to this service lifetime, not a saved preference.
export class NativePlaybackSpeed {
  private service?:PlaybackService;
  constructor(service?:PlaybackService){this.service=service;}
  private state: SpeedSnapshot = { desired: 1, effective: 0, supported: [], ready: false, waiting: false };
  private listeners = new Set<() => void>();
  private intentId?: number;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: SpeedSnapshot) {
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = Object.freeze(next); this.listeners.forEach(listener => listener());
  }
  // A saved preference is a requested rate. The native facts still decide
  // supported/effective rate; this does not pretend a paused player is playing.
  prefer = (rate:number) => {
    if(!(audiobookRates as readonly number[]).includes(rate))return;
    if(this.state.ready&&!this.state.supported.includes(rate)){this.publish({...this.state,desired:1,error:serviceText('player.opt.speedUnsupported')});return;}
    this.publish({...this.state,desired:rate,error:undefined});
  };
  select = (rate: number) => {
    if (!this.state.ready || !this.state.supported.includes(rate)) return;
    this.service?.setPlaybackRate(rate);
    this.publish({ ...this.state, desired: rate, error: undefined });
  };
  observe(fact: { intentId: number; effectiveRate?: number; supportedRates?: number[]; rateReady?: boolean; rateWaiting?: boolean; rateError?: string }) {
    if (typeof fact.effectiveRate !== 'number') return;
    this.intentId = fact.intentId;
    this.publish({ ...this.state, effective: fact.effectiveRate, supported: Object.freeze(fact.supportedRates ?? []), ready: !!fact.rateReady, waiting: !!fact.rateWaiting, error: nativeRateError(fact.rateError) });
  }
  reconcileNative(event:{rate:number;effectiveRate?:number;supportedRates?:readonly number[];ready:boolean;rateWaiting?:boolean;rateError?:string}) {
    this.publish({desired:event.rate,effective:event.effectiveRate??0,supported:event.supportedRates??[],ready:event.ready,waiting:!!event.rateWaiting,error:nativeRateError(event.rateError)});
  }
  invalidate(intentId: number) {
    if (this.intentId === intentId) return;
    this.intentId = intentId;
    this.publish({ ...this.state, effective: 0, supported: [], ready: false, waiting: false, error: undefined });
  }
}
const speeds = new WeakMap<PlaybackService, NativePlaybackSpeed>();
export function speedFor(service: PlaybackService) {
  let speed = speeds.get(service);
  if (!speed) { speed = new NativePlaybackSpeed(service); speeds.set(service, speed); }
  return speed;
}
