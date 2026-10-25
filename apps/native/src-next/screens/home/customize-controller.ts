import type {HomeLayoutRowView, HomeLayoutView} from '../../../../../packages/client-core/src/home';
import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import type {HomeService} from '../../../../../packages/client-core/src/home-service';

export type NativeHomeCustomizeRow = Readonly<Pick<HomeLayoutRowView, 'id' | 'kind' | 'libraryId' | 'title' | 'titleText' | 'availabilityText' | 'required' | 'hideable' | 'reorderable' | 'hidden'> & {savedView?: PersonalResource}>;

export type NativeHomeCustomization = Readonly<{
  phase: 'loading' | 'ready' | 'error';
  rows: readonly NativeHomeCustomizeRow[];
  revision?: number;
  layout?: HomeLayoutView;
  pending: boolean;
  dirty: boolean;
  pickedId?: string;
  pickupOrder?: readonly string[];
  conflict: boolean;
  showConflict: boolean;
  error?: unknown;
  retry?: 'save' | 'reset';
}>;
export type NativeHomeResetOpening = Readonly<{controller: NativeHomeCustomizeController; layout: HomeLayoutView; revision: number}>;
type Ports = Readonly<{
  home: Pick<HomeService, 'loadLayout' | 'saveLayout' | 'resetLayout'>;
  current: () => boolean;
  requestId: () => Promise<string>;
  savedViews?: Readonly<{serverId: string; isCurrent: (view: PersonalResource) => boolean}>;
}>;
const isConflict = (error: unknown) => {
  const failure = error as {status?: number; code?: string} | undefined;
  return ['home_layout_conflict', 'revision_conflict', 'revision_mismatch'].includes(failure?.code ?? '');
};

/** Transient draft only. The existing Home service owns persistence, revision
 * checks and fresh Home publication; a conflict is never automatically retried. */
