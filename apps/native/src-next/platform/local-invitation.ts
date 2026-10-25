import {PeopleInvitationsClient, type PublicInvitation} from '../../../../packages/client-core/src/direct-account';
import type {ProfileAPI} from '../../../../packages/client-core/src/profile-management';
import {parseShortInvitationCode} from '../../../../packages/client-core/src/short-invitation-code';
import {passwordStrength} from '../../../../packages/client-core/src/password-strength';

type Ports<T> = {api: ProfileAPI; current: () => boolean; signIn: (username: string, password: string) => Promise<T>};
const cancelled = () => Object.assign(new Error('invitation_retired'), {name: 'AbortError'});

/** A memory-only recipient for an already proved, local-sign-in server. */
export class NativeLocalInvitation<T> {
  private readonly ports: Ports<T>;
  private readonly abort = new AbortController();
  private readonly client: PeopleInvitationsClient;
  private invitation?: {shortCode: string; preview: PublicInvitation};
  private accepted?: {preview: PublicInvitation; username: string};
  private busy = false;
  constructor(ports: Ports<T>) {
    this.ports = ports;
    this.client = new PeopleInvitationsClient({request: async <R,>(path: string, method?: string, body?: unknown) => {
      this.assertCurrent();
      const result = await ports.api.request<R>(path, method, body, this.abort.signal);
      this.assertCurrent(); return result;
    }});
  }
  current = () => !this.abort.signal.aborted;
  private assertCurrent() {if (!this.current() || !this.ports.current()) throw cancelled();}
  async preview(raw: string): Promise<PublicInvitation> {
    this.assertCurrent(); if (this.busy) throw cancelled();
    const shortCode = parseShortInvitationCode(raw.trim());
    if (!shortCode) throw Object.assign(new Error('invitation_incomplete'), {code: 'invitation_incomplete'});
    this.busy = true; this.invitation = undefined;
    try {
      const preview = await this.client.previewShort(shortCode, this.abort.signal); this.assertCurrent();
      if (preview.signInMethod !== 'local' || Date.parse(preview.expiresAt) <= Date.now())
        throw Object.assign(new Error('invitation_expired'), {code: 'invitation_expired'});
      this.invitation = {shortCode, preview}; return preview;
    } finally {this.busy = false;}
  }
  async join(preview: PublicInvitation, username: string, password: string, name: string): Promise<T> {
    this.assertCurrent(); const invitation = this.invitation;
    if (this.busy || (!this.accepted && (!invitation || invitation.preview !== preview || Date.parse(preview.expiresAt) <= Date.now()))) throw cancelled();
    const user = username.trim(), label = name.trim();
    if (!/^[A-Za-z0-9_.-]{3,64}$/.test(user) || !passwordStrength(password).acceptable || [...label].length > 120) throw cancelled();
    if (this.accepted && (this.accepted.preview !== preview || this.accepted.username !== user)) throw cancelled();
    this.busy = true;
    try {
      if (!this.accepted) {
        await this.client.acceptLocal({shortCode: invitation!.shortCode, username: user, password, ...(label ? {name: label} : {})}, this.abort.signal);
        this.assertCurrent(); this.accepted = {preview, username: user}; this.invitation = undefined;
      }
      this.assertCurrent();
      // Creation gives no admission. The existing password command owns every returned grant.
      return await this.ports.signIn(user, password);
    } finally {this.busy = false;}
  }
  dispose() {this.abort.abort(); this.invitation = undefined; this.accepted = undefined;}
}
