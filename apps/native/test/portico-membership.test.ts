import test from 'node:test';
import assert from 'node:assert/strict';
import {asksForCustody, membershipActions, transferTargets} from '../src/app/portico-membership.ts';

test('a Portico member can leave; the Portico owner transfers instead; a local account does neither', () => {
  assert.deepEqual(membershipActions({id: 'a', role: 'member', hostedAccountId: 'acct'}), {leave: true, transfer: false});
  assert.deepEqual(membershipActions({id: 'a', role: 'admin', hostedAccountId: 'acct'}), {leave: true, transfer: false});
  assert.deepEqual(membershipActions({id: 'a', role: 'owner', hostedAccountId: 'acct'}), {leave: false, transfer: true});
  assert.deepEqual(membershipActions({id: 'a', role: 'owner'}), {leave: false, transfer: false});
  assert.deepEqual(membershipActions(undefined), {leave: false, transfer: false});
});

test('ownership goes only to an active member, never oneself', () => {
  const raw = {items: [
    {id: 'me', username: 'owner', role: 'owner', disabled: false},
    {id: 'b', username: 'bob', role: 'member', disabled: false},
    {id: 'c', username: 'carol', role: 'member', disabled: true},
    {id: 'd', username: 'dana', role: 'admin', disabled: false},
    {id: 'a', username: 'alex', role: 'member'},
    {username: 'broken'},
  ]};
  assert.deepEqual(transferTargets(raw, 'me'), [{id: 'a', username: 'alex'}, {id: 'b', username: 'bob'}]);
  assert.deepEqual(transferTargets(null, 'me'), []);
});

test('the shell asks only a Portico owner whose server registration is still pending', () => {
  const base = {role: 'owner', authority: 'local', custodyPending: true, porticoSignedIn: true};
  assert.equal(asksForCustody(base), true);
  assert.equal(asksForCustody({...base, custodyPending: false}), false);
  assert.equal(asksForCustody({...base, role: 'member'}), false);
  assert.equal(asksForCustody({...base, porticoSignedIn: false}), false, 'it is confirmed with the Portico Account');
  assert.equal(asksForCustody({...base, authority: 'hosted'}), false);
});
