import {ReadingError, type LocalSession, type ReadingClient, type ReadingDayChoice, type ReadingItem, type ReadingPeriodicalIssue, type ReadingPeriodicalType, type ReadingYearChoice} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {nativeReadOrigin, openNativeReadBook, type NativeReadOrigin} from './eligibility';

export type NativeReadPeriodicalState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** The server's ordered issues for the current year or month. */
  items: readonly ReadingPeriodicalIssue[];
  /** The group's latest issue from the first, unfiltered page. */
  latest?: ReadingPeriodicalIssue;
  years: readonly ReadingYearChoice[];
  days: readonly ReadingDayChoice[];
  /** Months that actually hold issues, newest first. */
  months: readonly string[];
  groupName?: string;
  issueCount?: number;
  publicationType?: ReadingPeriodicalType;
  selectedYear?: string;
  selectedMonth?: string;
  selectedDate?: string;
  error?: unknown;
}>;
type PeriodicalRoute = Extract<NativeShellRoute, {kind: 'read-periodical'}>;

const refused = () => Object.assign(new Error('native_read_periodical_refused'), {name: 'AbortError', code: 'cancelled'});
const cancelled = (error: unknown): boolean => error instanceof ReadingError && error.code === 'cancelled' && error.status === undefined;
const monthsOf = (items: readonly ReadingPeriodicalIssue[]): readonly string[] => [...new Set(items.map(entry => entry.issueDate.slice(0, 7)))];

/** A magazine or newspaper group from its signed periodical producer. Year and
 * month choices, days and issues are the server's own projections; the page
 * never builds an empty calendar or a year range of its own. */
export class NativeReadPeriodical {
  private readonly context: NativeShellBootstrapContext;
  private readonly libraryId: string;
  private readonly groupId: string;
  private readonly publicationType: ReadingPeriodicalType;
  private readonly route: PeriodicalRoute;
  private origin?: NativeReadOrigin;
  private captured?: Readonly<{sessionFamilyId: string; viewer: LocalSession['viewer']}>;
  private authority?: ShellAuthority;
  private life?: AbortController;
  private client?: ReadingClient;
  private state: NativeReadPeriodicalState = Object.freeze({phase: 'idle', items: [], years: [], days: [], months: []});
  private readonly listeners = new Set<() => void>();
  private flight = 0;
  private command?: object;
  private disposed = false;

