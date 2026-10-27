import {parseAccessDevicePage, parseAccessMemberPage, parseInvitationPage, type AccessDevice, type AccessMember, type Invitation} from '../../../../../../packages/client-core/src/server-administration';
import type {NativeScreenLifetime} from '../lifetime';
import {createTVServerReader} from './tv-server-reader';

type Section = 'members' | 'invitations' | 'devices';
type Row = AccessMember | Invitation | AccessDevice;
type Page = {items: readonly Row[]; nextCursor: string};
export type PeopleSection<T> = {items: readonly T[]; cursor: string; pending: boolean; error?: unknown; loaded: boolean};
export type PeoplePages = {members: PeopleSection<AccessMember>; invitations: PeopleSection<Invitation>; devices: PeopleSection<AccessDevice>};
const initial = (): PeoplePages => ({members: {items: [], cursor: '', pending: false, loaded: false}, invitations: {items: [], cursor: '', pending: false, loaded: false}, devices: {items: [], cursor: '', pending: false, loaded: false}});
const key = (section: Section, row: Row): string => section === 'members' ? (row as AccessMember).accountId : (row as Invitation | AccessDevice).id;

/** One instance owns one panel opening and its exact authority lifetime. */
export class PeoplePagesController {
  private state = initial();
  private abort = new AbortController();
  private seen: Record<Section, Set<string>> = {members: new Set(), invitations: new Set(), devices: new Set()};
  private api: ReturnType<typeof createTVServerReader>;
  constructor(context: Parameters<typeof createTVServerReader>[0], private lifetime: NativeScreenLifetime, private changed: (state: PeoplePages) => void) {this.api = createTVServerReader(context, lifetime);}
  start(): void {for (const section of ['members', 'invitations', 'devices'] as const) void this.load(section);}
  dispose(): void {this.abort.abort();}
  async load(section: Section, expectedCursor?: string): Promise<void> {
    const current = this.state[section];
    if (this.abort.signal.aborted || !this.lifetime.current() || current.pending || current.loaded && !current.cursor || expectedCursor !== undefined && expectedCursor !== current.cursor) return;
    const cursor = current.loaded ? current.cursor : undefined;
    this.update(section, {...current, pending: true, error: undefined});
    try {
      const raw = await this.api.peoplePage<unknown>(section, cursor, this.abort.signal);
      const page: Page = section === 'members' ? parseAccessMemberPage(raw) : section === 'invitations' ? parseInvitationPage(raw) : parseAccessDevicePage(raw);
      if (this.abort.signal.aborted || !this.lifetime.current()) return;
      if (cursor) this.seen[section].add(cursor);
      const present = new Set(current.items.map(row => key(section, row)));
      const items: Row[] = [...current.items];
      for (const row of page.items) if (!present.has(key(section, row))) {present.add(key(section, row)); items.push(row);}
      const next = page.nextCursor && !this.seen[section].has(page.nextCursor) && page.nextCursor !== cursor ? page.nextCursor : '';
      this.update(section, {items, cursor: next, pending: false, loaded: true});
    } catch (error) {
      if (!this.abort.signal.aborted && this.lifetime.current()) this.update(section, {...current, pending: false, error: error ?? new Error('native_tv_people_page_failed')});
    }
  }
  private update(section: Section, value: PeopleSection<Row>): void {
    this.state = {...this.state, [section]: value} as PeoplePages;
    this.changed(this.state);
  }
}
