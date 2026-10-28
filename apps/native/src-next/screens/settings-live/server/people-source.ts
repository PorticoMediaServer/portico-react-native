import {SettingsPeopleClient, type SettingsPeoplePage, type SettingsPeopleQuery, type SettingsPersonRow} from '../../../../../../packages/client-core/src/settings-people';
import {PeopleInvitationsClient, privatePersonNotes, type PeopleInvitationPage, type ServerInvitation} from '../../../../../../packages/client-core/src/direct-account';
import {deleteMember, previewMemberDeletion, type AccessMember, type MemberDeletionPreview, type MemberLimits} from '../../../../../../packages/client-core/src/server-administration';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import {NativeScreenLifetime, screenScopeEnded} from '../lifetime';
import {nativeStorageOwner} from './storage/space-source';

export const nativePeopleQuery: SettingsPeopleQuery = Object.freeze({search: '', role: 'all', status: 'all', sort: 'person', direction: 'asc'});
type Tab = 'people' | 'invitations';
type Snapshot = Readonly<{
  tab: Tab; query: SettingsPeopleQuery; invitationStatus: '' | 'pending' | 'accepted' | 'revoked' | 'expired';
  people?: SettingsPeoplePage; invitations?: PeopleInvitationPage; cursor: string;
  loading: boolean; busy: boolean; opening: boolean; person?: AccessMember; selected?: SettingsPersonRow; error?: unknown;
}>;
const initial: Snapshot = Object.freeze({tab: 'people', query: nativePeopleQuery, invitationStatus: '', cursor: '', loading: false, busy: false, opening: false});

/** One committed owner page. List cursors and selected revisions never cross a
 * query, tab, account, profile, or screen lifetime. */
