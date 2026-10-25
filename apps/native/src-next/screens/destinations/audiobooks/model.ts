import {LibraryContentService, type ContentEntry, type ContentProjection, type ContentSection, type ContentScope} from '../../../../../../packages/client-core/src/library-content';
import type {ListeningJourney} from '../../../../../../packages/client-core/src/listening';
import {getContainerState, setContainerState} from '../../../../../../packages/client-core/src/container-state';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import {nativeDestinationLifetime} from '../lifetime';

export type AudiobookKind = 'book' | 'author' | 'book_series';
export type AudiobookPage = Readonly<{
  entity?: ContentEntry;
  sections: readonly ContentSection[];
  listening?: ListeningJourney;
  phase: 'idle' | 'loading' | 'ready' | 'error' | 'refresh-required';
  error?: unknown;
  finished: boolean;
}>;

type Options = Readonly<{context: NativeShellBootstrapContext; kind: AudiobookKind; libraryId: string; id: string}>;
const chaptersOf = (page: ContentProjection | null) => page?.sections.find(section => section.id === 'chapters');
const partsOf = (page: ContentProjection | null) => page?.sections.find(section => section.id === 'files');
const playable = (entries: readonly ContentEntry[]) => entries.find(entry => entry.playback);

/** One real audiobook catalog page: the shared library content producer for a
 * book, author or series. It never reads the ereader's /v1/reading/items. */
export class NativeAudiobookController {
  private options: Options;
  private service: LibraryContentService;
  private state: AudiobookPage = Object.freeze({phase: 'idle', sections: [], finished: false});
  private listeners = new Set<() => void>();
  private controller?: AbortController;
  private disposed = false;
  constructor(options: Options) {
    this.options = options;
    this.service = new LibraryContentService({api: options.context.api, scope: this.scope(), pageSize: 40});
    this.service.subscribe(() => this.read());
  }
  private scope(): ContentScope {
    return nativeDestinationLifetime(this.options.context).scope;
  }
  getSnapshot = (): AudiobookPage => this.state;
  contains = (entry: ContentEntry): boolean => this.current() && (entry.id === this.options.id || this.chapters().some(value => value.id === entry.id));
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };
  private current(): boolean {return !this.disposed && nativeDestinationLifetime(this.options.context).current();}
  private publish(patch: Partial<AudiobookPage>): void {
    if (!this.current()) return;
    this.state = Object.freeze({...this.state, ...patch});
    for (const listener of [...this.listeners]) listener();
  }
  private read(): void {
    if (!this.current()) return;
    const snapshot = this.service.getSnapshot(), page = snapshot.projection;
    this.publish({phase: snapshot.phase === 'idle' ? 'idle' : snapshot.phase === 'error' ? 'error' : snapshot.phase === 'loading' ? 'loading' : snapshot.phase === 'refresh-required' ? 'refresh-required' : 'ready',
      entity: page?.entity, sections: snapshot.sections, listening: page?.listening, error: snapshot.error ?? undefined});
  }
  load = async (): Promise<void> => {
    if (!this.current()) return;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    this.publish({phase: 'loading', error: undefined});
    try {
      await this.service.select({view: this.options.kind, libraryId: this.options.libraryId, entityId: this.options.id});
      if (!this.current() || controller.signal.aborted) return;
      this.read();
      await this.refreshFinished(controller.signal);
    } catch (error) {
      if (this.current() && !controller.signal.aborted) this.publish({phase: 'error', error});
    }
  };
  /** The book container's finished mark, read from the same container route. */
  private async refreshFinished(signal: AbortSignal): Promise<void> {
    if (this.options.kind !== 'book') return;
    try {
      const state = await getContainerState(this.options.context.api, 'book', this.options.id, signal);
      if (this.current()) this.publish({finished: state.watched});
    } catch { /* the finished mark is optional; the page itself is still real */ }
  }
  markFinished = async (): Promise<void> => {
    if (!this.current() || this.options.kind !== 'book') return;
    const controller = new AbortController();
    const state = await getContainerState(this.options.context.api, 'book', this.options.id, controller.signal);
    const next = await setContainerState(this.options.context.api, 'book', this.options.id, {expectedRevision: state.revision, watched: true}, controller.signal);
    if (this.current()) this.publish({finished: next.watched});
  };
  private start = async (entry: ContentEntry | undefined, startSeconds?: number): Promise<void> => {
    if (!this.current() || !entry?.playback) return;
    const target = {...entry.playback, ...(startSeconds === undefined ? {} : {startSeconds})};
    await this.options.context.playback.start({entry, target});
  };
  private chapters(): readonly ContentEntry[] {
    return [...(chaptersOf(this.service.getSnapshot().projection)?.entries ?? []), ...(partsOf(this.service.getSnapshot().projection)?.entries ?? [])];
  }
  resume = (): Promise<void> => {
    const listening = this.service.getSnapshot().projection?.listening;
    const resume = listening?.resume;
    const entries = this.chapters();
    const entry = resume ? entries.find(value => value.playback?.itemId === resume.itemId
      && (value.playback.startSeconds ?? 0) <= resume.positionSeconds
      && (value.playback.startSeconds ?? 0) + (value.duration ?? 0) > resume.positionSeconds)
      ?? entries.find(value => value.playback?.itemId === resume.itemId) : undefined;
    return this.start(entry, resume?.positionSeconds);
  };
  startOver = (): Promise<void> => this.start(playable(this.chapters()), 0);
  playChapter = (entry: ContentEntry): Promise<void> => this.start(entry, entry.playback?.startSeconds);
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.controller?.abort();
    this.service.dispose();
    this.listeners.clear();
  };
}
