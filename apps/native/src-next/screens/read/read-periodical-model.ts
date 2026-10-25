import {ReadingError, type LocalSession, type ReadingClient, type ReadingDayChoice, type ReadingItem, type ReadingPeriodicalIssue, type ReadingPeriodicalType, type ReadingYearChoice} from '../../../../../packages/client-core/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import {nativeReadOrigin, openNativeReadBook, type NativeReadOrigin} from './eligibility';

export type NativeReadPeriodicalState = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  /** The server's ordered issues for the selected year or month. */
  items: readonly ReadingPeriodicalIssue[];
  /** The group's latest issue from the first, unfiltered page. */
  latest?: ReadingPeriodicalIssue;
  years: readonly ReadingYearChoice[];
  days: readonly ReadingDayChoice[];
  /** Months that actually hold issues in the unfiltered first page, newest first. */
  months: readonly string[];
  groupName?: string;
  /** Only a complete bucket sum or the group's own count; otherwise absent. */
  issueCount?: number;
  publicationType?: ReadingPeriodicalType;
  selectedYear?: string;
  selectedMonth?: string;
  selectedDate?: string;
  /** The selected query's own next page, if the server published one. */
  nextCursor?: string;
  /** The unfiltered archive's own next page for discovering older months. */
  archiveCursor?: string;
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
      // The unfiltered first page gives the real latest issue, the year buckets
      // and the months that actually hold issues. The displayed issues always
      // come from a query on the chosen year or month, never from this page.
      const unfiltered = await client.periodicalIssues(this.libraryId, this.groupId, this.publicationType, {limit: 60}, signal);
      if (flight !== this.flight || !this.current()) return;
      const latest = unfiltered.items[0];
      const months = monthsOf(unfiltered.items);
      const groupName = latest?.item.series?.name;
      // The raw wire years are {year, issueCount}; only the client's canonical
      // yearChoices are the validated {value, count} projection.
      const buckets = unfiltered.yearChoices;
      const issueCount = buckets.length ? buckets.reduce((total, year) => total + year.count, 0) : undefined;
      const selectedYear = this.publicationType === 'magazine' ? buckets[0]?.value : undefined;
      const selectedMonth = this.publicationType === 'newspaper' ? months[0] : undefined;
      const page = selectedYear ? await client.periodicalIssues(this.libraryId, this.groupId, this.publicationType, {year: selectedYear, limit: 60}, signal)
        : selectedMonth ? await client.periodicalIssues(this.libraryId, this.groupId, this.publicationType, {month: selectedMonth, limit: 60}, signal)
          : unfiltered;
      if (flight !== this.flight || !this.current()) return;
      this.publish({phase: 'ready', items: page.items, ...(latest ? {latest} : {}), years: page.yearChoices, days: page.dayChoices,
        months, ...(groupName ? {groupName} : {}), ...(issueCount === undefined ? {} : {issueCount}), publicationType: this.publicationType,
        ...(selectedYear ? {selectedYear} : {}), ...(selectedMonth ? {selectedMonth} : {}),
        ...(page.nextCursor ? {nextCursor: page.nextCursor} : {}),
        ...(unfiltered.nextCursor ? {archiveCursor: unfiltered.nextCursor} : {})});
    } catch (error) {
      if (flight !== this.flight || !this.current() || cancelled(error)) return;
      this.publish({phase: 'error', items: [], years: [], days: [], months: [], error});
    }
  };
  retry = (): Promise<void> => this.load();
  /** Load one real year of a magazine's issues from the exact rendered state. */
  selectYear = async (rendered: NativeReadPeriodicalState, choice: ReadingYearChoice): Promise<void> => {
    if (this.command || this.publicationType !== 'magazine' || !this.current() || this.state !== rendered || rendered.phase !== 'ready'
      || !rendered.years.some(year => year === choice)) return;
    const life = this.life, flight = ++this.flight, ticket = {};
    if (!life) return;
    this.command = ticket;
    try {
      const page = await this.reading().periodicalIssues(this.libraryId, this.groupId, this.publicationType, {year: choice.value, limit: 60}, life.signal);
      if (this.life !== life || this.command !== ticket || flight !== this.flight || this.state !== rendered || !this.current()) return;
      this.publish({...rendered, phase: 'ready', items: page.items, years: page.yearChoices, days: page.dayChoices,
        selectedYear: choice.value, selectedDate: undefined, ...(page.nextCursor ? {nextCursor: page.nextCursor} : {nextCursor: undefined})});
    } catch (error) {
      if (this.life === life && this.command === ticket && flight === this.flight && this.state === rendered && this.current() && !cancelled(error))
        this.publish({...rendered, phase: 'error', error});
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Load one real month of a newspaper's editions and its actual day counts. */
  selectMonth = async (rendered: NativeReadPeriodicalState, month: string): Promise<void> => {
    if (this.command || this.publicationType !== 'newspaper' || !this.current() || this.state !== rendered || rendered.phase !== 'ready'
      || !rendered.months.includes(month)) return;
    const life = this.life, flight = ++this.flight, ticket = {};
    if (!life) return;
    this.command = ticket;
    try {
      const page = await this.reading().periodicalIssues(this.libraryId, this.groupId, this.publicationType, {month, limit: 60}, life.signal);
      if (this.life !== life || this.command !== ticket || flight !== this.flight || this.state !== rendered || !this.current()) return;
      this.publish({...rendered, phase: 'ready', items: page.items, years: page.yearChoices, days: page.dayChoices,
        selectedMonth: month, selectedDate: undefined, ...(page.nextCursor ? {nextCursor: page.nextCursor} : {nextCursor: undefined})});
    } catch (error) {
      if (this.life === life && this.command === ticket && flight === this.flight && this.state === rendered && this.current() && !cancelled(error))
        this.publish({...rendered, phase: 'error', error});
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Choose a day the server actually listed for this month. */
  selectDate = (rendered: NativeReadPeriodicalState, date: string): void => {
    if (this.command || !this.current() || this.state !== rendered || rendered.phase !== 'ready' || !rendered.days.some(day => day.value === date)) return;
    this.publish({...rendered, selectedDate: date});
  };
  /** The selected query's real next page; only the exact rendered state and its
   * own cursor append, and a newer flight retires this one. */
  next = async (rendered: NativeReadPeriodicalState): Promise<void> => {
    const cursor = rendered.nextCursor;
    if (this.command || !cursor || !this.current() || this.state !== rendered || rendered.phase !== 'ready') return;
    const life = this.life, flight = ++this.flight, ticket = {};
    if (!life) return;
    this.command = ticket;
    try {
      const query = rendered.selectedYear ? {year: rendered.selectedYear} : rendered.selectedMonth ? {month: rendered.selectedMonth} : {};
      const page = await this.reading().periodicalIssues(this.libraryId, this.groupId, this.publicationType, {...query, cursor, limit: 60}, life.signal);
      if (this.life !== life || this.command !== ticket || flight !== this.flight || this.state !== rendered || !this.current() || this.state.nextCursor !== cursor) return;
      this.publish({...rendered, items: [...rendered.items, ...page.items], years: page.yearChoices, days: page.dayChoices,
        ...(page.nextCursor ? {nextCursor: page.nextCursor} : {nextCursor: undefined})});
    } catch (error) {
      if (this.life === life && this.command === ticket && flight === this.flight && this.state === rendered && this.current() && !cancelled(error))
        this.publish({...rendered, error});
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Discover older newspaper months from the unfiltered archive's own cursor;
   * one real page per call, appending only the months that page actually holds. */
  moreMonths = async (rendered: NativeReadPeriodicalState): Promise<void> => {
    const cursor = rendered.archiveCursor;
    if (this.command || this.publicationType !== 'newspaper' || !cursor || !this.current() || this.state !== rendered || rendered.phase !== 'ready') return;
    const life = this.life, flight = ++this.flight, ticket = {};
    if (!life) return;
    this.command = ticket;
    try {
      const page = await this.reading().periodicalIssues(this.libraryId, this.groupId, this.publicationType, {cursor, limit: 60}, life.signal);
      if (this.life !== life || this.command !== ticket || flight !== this.flight || this.state !== rendered || !this.current()) return;
      const known = new Set(rendered.months);
      const discovered = monthsOf(page.items).filter(month => !known.has(month));
      this.publish({...rendered, months: [...rendered.months, ...discovered], ...(page.nextCursor ? {archiveCursor: page.nextCursor} : {archiveCursor: undefined})});
    } catch (error) {
      if (this.life === life && this.command === ticket && flight === this.flight && this.state === rendered && this.current() && !cancelled(error))
        this.publish({...rendered, error});
    } finally {if (this.command === ticket) this.command = undefined;}
  };
  /** Only an issue this page actually listed, from the exact rendered state. */
  open = async (rendered: NativeReadPeriodicalState, issue: ReadingPeriodicalIssue): Promise<boolean> => {
    const origin = this.origin, life = this.life;
    // The hero opens the group's canonical latest issue even after an older year
    // is selected; every other issue must be one this page actually listed.
    if (this.command || !origin || !life || !this.current() || this.state !== rendered || rendered.phase !== 'ready'
      || issue.item.inventoryAvailable !== true || !rendered.items.includes(issue) && rendered.latest !== issue) return false;
    const ticket = {};
    this.command = ticket;
    try {
      return await openNativeReadBook(this.context, {libraryId: this.libraryId, item: issue.item,
        stillCurrent: () => this.life === life && this.command === ticket && this.state === rendered && this.current()}, origin, life.signal);
    }
    finally {if (this.command === ticket) this.command = undefined;}
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
    this.listeners.clear();
  };
}