export class NativePeopleSource {
  private state = initial;
  private readonly lifetime: NativeScreenLifetime;
  private readonly people: SettingsPeopleClient;
  private readonly invitations: PeopleInvitationsClient;
  private readonly listeners = new Set<() => void>();
  private listFlight?: AbortController;
  private personFlight?: AbortController;
  private mutation?: object;
  private deletion?: MemberDeletionPreview;
  constructor(readonly context: NativeShellBootstrapContext, private readonly operationId: () => string, private readonly reportError: (error: unknown) => void) {
    this.lifetime = new NativeScreenLifetime(context);
    const api = {request: <T,>(path: string, method?: string, body?: unknown, caller?: AbortSignal): Promise<T> => this.current()
      ? this.lifetime.request(signal => context.api.request<T>(path, method, body, signal), caller) : Promise.reject(screenScopeEnded())};
    this.people = new SettingsPeopleClient(api, this.current);
    this.invitations = new PeopleInvitationsClient(api);
    this.api = api;
  }
  private readonly api: {request<T>(path: string, method?: string, body?: unknown, signal?: AbortSignal): Promise<T>};
  current = () => this.lifetime.current() && nativeStorageOwner(this.context) && this.context.account.capabilities.managePeople;
  getSnapshot = (): Snapshot => this.current() ? this.state : initial;
  subscribe = (listener: () => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private publish(patch: Partial<Snapshot>) {if (this.current()) {this.state = Object.freeze({...this.state, ...patch}); for (const listener of this.listeners) listener();}}
  private fail(error: unknown) {
    if (!this.current()) return;
    const status = (error as {status?: number} | null)?.status;
    if (status === 401 || status === 403) {this.dispose(); this.reportError(error);} else this.publish({error});
  }
  select(tab: Tab, query = this.state.query, invitationStatus = this.state.invitationStatus) {
    if (!this.current() || this.state.busy) return;
    this.listFlight?.abort(); this.personFlight?.abort(); this.deletion = undefined;
    this.publish({tab, query, invitationStatus, cursor: '', people: undefined, invitations: undefined, person: undefined, selected: undefined, opening: false, error: undefined});
    void this.load();
  }
  load = async (cursor = ''): Promise<void> => {
    if (!this.current() || this.state.busy) return;
    this.listFlight?.abort(); const flight = this.listFlight = new AbortController();
    this.personFlight?.abort(); this.personFlight = undefined;
    const {tab, query, invitationStatus} = this.state;
    const owns = () => this.current() && this.listFlight === flight && !flight.signal.aborted;
    // A refreshed row has a new identity. Retire an unfinished detail sheet
    // before replacing that row, so its late reply cannot leave it loading.
    this.publish({loading: true, opening: false, error: undefined, ...(this.state.opening ? {selected: undefined, person: undefined} : {})});
    try {
      if (tab === 'people') {
        const people = await this.people.read(query, cursor, flight.signal);
        if (owns()) {
          const selected = this.state.selected ? people.items.find(row => row.accountId === this.state.selected!.accountId) : undefined;
          this.publish({people, cursor, selected, ...(!selected ? {person: undefined} : {})});
        }
      } else {
        const invitations = await this.invitations.list({q: query.search, ...(invitationStatus ? {state: invitationStatus} : {}), sort: 'sent', direction: 'desc', limit: 40, cursor}, flight.signal);
        if (owns()) this.publish({invitations, cursor});
      }
    } catch (error) {if (owns()) this.fail(error);}
    finally {if (owns()) this.publish({loading: false}); if (this.listFlight === flight) this.listFlight = undefined;}
  };
  open = async (row: SettingsPersonRow): Promise<void> => {
    if (!this.current() || this.state.busy || this.state.loading || !this.state.people?.items.includes(row)) return;
    this.personFlight?.abort(); const flight = this.personFlight = new AbortController(); this.deletion = undefined;
    const owns = () => this.current() && this.personFlight === flight && !flight.signal.aborted && this.state.selected === row;
    this.publish({selected: row, person: undefined, opening: true, error: undefined});
    try {const person = await this.people.person(row.accountId, flight.signal); if (owns()) this.publish({person});}
    catch (error) {if (owns()) this.fail(error);}
    finally {if (owns()) this.publish({opening: false}); if (this.personFlight === flight) this.personFlight = undefined;}
  };
  closePerson = () => {if (this.state.busy) return; this.personFlight?.abort(); this.personFlight = undefined; this.deletion = undefined; this.publish({selected: undefined, person: undefined, opening: false});};
  private owns(person: AccessMember) {return this.current() && !this.state.busy && !this.state.loading && this.state.person === person && person.role !== 'owner' && person.accountId !== this.context.account.account.id;}
  private async change(person: AccessMember, action: () => Promise<unknown>): Promise<boolean> {
    if (!this.owns(person)) return false;
    const token = this.mutation = {}; this.deletion = undefined; this.publish({busy: true, error: undefined});
    const owns = () => this.current() && this.mutation === token && this.state.person === person;
    let saved = false;
    try {
      await action(); if (!owns()) return false;
      const fresh = await this.people.person(person.accountId); if (!owns()) return false;
      this.publish({person: fresh}); saved = true; return true;
    } catch (error) {if (owns()) this.fail(error); return false;}
    finally {if (this.current() && this.mutation === token) {this.mutation = undefined; this.publish({busy: false}); if (saved) void this.load(this.state.cursor);}}
  }
  notes = (person: AccessMember, value: string) => this.change(person, () => this.people.notes(person, privatePersonNotes(value) ?? ''));
  role = (person: AccessMember, role: 'admin' | 'member') => this.change(person, () => this.people.role(person, role));
  limits = (person: AccessMember, limits: MemberLimits) => this.change(person, () => this.people.limits(person, limits));
  enabled = (person: AccessMember, enabled: boolean) => this.change(person, async () => {
    const row = this.state.selected;
    if (!row || row.accountId !== person.accountId) throw screenScopeEnded();
    await this.people.bulk([{...row, revision: person.revision, limitsRevision: person.limitsRevision}], enabled ? 'enable' : 'disable', undefined, this.operationId());
  });
  previewDeletion = async (person: AccessMember): Promise<MemberDeletionPreview | undefined> => {
    if (!this.owns(person)) return;
    const token = this.mutation = {}; this.publish({busy: true, error: undefined});
    try {
      const preview = await previewMemberDeletion(this.api, person.accountId);
      if (!this.current() || this.mutation !== token || this.state.person !== person || preview.role === 'owner') return;
      this.deletion = preview; return preview;
    } catch (error) {if (this.current() && this.mutation === token) this.fail(error);}
    finally {if (this.current() && this.mutation === token) {this.mutation = undefined; this.publish({busy: false});}}
  };
  remove = async (person: AccessMember, preview: MemberDeletionPreview): Promise<boolean> => {
    if (!this.owns(person) || this.deletion !== preview || preview.accountId !== person.accountId) return false;
    const token = this.mutation = {}; this.deletion = undefined; this.publish({busy: true, error: undefined});
    let removed = false;
    try {
      await deleteMember(this.api, preview);
      if (!this.current() || this.mutation !== token || this.state.person !== person) return false;
      this.publish({person: undefined, selected: undefined}); removed = true; return true;
    } catch (error) {if (this.current() && this.mutation === token) this.fail(error); return false;}
    finally {if (this.current() && this.mutation === token) {this.mutation = undefined; this.publish({busy: false}); if (removed) void this.load();}}
  };
  revoke = async (invitation: ServerInvitation): Promise<void> => {
    if (!this.current() || this.state.busy || this.state.loading || !this.state.invitations?.items.includes(invitation) || invitation.state !== 'pending') return;
    const token = this.mutation = {}; this.publish({busy: true, error: undefined});
    let revoked = false;
    try {await this.invitations.revoke(invitation, this.operationId()); revoked = true;}
    catch (error) {if (this.current() && this.mutation === token) this.fail(error);}
    finally {if (this.current() && this.mutation === token) {this.mutation = undefined; this.publish({busy: false}); if (revoked) void this.load(this.state.cursor);}}
  };
  dispose = () => {this.listFlight?.abort(); this.personFlight?.abort(); this.mutation = undefined; this.deletion = undefined; this.people.dispose(); this.lifetime.dispose(); this.state = initial; this.listeners.clear();};
}