  constructor(context: NativeShellBootstrapContext, route: PeriodicalRoute) {
    this.context = context; this.libraryId = route.libraryId; this.groupId = route.groupId;
    this.publicationType = route.publicationType; this.route = route;
  }
  arm = (): boolean => {
    if (this.disposed) return false;
    const selected = this.context.session(), origin = nativeReadOrigin(this.context, this.route);
    if (!selected || !origin) return false;
    this.retire();
    this.origin = origin;
    this.authority = this.context.authority();
    this.captured = Object.freeze({sessionFamilyId: selected.sessionFamilyId, viewer: Object.freeze({...selected.viewer})});
    this.state = Object.freeze({phase: 'idle', items: [], years: [], days: [], months: []});
    this.emit();
    return true;
  };
  release = (): void => {
    this.retire();
    this.origin = undefined; this.captured = undefined; this.authority = undefined;
  };
  private retire(): void {
    this.flight++;
    this.life?.abort();
    this.client?.dispose();
    this.client = undefined; this.life = undefined; this.command = undefined;
  }
  private current = (): boolean => {
    const origin = this.origin, captured = this.captured, selected = this.context.session();
    if (this.disposed || !origin || !captured || !this.authority || !selected || !this.context.current()) return false;
    if (selected.sessionFamilyId !== captured.sessionFamilyId || !sameAuthority(this.authority, this.context.authority())) return false;
    const snapshot = this.context.navigation.getSnapshot();
    return snapshot.route === origin.route && snapshot.revision === origin.revision;
  };
  private reading(): ReadingClient {
    const captured = this.captured;
    if (!captured || !this.current()) throw refused();
    this.life ??= new AbortController();
    return this.client ??= this.context.api.reading({viewer: captured.viewer, isCurrent: this.current, signal: this.life.signal});
  }
  private publish(next: NativeReadPeriodicalState): void {
    if (this.disposed || !this.current()) return;
    this.state = Object.freeze(next);
    this.emit();
  }
  private emit(): void {for (const listener of [...this.listeners]) listener();}
  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };
  getSnapshot = (): NativeReadPeriodicalState => this.state;
  load = async (): Promise<void> => {
    if (!this.current()) return;
    const flight = ++this.flight;
    this.publish({phase: 'loading', items: [], years: this.state.years, days: [], months: this.state.months});
    try {
      const client = this.reading(), signal = this.life!.signal;
      const page = await client.periodicalIssues(this.libraryId, this.groupId, this.publicationType, {limit: 60}, signal);
      if (flight !== this.flight || !this.current()) return;
      const latest = page.items[0];
      const groupName = latest?.item.series?.name;
      const issueCount = page.yearChoices.length ? page.yearChoices.reduce((total, year) => total + year.count, 0) : page.items.length;
      const months = monthsOf(page.items);
      this.publish({phase: 'ready', items: page.items, ...(latest ? {latest} : {}), years: page.yearChoices, days: page.dayChoices,
        months, ...(groupName ? {groupName} : {}), issueCount, publicationType: this.publicationType,
        ...(page.yearChoices.length ? {selectedYear: page.yearChoices[page.yearChoices.length - 1]!.value} : {}),
        ...(this.publicationType === 'newspaper' && months[0] ? {selectedMonth: months[0]} : {})});
    } catch (error) {
      if (flight !== this.flight || !this.current() || cancelled(error)) return;
      this.publish({phase: 'error', items: [], years: [], days: [], months: [], error});
    }
  };
  retry = (): Promise<void> => this.load();
  /** Load one real year of a magazine's issues. */
  selectYear = async (year: string): Promise<void> => {
    if (this.command || this.publicationType !== 'magazine' || !this.current() || this.state.phase !== 'ready' || !this.state.years.some(value => value.value === year)) return;
    const flight = ++this.flight, ticket = {};
    this.command = ticket;
    try {
      const page = await this.reading().periodicalIssues(this.libraryId, this.groupId, this.publicationType, {year, limit: 60}, this.life!.signal);
      if (flight !== this.flight || !this.current()) return;
      this.publish({...this.state, phase: 'ready', items: page.items, years: page.yearChoices, days: page.dayChoices, selectedYear: year});
    } catch (error) {
      if (flight === this.flight && this.current() && !cancelled(error)) this.publish({...this.state, phase: 'error', error});
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Load one real month of a newspaper's editions and its actual day counts. */
  selectMonth = async (month: string): Promise<void> => {
    if (this.command || this.publicationType !== 'newspaper' || !this.current() || this.state.phase !== 'ready' || !this.state.months.includes(month)) return;
    const flight = ++this.flight, ticket = {};
    this.command = ticket;
    try {
      const page = await this.reading().periodicalIssues(this.libraryId, this.groupId, this.publicationType, {month, limit: 60}, this.life!.signal);
      if (flight !== this.flight || !this.current()) return;
      this.publish({...this.state, phase: 'ready', items: page.items, years: page.yearChoices, days: page.dayChoices, selectedMonth: month});
    } catch (error) {
      if (flight === this.flight && this.current() && !cancelled(error)) this.publish({...this.state, phase: 'error', error});
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Choose a day the server actually listed for this month. */
  selectDate = (date: string): void => {
    if (!this.current() || this.state.phase !== 'ready' || !this.state.days.some(value => value.value === date)) return;
    this.publish({...this.state, selectedDate: date});
  };
  /** Only an issue this page actually listed opens, with available inventory. */
  open = async (item: ReadingItem): Promise<boolean> => {
    const origin = this.origin, life = this.life;
    if (this.command || !origin || !life || !this.current() || this.state.phase !== 'ready' || item.inventoryAvailable !== true
      || !this.state.items.some(entry => entry.item.id === item.id && entry.item.sourceId === item.sourceId)) return false;
    const ticket = {};
    this.command = ticket;
    try {return await openNativeReadBook(this.context, {libraryId: this.libraryId, item}, origin, life.signal);}
    finally {if (this.command === ticket) this.command = undefined;}
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.listeners.clear();
  };
}
