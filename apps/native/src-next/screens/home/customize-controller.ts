import type {HomeLayoutRowView, HomeLayoutView} from '../../../../../packages/client-core/src/home';
import type {PersonalResource} from '../../../../../packages/client-core/src/personal-saved';
import type {HomeService} from '../../../../../packages/client-core/src/home-service';

export type NativeHomeCustomizeRow = Readonly<Pick<HomeLayoutRowView, 'id' | 'title' | 'titleText' | 'availabilityText' | 'required' | 'hideable' | 'reorderable' | 'hidden'> & {savedView?: PersonalResource}>;

export type NativeHomeCustomization = Readonly<{
  phase: 'loading' | 'ready' | 'error';
  rows: readonly NativeHomeCustomizeRow[];
  revision?: number;
  pending: boolean;
  dirty: boolean;
  pickedId?: string;
  pickupOrder?: readonly string[];
  conflict: boolean;
  showConflict: boolean;
  error?: unknown;
}>;
type Ports = Readonly<{
  home: Pick<HomeService, 'loadLayout' | 'saveLayout' | 'resetLayout'>;
  current: () => boolean;
  requestId: () => Promise<string>;
  savedViews?: Readonly<{serverId: string; isCurrent: (view: PersonalResource) => boolean}>;
}>;
const isConflict = (error: unknown) => {
  const failure = error as {status?: number; code?: string} | undefined;
  return failure?.status === 409 || ['home_layout_conflict', 'revision_conflict', 'revision_mismatch', 'conflict'].includes(failure?.code ?? '');
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
  private alive = true;
  constructor(ports: Ports) {this.ports = ports;}
  getSnapshot = (): NativeHomeCustomization => this.state;
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private current = () => this.alive && this.ports.current();
  private editable = () => this.current() && this.state.phase === 'ready' && !this.state.pending;
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
    this.read?.abort(); this.read = new AbortController();
    this.publish({phase: 'loading', error: undefined});
    try {
      const layout = await this.ports.home.loadLayout(this.read.signal);
      if (!this.current() || generation !== this.generation) return;
      this.accept(layout);
    } catch (error) {if (this.current() && generation === this.generation) this.publish({phase: 'error', error});}
  };
  private accept(layout: HomeLayoutView): void {
    this.base = layout; this.pickedOrder = undefined;
    this.publish({phase: 'ready', rows: Object.freeze(layout.rows.map(row => Object.freeze({...row}))), revision: layout.revision,
      pickedId: undefined, pickupOrder: undefined, pending: false, conflict: false, showConflict: false, error: undefined});
  }
  /** Adds the current server resource to the transient layout only. Save is
   * the sole mutation; this never issues a separate pin or changes Saved.
   * Frame 29: on TV the list returns with the new row held so it moves at once. */
  addSavedView = (view: PersonalResource, hold = false): boolean => {
    const access = this.ports.savedViews;
    if (!this.editable() || this.state.pickedId || !access || view.serverId !== access.serverId || !access.isCurrent(view)
      || view.kind !== 'view' || view.status !== 'ready' || !view.definition || view.onHome || !view.actions.includes('pin')) return false;
    const id = `view:${view.id}`;
    if (this.state.rows.some(row => row.id === id)) return false;
    const row: NativeHomeCustomizeRow = Object.freeze({id, title: view.name, required: false, hideable: true, reorderable: true, hidden: false, savedView: view});
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
    if (!this.editable() || !row || row.required || !row.hideable) return false;
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
    if (!rows[to]?.reorderable) return false;
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
  keepEditing = (): void => {if (this.editable()) this.publish({showConflict: false});};
  save = async (): Promise<boolean> => {
    if (!this.editable() || this.state.conflict || !this.state.dirty || this.state.pickedId || !this.base) return false;
    if (!this.currentSavedViews(this.state.rows)) return false;
    const rows = this.state.rows, revision = this.base.revision, generation = this.generation;
    this.publish({pending: true, error: undefined});
    try {
      const requestId = await this.ports.requestId();
      if (!this.current() || generation !== this.generation || !this.currentSavedViews(rows)) {this.publish({pending: false}); return false;}
      await this.ports.home.saveLayout(rows.map(row => row.id), rows.filter(row => row.hidden).map(row => row.id), () => requestId, revision);
      if (!this.current() || generation !== this.generation) return false;
      const layout = await this.ports.home.loadLayout();
      if (!this.current() || generation !== this.generation) return false;
      this.accept(layout); return true;
    } catch (error) {
      if (this.current() && generation === this.generation) this.publish({pending: false, error, conflict: isConflict(error), showConflict: isConflict(error)});
      return false;
    }
  };
  /** Called only by the drawn reset confirmation's explicit destructive action. */
  resetConfirmed = async (): Promise<boolean> => {
    if (!this.editable() || this.state.pickedId) return false;
    const generation = this.generation; this.publish({pending: true, error: undefined});
    try {
      const requestId = await this.ports.requestId();
      if (!this.current() || generation !== this.generation) return false;
      await this.ports.home.resetLayout(() => requestId);
      if (!this.current() || generation !== this.generation) return false;
      const layout = await this.ports.home.loadLayout();
      if (!this.current() || generation !== this.generation) return false;
      this.accept(layout); return true;
    } catch (error) {if (this.current() && generation === this.generation) this.publish({pending: false, error}); return false;}
  };
  dispose = (): void => {this.alive = false; this.generation++; this.read?.abort(); this.listeners.clear(); this.base = undefined; this.pickedOrder = undefined;};
}
