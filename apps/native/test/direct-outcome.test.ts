/**
 * C45: what the Apple app does with each documented direct sign-in answer
 * (Portico C — Results, "Client migration: direct identity"). The shapes are the
 * documented ones, parsed by client-core; the decision is `directOutcome`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDirectSignIn} from '../../../packages/client-core/src/profile-management.ts';
import {directOutcome} from '../src/app/direct-outcome.ts';

const profile = (id: string, over: Record<string, unknown> = {}) => ({id, name: id, primary: id === 'p1', position: id === 'p1' ? 0 : 1, art: 'blue', revision: 1, pinRevision: 1, pinRequired: false, allowedLibraries: [], ...over});
const snapshot = (profiles: unknown[]) => ({authority: 'local', serverId: 'srv', account: {id: 'acct', username: 'owner', primaryProfileId: 'p1', role: 'owner', revision: 1, disabled: false, allowedLibraries: []}, profiles, canManage: true, capabilities: {manageAccount: true, managePeople: true, manageServer: true, manageSignIn: true}});
const session = (role: string, extra: Record<string, unknown> = {}) => ({accessToken: 'a'.repeat(43), refreshToken: 'r'.repeat(43), deviceId: 'dev', ...extra, expiresAt: '2099-01-01T00:00:00Z', sessionFamilyId: 'fam', tokenGeneration: '1', authorizationHorizon: '2099-03-01T00:00:00Z', viewer: {accountId: 'acct', profileId: 'p1', serverId: 'srv', authority: 'local', role}});
const signedIn = (profiles: unknown[], role: string, extra: Record<string, unknown> = {}) => parseDirectSignIn({...snapshot(profiles), deviceId: 'dev', installationId: 'inst', session: session(role), ...extra});

test('one unprotected profile: the sign-in session is the viewer and is kept', () => {
  assert.equal(directOutcome(signedIn([profile('p1')], 'owner')), 'viewer');
});

test('several profiles or a protected one: an account-tier session opens the profile chooser', () => {
  assert.equal(directOutcome(signedIn([profile('p1'), profile('p2')], 'account')), 'choose-profile');
  assert.equal(directOutcome(signedIn([profile('p1', {pinRequired: true})], 'account')), 'choose-profile');
});

test('a required password change comes before anything else', () => {
  assert.equal(directOutcome(signedIn([profile('p1')], 'account', {passwordChangeRequired: true})), 'new-password');
  assert.equal(directOutcome(signedIn([profile('p1'), profile('p2')], 'account', {passwordChangeRequired: true})), 'new-password');
});

test('two-step verification asks for a code; nothing is issued yet', () => {
  assert.equal(directOutcome(parseDirectSignIn({challenge: {token: 'c'.repeat(43), expiresAt: '2099-01-01T00:00:00Z'}})), 'code');
});

test('retired device approval responses are rejected and never enter a waiting journey', () => {
  assert.throws(() => parseDirectSignIn({deviceApprovalPending: true, deviceId: 'dev', installationId: 'inst'}), (error: {code?: string}) => error.code === 'invalid_response');
});

// The documented envelope carries `installationId` inside `session` too (client-core accepts it since F-web's fix).
test('the documented session envelope (with installationId) is accepted', () => {
  const r = parseDirectSignIn({...snapshot([profile('p1')]), deviceId: 'dev', installationId: 'inst', session: session('owner', {installationId: 'inst'})});
  assert.equal(directOutcome(r), 'viewer');
});
