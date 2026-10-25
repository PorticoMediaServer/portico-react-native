import {ApiError} from '../../../../packages/client-core/src';
import {PeopleInvitationsClient, type PublicInvitation} from '../../../../packages/client-core/src/direct-account';
import type {ProfileAPI} from '../../../../packages/client-core/src/profile-management';
import {parseShortInvitationCode} from '../../../../packages/client-core/src/short-invitation-code';
import {parseJoinLink} from '../../../../packages/client-core/src/join-link';
import {passwordStrength} from '../../../../packages/client-core/src/password-strength';

type Capability = Readonly<{code: string} | {shortCode: string}>;
type Ports<T> = {api: ProfileAPI; origin: string; serverId: string; current: () => boolean; signIn: (username: string, password: string) => Promise<T>};
class InvitationExpired extends Error {}
const cancelled = () => Object.assign(new Error('invitation_retired'), {name: 'AbortError'});

/** A memory-only recipient for an already proved, local-sign-in server. */
export class NativeLocalInvitation<T> {
  static parseLink(raw: string) {return parseJoinLink(raw);}
  private readonly ports: Ports<T>;
  private readonly abort = new AbortController();
  private readonly client: PeopleInvitationsClient;
  private invitation?: {capability: Capability; preview: PublicInvitation};
  private accepted?: {preview: PublicInvitation; username: string};
  private busy = false;
  constructor(ports: Ports<T>) {
    this.ports = ports;
    this.client = new PeopleInvitationsClient({request: async <R,>(path: string, method?: string, body?: unknown) => {
      this.assertCurrent();
      try {const result = await ports.api.request<R>(path, method, body, this.abort.signal); this.assertCurrent(); return result;}
      catch (error) {this.assertCurrent(); throw error;}
    }});
  }
  current = () => !this.abort.signal.aborted;
  private assertCurrent() {if (!this.current() || !this.ports.current()) throw cancelled();}
  async preview(raw: string): Promise<PublicInvitation> {
    this.assertCurrent(); if (this.busy || this.accepted) throw cancelled();
    const input = raw.trim(), shortCode = parseShortInvitationCode(input), link = shortCode ? undefined : parseJoinLink(input);
    if (!shortCode && (!link || link.server !== this.ports.origin || link.id !== undefined && link.id !== this.ports.serverId))
      throw Object.assign(new Error('invitation_incomplete'), {code: 'invitation_incomplete'});
    const capability: Capability = shortCode ? {shortCode} : {code: link!.code};
    this.busy = true; this.invitation = undefined;
    try {
      const preview = 'shortCode' in capability ? await this.client.previewShort(capability.shortCode, this.abort.signal) : await this.client.preview(capability.code, this.abort.signal); this.assertCurrent();
      if (preview.signInMethod !== 'local') throw cancelled();
      if (Date.parse(preview.expiresAt) <= Date.now()) throw new InvitationExpired();
      this.invitation = {capability, preview}; return preview;
    } finally {this.busy = false;}
  }
  async join(preview: PublicInvitation, username: string, password: string, name: string): Promise<T> {
    this.assertCurrent(); const invitation = this.invitation;
    if (this.busy || (!this.accepted && (!invitation || invitation.preview !== preview))) throw cancelled();
    if (!this.accepted && Date.parse(preview.expiresAt) <= Date.now()) throw new InvitationExpired();
    const user = username.trim(), label = name.trim();
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(user) || !passwordStrength(password).acceptable || [...label].length > 120) throw cancelled();
    if (this.accepted && (this.accepted.preview !== preview || this.accepted.username !== user)) throw cancelled();
    this.busy = true;
    try {
      if (!this.accepted) {
        await this.client.acceptLocal({...invitation!.capability, username: user, password, ...(label ? {name: label} : {})}, this.abort.signal);
        this.assertCurrent(); this.accepted = {preview, username: user}; this.invitation = undefined;
      }
      this.assertCurrent();
      // Creation gives no admission. The existing password command owns every returned grant.
      return await this.ports.signIn(user, password);
    } catch (error) {this.assertCurrent(); throw error;} finally {this.busy = false;}
  }
  failure(error: unknown): 'expired' | 'username' | undefined {
    if (error instanceof InvitationExpired || error instanceof ApiError && error.status === 410 && error.code === 'invitation_expired') return 'expired';
    if (error instanceof ApiError && error.status === 409 && error.code === 'username_taken') return 'username';
    return undefined;
  }
  dispose() {this.abort.abort(); this.invitation = undefined; this.accepted = undefined;}
}
