import type {NativePlaybackAdapter} from '../../platform/playback/types';
import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import type {NativeWatchCapture} from './factory';
import type {nativeVersionChoices} from './version-options';

type Ports = Readonly<{
  capture: NativeWatchCapture;
  options: PlaybackOptions;
  rows: ReturnType<typeof nativeVersionChoices>;
  selectedVersionId?: string;
  hostCurrent: () => boolean;
  sourceCurrent: () => boolean;
  start: NativePlaybackAdapter['startVersion'];
  onDispose?: () => void;
}>;

/** The sheet owns its pending command lifetime. The old output fence remains
 * runtime preflight authority; the host predicate permits its accepted new source. */
export class NativeVersionChooserController {
  readonly options: PlaybackOptions;
  readonly rows: ReturnType<typeof nativeVersionChoices>;
  readonly selectedVersionId?: string;
  private readonly ports: Ports;
  private readonly controller = new AbortController();
  private pending = false;
  constructor(ports: Ports) {this.ports = ports; this.options = ports.options; this.rows = ports.rows; this.selectedVersionId = ports.selectedVersionId;}
  private hostCurrent = () => !this.controller.signal.aborted && this.ports.hostCurrent();
  isCurrent = () => this.hostCurrent() && (this.pending || this.ports.sourceCurrent());
  choose = async (versionId: string): Promise<void> => {
    if (this.pending || !this.hostCurrent() || !this.ports.sourceCurrent() || !this.rows.some(row => row.id === versionId)) return;
    const {capture, options, start} = this.ports, target = capture.entry.playback;
    if (!target || target.itemId !== options.itemId || target.itemId !== capture.entry.id) return;
    this.pending = true;
    try {
      await start({entry: capture.entry, target: {...target, startSeconds: (options.resume?.positionMs ?? 0) / 1000}},
        {authority: capture.authority, options, versionId, expectedFence: capture.expectedFence,
          lifetime: {signal: this.controller.signal, isCurrent: this.hostCurrent}});
    } finally {this.pending = false;}
  };
  dispose = () => {if (this.controller.signal.aborted) return; this.controller.abort(); this.ports.onDispose?.();};
}
