/**
 * Links from outside the app (a home-screen card, Spotlight, Siri, a universal link) have one
 * owner. It reads the launch link once per process, holds at most one link until the shell can
 * open it, and opens it exactly once: for the viewer it arrived under, within ten minutes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PENDING_LINK_LIFETIME_MS, PendingLinkOwner, linkViewerKey, routedLink} from '../src/shell/pending-link.ts';

const alice = linkViewerKey({authority: 'local', accountId: 'a1', profileId: 'p1', serverId: 's1'})!;
const kid = linkViewerKey({authority: 'local', accountId: 'a1', profileId: 'p2', serverId: 's1'})!;
const elsewhere = linkViewerKey({authority: 'local', accountId: 'a1', profileId: 'p1', serverId: 's2'})!;
const MOVIE = 'portico://play/movie-1';
const SHOW = 'portico://item/show-9';

function harness() {
  let now = 1_000_000;
  const owner = new PendingLinkOwner(() => now);
  const opened: string[] = [];
  return {owner, opened, open: (url: string) => { opened.push(url); }, pass: (ms: number) => { now += ms; }};
}

test('the launch link is read once per process', () => {
  const {owner} = harness();
  assert.equal(owner.claimInitial(), true);
  assert.equal(owner.claimInitial(), false);
  assert.equal(owner.claimInitial(), false);
});

test('a link that arrives while the saved sign-in is still being confirmed opens once the shell is ready', () => {
  const {owner, opened, open, pass} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  assert.deepEqual(opened, [], 'held: nothing can open it yet');
  // The restore: the viewer is cleared while the server is verified, then selected again.
  pass(3000);
  owner.setViewer(null);
  owner.setViewer(alice);
  owner.attach(alice, open);
  assert.deepEqual(opened, [MOVIE]);
});

test('a link is opened exactly once: a later shell (profile switch and back, signing in again) does not reopen it', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  const detach = owner.attach(alice, open);
  assert.deepEqual(opened, [MOVIE]);
  detach();
  owner.setViewer(null);
  owner.setViewer(kid);
  owner.attach(kid, open)();
  owner.setViewer(alice);
  owner.attach(alice, open);
  assert.deepEqual(opened, [MOVIE]);
});

test('a link that arrives while the shell is ready opens at once', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.attach(alice, open);
  owner.offer(SHOW);
  owner.offer(MOVIE);
  assert.deepEqual(opened, [SHOW, MOVIE]);
});

test('only one link is held: a newer one replaces the one still waiting', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  owner.offer(SHOW);
  owner.attach(alice, open);
  assert.deepEqual(opened, [SHOW]);
});

test('a link is discarded when a different profile or server is chosen, and stays discarded', () => {
  for (const other of [kid, elsewhere]) {
    const {owner, opened, open} = harness();
    owner.setViewer(alice);
    owner.offer(MOVIE);
    owner.setViewer(null);
    owner.setViewer(other);
    owner.attach(other, open)();
    owner.setViewer(null);
    owner.setViewer(alice);
    owner.attach(alice, open);
    assert.deepEqual(opened, []);
  }
});

test('choosing another viewer discards a held link at once, even if that viewer\'s shell never becomes ready', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  owner.setViewer(null);
  owner.setViewer(kid);
  owner.setViewer(null);
  owner.setViewer(alice);
  owner.attach(alice, open);
  assert.deepEqual(opened, []);
});

test('a shell for another viewer never opens a link, even before the viewer change is announced', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  owner.attach(kid, open)();
  owner.attach(alice, open);
  assert.deepEqual(opened, []);
});

test('a link that arrives with nobody signed in belongs to the first viewer chosen', () => {
  const signedIn = harness();
  signedIn.owner.offer(MOVIE);
  signedIn.owner.setViewer(alice);
  signedIn.owner.attach(alice, signedIn.open);
  assert.deepEqual(signedIn.opened, [MOVIE]);

  const changed = harness();
  changed.owner.offer(MOVIE);
  changed.owner.setViewer(alice);
  changed.owner.setViewer(kid);
  changed.owner.attach(kid, changed.open);
  assert.deepEqual(changed.opened, [], 'it was the first viewer\'s');
});

test('a link expires after ten minutes', () => {
  const fresh = harness();
  fresh.owner.setViewer(alice);
  fresh.owner.offer(MOVIE);
  fresh.pass(PENDING_LINK_LIFETIME_MS);
  fresh.owner.attach(alice, fresh.open);
  assert.deepEqual(fresh.opened, [MOVIE]);

  const stale = harness();
  stale.owner.setViewer(alice);
  stale.owner.offer(MOVIE);
  stale.pass(PENDING_LINK_LIFETIME_MS + 1);
  const detach = stale.owner.attach(alice, stale.open);
  assert.deepEqual(stale.opened, []);
  // Expired is gone, not waiting for another chance.
  detach();
  stale.owner.attach(alice, stale.open);
  assert.deepEqual(stale.opened, []);
  assert.equal(PENDING_LINK_LIFETIME_MS, 10 * 60 * 1000);
});

test('a shell that has gone no longer receives links, and an old one cannot detach its successor', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  const first = owner.attach(alice, () => { opened.push('first shell'); });
  owner.attach(alice, open);
  first();
  owner.offer(MOVIE);
  assert.deepEqual(opened, [MOVIE]);
});

test('only destinations the shell routes are held; anything else is ignored and replaces nothing', () => {
  for (const url of ['portico://item/abc', 'portico://play/abc', 'portico://device', 'portico://device?x', 'portico://account', 'portico://account/', 'portico://together/join/ABCD-1234', 'portico://join#code=c&server=s', 'portico://invite#invite=t'])
    assert.equal(routedLink(url), true, url);
  for (const url of ['', 'portico://account-return?transactionId=t', 'portico://dev/auth/welcome', 'portico://downloads', 'portico://items/abc', 'https://web.getportico.tv/media/abc', 'other://item/abc', 'portico:item/abc'])
    assert.equal(routedLink(url), false, url);
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  owner.offer('portico://account-return?transactionId=t');
  owner.offer(null);
  owner.offer(undefined);
  owner.attach(alice, open);
  assert.deepEqual(opened, [MOVIE]);
});

test('the viewer key names authority, account, profile and server, and nothing when signed out', () => {
  assert.equal(linkViewerKey(undefined), null);
  assert.equal(linkViewerKey(null), null);
  const keys = new Set([alice, kid, elsewhere, linkViewerKey({authority: 'hosted', accountId: 'a1', profileId: 'p1', serverId: 's1'}), linkViewerKey({authority: 'local', accountId: 'a2', profileId: 'p1', serverId: 's1'})]);
  assert.equal(keys.size, 5);
  assert.equal(linkViewerKey({authority: 'local', accountId: 'a1', profileId: 'p1', serverId: 's1'}), alice);
});