export class NativeHomeCustomizeController {
  private readonly ports: Ports;
  private state: NativeHomeCustomization = Object.freeze({phase: 'loading', rows: [], pending: false, dirty: false, conflict: false, showConflict: false});
  private base?: HomeLayoutView;
  private pickedOrder?: readonly string[];
  private listeners = new Set<() => void>();
  private read?: AbortController;
  private generation = 0;
  private command?: {kind: 'save' | 'reset'; rows: readonly NativeHomeCustomizeRow[]; revision: number; generation: number; abort: AbortController; key?: string; accepted: boolean};
  private alive = true;
  constructor(ports: Ports) {this.ports = ports;}
  getSnapshot = (): NativeHomeCustomization => this.state;
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  isCurrent = (): boolean => this.current();
  private current = () => this.alive && this.ports.current();
  private editable = () => this.current() && this.state.phase === 'ready' && !this.state.pending && !this.state.retry;
  private publish(patch: Partial<NativeHomeCustomization>): void {
    if (!this.current()) return;
    const next = {...this.state, ...patch};
    const base = this.base;
    next.dirty = !!base && (next.rows.some((row, index) => base.rows[index]?.id !== row.id || base.rows[index]?.hidden !== row.hidden) || next.rows.length !== base.rows.length);
    this.state = Object.freeze(next);
    for (const listener of [...this.listeners]) listener();
  }
  load = async (): Promise<void> => {
    if (!this.current() || this.state.pending) return;
    const generation = ++this.generation;
    this.command?.abort.abort();this.command = undefined;
    this.read?.abort(); this.read = new AbortController();
    this.publish({phase: 'loading', error: undefined, retry: undefined, conflict: false, showConflict: false, pickedId: undefined, pickupOrder: undefined});
    try {
      const layout = await this.ports.home.loadLayout(this.read.signal);
      if (!this.current() || generation !== this.generation) return;
      this.accept(layout);
    } catch (error) {if (this.current() && generation === this.generation) this.publish({phase: 'error', error});}
  };
  private accept(layout: HomeLayoutView): void {
    this.base = layout; this.pickedOrder = undefined;
    this.publish({phase: 'ready', rows: Object.freeze(layout.rows.map(row => Object.freeze({...row}))), revision: layout.revision, layout,
      pickedId: undefined, pickupOrder: undefined, pending: false, conflict: false, showConflict: false, error: undefined, retry: undefined});
  }
  /** Adds the current server resource to the transient layout only. Save is
   * the sole mutation; this never issues a separate pin or changes Saved.
   * Frame 29: on TV the list returns with the new row held so it moves at once. */
  addSavedView = (view: PersonalResource, hold = false): boolean => {
    const access = this.ports.savedViews;
    if (!this.editable() || this.state.pickedId || this.state.rows.length >= 64 || !access || view.serverId !== access.serverId || !access.isCurrent(view)
      || view.kind !== 'view' || view.status !== 'ready' || !view.definition || view.onHome || !view.actions.includes('pin')) return false;
    const id = `view:${view.id}`;
    if (this.state.rows.some(row => row.id === id)) return false;
    const row: NativeHomeCustomizeRow = Object.freeze({id, kind: 'saved_view', libraryId: view.definition.libraryId, title: view.name, required: false, hideable: true, reorderable: true, hidden: false, savedView: view});
    const rows = Object.freeze([...this.state.rows, row]);
    if (!hold) {this.publish({rows}); return true;}
    this.pickedOrder = Object.freeze(rows.map(value => value.id));
    this.publish({rows, pickedId: id, pickupOrder: this.pickedOrder}); return true;
  };
  private currentSavedViews(rows: readonly NativeHomeCustomizeRow[]): boolean {
    return rows.every(row => !row.savedView || this.ports.savedViews?.isCurrent(row.savedView));
  }
  /** Takes a saved view off Home in the draft. The layout write is still the only mutation:
   * the server builds a saved view's row from the order it is sent, so a row left out of the
   * order is off Home on the next read, and the view's own On Home mark follows. */
  removeSavedView = (id: string): boolean => {
    const row = this.state.rows.find(value => value.id === id);
    if (!this.editable() || this.state.pickedId || !row?.savedView) return false;
    this.pickedOrder = undefined;
    this.publish({rows: Object.freeze(this.state.rows.filter(value => value !== row)), pickedId: undefined, pickupOrder: undefined});
    return true;
  };
  toggle = (id: string): boolean => {
    const row = this.state.rows.find(value => value.id === id);
    if (!this.editable() || this.state.pickedId || !row || row.required || !row.hideable) return false;
    this.publish({rows: Object.freeze(this.state.rows.map(value => value === row ? Object.freeze({...row, hidden: !row.hidden}) : value))});
    return true;
  };
  pick = (id: string): boolean => {
    if (!this.editable() || !this.state.rows.some(row => row.id === id && row.reorderable)) return false;
    if (this.state.pickedId === id) {this.drop(); return true;}
    if (this.state.pickedId) return false;
    this.pickedOrder = Object.freeze(this.state.rows.map(row => row.id)); this.publish({pickedId: id, pickupOrder: this.pickedOrder}); return true;
  };
  move = (direction: -1 | 1): boolean => {
    if (!this.editable() || !this.state.pickedId) return false;
    const rows = [...this.state.rows], from = rows.findIndex(row => row.id === this.state.pickedId), to = from + direction;
    if (from < 0 || !rows[to]?.reorderable) return false;
    [rows[from], rows[to]] = [rows[to], rows[from]];
    this.publish({rows: Object.freeze(rows)}); return true;
  };
  drop = (): void => {if (this.editable()) {this.pickedOrder = undefined; this.publish({pickedId: undefined, pickupOrder: undefined});}};
  cancelPickup = (): boolean => {
    if (!this.editable() || !this.state.pickedId || !this.pickedOrder) return false;
    const byId = new Map(this.state.rows.map(row => [row.id, row]));
    const rows = this.pickedOrder.map(id => byId.get(id)!);
    this.pickedOrder = undefined; this.publish({rows: Object.freeze(rows), pickedId: undefined, pickupOrder: undefined}); return true;
  };
  /** Keep the original revision and warning. The presenter returns focus to
   * the draft; Reload remains available instead of stranding a disabled Save. */
  keepEditing = (): void => {if (this.editable()) this.publish({showConflict: true});};
  bindSavedViews = (views: readonly PersonalResource[]): void => {
    if (!this.current() || this.state.phase !== 'ready') return;
    const byId = new Map(views.map(view => [`view:${view.id}`, view]));
    let changed = false;
    const rows = this.state.rows.map(row => {
      const view = byId.get(row.id);
      if (row.kind !== 'saved_view' || !view || !this.ports.savedViews?.isCurrent(view) || row.savedView === view) return row;
      changed = true;return Object.freeze({...row, savedView: view});
    });
    if (changed) this.publish({rows: Object.freeze(rows)});
  };
  save = async (): Promise<boolean> => {
    if (this.command) return this.command.kind === 'save' ? this.retry() : false;
    if (!this.editable() || this.state.conflict || !this.state.dirty || this.state.pickedId || !this.base) return false;
    this.command = {kind: 'save', rows: this.state.rows, revision: this.base.revision, generation: this.generation, abort: new AbortController(), accepted: false};
    return this.retry();
  };
  captureReset = (layout: HomeLayoutView | undefined): NativeHomeResetOpening | undefined => {
    if (!this.editable() || this.state.conflict || this.state.pickedId || !layout || layout !== this.base) return;
    return Object.freeze({controller: this, layout, revision: layout.revision});
  };
  /** Confirm only the exact controller/document/revision this opening drew. */
  resetConfirmed = async (opening: NativeHomeResetOpening): Promise<boolean> => {
    if (!this.editable() || this.state.conflict || this.state.pickedId || !this.base || opening.controller !== this || opening.layout !== this.base || opening.revision !== this.base.revision) return false;
    this.command = {kind: 'reset', rows: this.state.rows, revision: opening.revision, generation: this.generation, abort: new AbortController(), accepted: false};
    return this.retry();
  };
  retry = async (): Promise<boolean> => {
    const command = this.command;
    if (!command || !this.current() || this.state.pending) return false;
    const current = () => this.current() && this.command === command && command.generation === this.generation && !command.abort.signal.aborted;
    const lifetime = {signal: command.abort.signal, isCurrent: current};
    this.publish({pending: true, error: undefined, retry: undefined});
    try {
      command.key ??= await this.ports.requestId();
      if (!current()) return false;
      if (!command.accepted) {
        if (command.kind === 'save' && !this.currentSavedViews(command.rows)) throw Object.assign(new Error('Saved view is no longer current'), {code: 'unavailable'});
        if (command.kind === 'save') await this.ports.home.saveLayout(command.rows.map(row => row.id), command.rows.filter(row => row.hidden).map(row => row.id), () => command.key!, command.revision, lifetime);
        else await this.ports.home.resetLayout(() => command.key!, command.revision, lifetime);
        command.accepted = true;
      }
      if (!current()) return false;
      const layout = await this.ports.home.loadLayout(command.abort.signal);
      if (!current()) return false;
      this.command = undefined;this.accept(layout);return true;
    } catch (error) {
      if (current()) {
        const conflict = isConflict(error);
        if (conflict) this.command = undefined;
        this.publish({pending: false, error, conflict, showConflict: conflict, retry: conflict ? undefined : command.kind});
      }
      return false;
    }
  };
  dispose = (): void => {this.alive = false; this.generation++; this.read?.abort(); this.command?.abort.abort();this.command = undefined;this.listeners.clear(); this.base = undefined; this.pickedOrder = undefined;};
}
