import {ApiError} from '../../../../packages/client-core/src';
import {PeopleInvitationsClient, type PublicInvitation} from '../../../../packages/client-core/src/direct-account';
import type {ProfileAPI} from '../../../../packages/client-core/src/profile-management';
import {parseJoinLink} from '../../../../packages/client-core/src/join-link';
import {parseShortInvitationCode} from '../../../../packages/client-core/src/short-invitation-code';

export type NativeInvitationCapability = Readonly<{code: string} | {shortCode: string}>;
type Ports<T> = {
  api: ProfileAPI; origin: string; serverId: string; username: string; current: () => boolean;
  accept: (capability: NativeInvitationCapability) => Promise<T>;
};
class InvitationExpired extends Error {}
const cancelled = () => Object.assign(new Error('invitation_retired'), {name: 'AbortError'});

/** The anonymous preview grants nothing; only the canonical assertion/accept command joins. */
export class NativePorticoInvitation<T> {
  readonly username: string;
  private readonly ports: Ports<T>;
  private readonly abort = new AbortController();
  private readonly client: PeopleInvitationsClient;
  private invitation?: {capability: NativeInvitationCapability; preview: PublicInvitation};
  private busy = false;
  constructor(ports: Ports<T>) {
    this.ports = ports; this.username = ports.username;
    this.client = new PeopleInvitationsClient({request: async <R,>(path: string, method?: string, body?: unknown) => {
      this.assertCurrent();
      try {const result = await ports.api.request<R>(path, method, body, this.abort.signal); this.assertCurrent(); return result;}
      catch (error) {this.assertCurrent(); throw error;}
    }});
  }
  current = () => !this.abort.signal.aborted;
  private assertCurrent() {if (!this.current() || !this.ports.current()) throw cancelled();}
  async preview(raw: string): Promise<PublicInvitation> {
    this.assertCurrent(); if (this.busy) throw cancelled();
    const input = raw.trim(), shortCode = parseShortInvitationCode(input), link = shortCode ? undefined : parseJoinLink(input);
    if (!shortCode && (!link || link.server !== this.ports.origin || link.id !== undefined && link.id !== this.ports.serverId))
      throw Object.assign(new Error('invitation_incomplete'), {code: 'invitation_incomplete'});
    const capability: NativeInvitationCapability = shortCode ? {shortCode} : {code: link!.code};
    this.busy = true; this.invitation = undefined;
    try {
      const preview = 'shortCode' in capability ? await this.client.previewShort(capability.shortCode, this.abort.signal) : await this.client.preview(capability.code, this.abort.signal);
      this.assertCurrent(); if (preview.signInMethod !== 'portico') throw cancelled();
      if (Date.parse(preview.expiresAt) <= Date.now()) throw new InvitationExpired();
      this.invitation = {capability, preview}; return preview;
    } catch (error) {this.assertCurrent(); throw error;} finally {this.busy = false;}
  }
  async join(preview: PublicInvitation): Promise<T> {
    this.assertCurrent(); const invitation = this.invitation;
    if (this.busy || !invitation || invitation.preview !== preview) throw cancelled();
    if (Date.parse(preview.expiresAt) <= Date.now()) throw new InvitationExpired();
    this.busy = true;
    try {return await this.ports.accept(Object.freeze({...invitation.capability}));}
    catch (error) {this.assertCurrent(); throw error;} finally {this.busy = false;}
  }
  failure(error: unknown): 'expired' | 'other-account' | undefined {
    if (error instanceof InvitationExpired || error instanceof ApiError && error.status === 410 && error.code === 'invitation_expired') return 'expired';
    if (error instanceof ApiError && error.status === 403 && error.code === 'invitation_for_another_account') return 'other-account';
    return undefined;
  }
  dispose() {this.abort.abort(); this.invitation = undefined;}
}
