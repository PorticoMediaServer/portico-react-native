/**
 * Links from outside the app (a home-screen card, Spotlight, Siri, a universal link) have one
 * owner. It reads the launch link once per process, holds at most one link until the shell can
 * open it, and opens it exactly once: for the viewer it arrived under, within ten minutes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DUPLICATE_LAUNCH_WINDOW_MS, DUPLICATE_LINK_WINDOW_MS, LinkFence, LinkInbox, PENDING_LINK_LIFETIME_MS, PendingLinkOwner, alreadyShowing, linkViewerKey, routedLink} from '../src/shell/pending-link.ts';
import {Linking} from './react-native-stub.mjs';
import {act, createHookHost} from './hook-driver.ts';
import type * as IntakeModule from '../src/shell/link-intents.ts';

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

// The launch link is read from the system, which answers when it answers. The link is the launch's:
// it keeps the time and the viewer of the moment the reading began, not of the moment it ended.

test('a launch link that is read late never opens for a viewer chosen in the meantime', () => {
  const {owner, opened, open} = harness();
  assert.equal(owner.claimInitial(), true);
  owner.setViewer(alice);
  owner.setViewer(null);
  owner.setViewer(kid);
  owner.attach(kid, open);
  owner.offerInitial(MOVIE);
  assert.deepEqual(opened, []);
  // Nor when the other viewer's shell is ready before the change of viewer is announced.
  const early = harness();
  early.owner.setViewer(alice);
  early.owner.claimInitial();
  early.owner.attach(kid, early.open);
  early.owner.offerInitial(MOVIE);
  assert.deepEqual(early.opened, []);
});

test('a launch link that is read late opens for the viewer it launched for', () => {
  const remembered = harness();
  remembered.owner.setViewer(alice);
  remembered.owner.claimInitial();
  remembered.owner.setViewer(null);
  remembered.owner.setViewer(alice);
  remembered.owner.attach(alice, remembered.open);
  remembered.owner.offerInitial(MOVIE);
  assert.deepEqual(remembered.opened, [MOVIE]);
  // Launched with nobody signed in: it is the first viewer's.
  const signedOut = harness();
  signedOut.owner.claimInitial();
  signedOut.owner.setViewer(alice);
  signedOut.owner.attach(alice, signedOut.open);
  signedOut.owner.offerInitial(MOVIE);
  assert.deepEqual(signedOut.opened, [MOVIE]);
});

test('a newer link is not replaced by the launch link when that is read late', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.claimInitial();
  owner.offer(SHOW);
  owner.offerInitial(MOVIE);
  owner.attach(alice, open);
  assert.deepEqual(opened, [SHOW]);
});

test('a launch link\'s ten minutes run from the launch, not from when it was read', () => {
  const stale = harness();
  stale.owner.setViewer(alice);
  stale.owner.claimInitial();
  stale.pass(PENDING_LINK_LIFETIME_MS + 1);
  stale.owner.offerInitial(MOVIE);
  stale.owner.attach(alice, stale.open);
  assert.deepEqual(stale.opened, []);
});

test('a launch with no link, or one that cannot be read, holds nothing and later links still open', () => {
  const {owner, opened, open} = harness();
  owner.setViewer(alice);
  owner.claimInitial();
  owner.offerInitial(null);
  owner.attach(alice, open);
  assert.deepEqual(opened, []);
  owner.offer(SHOW);
  assert.deepEqual(opened, [SHOW]);
});

// What a link's own lookups (the title, its route) do when they finally answer.

test('a link\'s late result is used only for the same viewer\'s shell and only while it is the latest link', () => {
  const fence = new LinkFence();
  assert.equal(fence.begin()(), false, 'no shell that can open links');
  fence.setViewer(alice);
  const first = fence.begin();
  assert.equal(first(), true);
  const second = fence.begin();
  assert.equal(first(), false, 'a newer link was opened');
  assert.equal(second(), true);
  fence.setViewer(alice);
  assert.equal(second(), true, 'the same viewer again changes nothing');
  fence.setViewer(kid);
  assert.equal(second(), false, 'the viewer changed');
  const third = fence.begin();
  fence.setViewer(null);
  assert.equal(third(), false, 'the shell has gone');
  fence.setViewer(kid);
  assert.equal(third(), false, 'and a new one for the same viewer does not revive it');
});

// The intake as the app mounts it, with the system slow to answer for the launch link.

async function intake() {
  let answer!: (url: string | null) => void;
  let reads = 0;
  Linking.getInitialURL = () => { reads++; return new Promise<string | null>(resolve => { answer = resolve; }); };
  const module = (await import('../src/shell/link-intents.ts?v=' + Math.random())) as typeof IntakeModule;
  const {linkIntents, useLinkIntake} = module;
  let viewer: Parameters<typeof useLinkIntake>[0];
  const host = createHookHost(() => useLinkIntake(viewer));
  host.mount();
  const select = async (next: typeof viewer) => { await act(() => { viewer = next; host.rerender(); }); };
  const opened: string[] = [];
  return {module, linkIntents, select, opened, answer: async (url: string | null) => { answer(url); await act(() => {}); }, reads: () => reads, close: () => host.unmount()};
}
const ALICE = {authority: 'local', accountId: 'a1', profileId: 'p1', serverId: 's1'};
const KID = {...ALICE, profileId: 'p2'};

test('the app\'s intake: a launch link read after the viewer changed opens for nobody', async () => {
  const app = await intake();
  try {
    await app.select(ALICE);
    await app.select(undefined);
    await app.select(KID);
    app.linkIntents.attach(kid, url => { app.opened.push(url); });
    await app.answer(MOVIE);
    assert.deepEqual(app.opened, []);
    assert.equal(app.reads(), 1);
  } finally { app.close(); }
});

test('the app\'s intake: a link that arrives while the launch link is still being read is the one that opens', async () => {
  const app = await intake();
  try {
    await app.select(ALICE);
    Linking.deliver(SHOW);
    await app.answer(MOVIE);
    app.linkIntents.attach(alice, url => { app.opened.push(url); });
    assert.deepEqual(app.opened, [SHOW]);
  } finally { app.close(); }
});

test('the app\'s intake: a launch link read late still opens for the viewer the app launched with', async () => {
  const app = await intake();
  try {
    await app.select(ALICE);
    await app.select(undefined);
    await app.select(ALICE);
    app.linkIntents.attach(alice, url => { app.opened.push(url); });
    await app.answer(MOVIE);
    assert.deepEqual(app.opened, [MOVIE]);
  } finally { app.close(); }
});

// A link stays the owner's until the shell takes it, and the same link handed over twice is one link.

test('a link handed to a shell that goes away before taking it is opened by the next shell', () => {
  const {owner, opened} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  // The first shell is handed the link and is replaced before it acts on it.
  const first = owner.attach(alice, () => {});
  first();
  owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  assert.deepEqual(opened, [MOVIE]);
});

test('a link a shell took is not handed out again when that shell goes away', () => {
  const {owner, opened} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  const detach = owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  detach();
  owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  assert.deepEqual(opened, [MOVIE]);
});

test('a link left by a shell that went away is still only for that viewer, and still expires', () => {
  const a = harness();
  a.owner.setViewer(alice);
  a.owner.offer(MOVIE);
  a.owner.attach(alice, () => {})();
  a.owner.setViewer(null);
  a.owner.setViewer(kid);
  a.owner.attach(kid, (url, taken) => { if (taken()) a.opened.push(url); })();
  a.owner.setViewer(alice);
  a.owner.attach(alice, (url, taken) => { if (taken()) a.opened.push(url); });
  assert.deepEqual(a.opened, [], 'another viewer was chosen in between');

  const b = harness();
  b.owner.setViewer(alice);
  b.owner.offer(MOVIE);
  b.owner.attach(alice, () => {})();
  b.pass(PENDING_LINK_LIFETIME_MS + 1);
  b.owner.attach(alice, (url, taken) => { if (taken()) b.opened.push(url); });
  assert.deepEqual(b.opened, [], 'ten minutes from when it arrived, not from when it was handed back');
});

test('a link that arrived with nobody signed in and was left by a shell belongs to that shell\'s viewer', () => {
  const {owner, opened} = harness();
  owner.offer(MOVIE);
  owner.attach(alice, () => {})();
  owner.attach(kid, (url, taken) => { if (taken()) opened.push(url); })();
  owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  assert.deepEqual(opened, []);
});

test('a newer link replaces one that is on its way to the shell', () => {
  const {owner, opened} = harness();
  owner.setViewer(alice);
  const pending: (() => void)[] = [];
  owner.attach(alice, (url, taken) => { pending.push(() => { if (taken()) opened.push(url); }); });
  owner.offer(MOVIE);
  owner.offer(SHOW);
  for (const run of pending) run();
  assert.deepEqual(opened, [SHOW]);
});

test('a link on its way to a shell is dropped when another viewer is chosen first', () => {
  const {owner, opened} = harness();
  owner.setViewer(alice);
  let act: (() => void) | undefined;
  const detach = owner.attach(alice, (url, taken) => { act = () => { if (taken()) opened.push(url); }; });
  owner.offer(MOVIE);
  owner.setViewer(kid);
  act?.();
  detach();
  owner.setViewer(alice);
  owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  assert.deepEqual(opened, []);
});

test('the launch link sent again as an event opens once', () => {
  const {owner, opened, pass} = harness();
  const open = (url: string, taken: () => boolean) => { if (taken()) opened.push(url); };
  owner.setViewer(alice);
  owner.attach(alice, open);
  owner.claimInitial();
  owner.offerInitial(MOVIE);
  pass(2000);
  owner.offer(MOVIE);
  assert.deepEqual(opened, [MOVIE]);
  // The same link much later is a new request.
  pass(DUPLICATE_LAUNCH_WINDOW_MS);
  owner.offer(MOVIE);
  assert.deepEqual(opened, [MOVIE, MOVIE]);
});

test('the event copy arriving before the launch link is read still opens once', () => {
  const {owner, opened} = harness();
  owner.setViewer(alice);
  owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  owner.claimInitial();
  owner.offer(MOVIE);
  owner.offerInitial(MOVIE);
  assert.deepEqual(opened, [MOVIE]);
});

test('the same link twice in quick succession is one request; a different link is not', () => {
  const {owner, opened, pass} = harness();
  owner.setViewer(alice);
  owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  owner.offer(MOVIE);
  pass(DUPLICATE_LINK_WINDOW_MS - 1);
  owner.offer(MOVIE);
  owner.offer(SHOW);
  pass(DUPLICATE_LINK_WINDOW_MS + 1);
  owner.offer(MOVIE);
  assert.deepEqual(opened, [MOVIE, SHOW, MOVIE]);
});

test('a repeated link does not bring back a link that was discarded', () => {
  const {owner, opened, pass} = harness();
  owner.setViewer(alice);
  owner.offer(MOVIE);
  owner.setViewer(kid);
  pass(1000);
  owner.offer(MOVIE);
  owner.setViewer(alice);
  owner.attach(alice, (url, taken) => { if (taken()) opened.push(url); });
  assert.deepEqual(opened, []);
});

test('a link to the page already showing is not stacked again', () => {
  assert.equal(alreadyShowing({name: 'Detail', params: {itemId: 'm1', libraryId: 'l1'}}, 'Detail', {libraryId: 'l1', itemId: 'm1'}), true);
  assert.equal(alreadyShowing({name: 'Detail', params: {itemId: 'm1', libraryId: 'l1'}}, 'Detail', {libraryId: 'l1', itemId: 'm2'}), false);
  assert.equal(alreadyShowing({name: 'Account'}, 'Account'), true);
  assert.equal(alreadyShowing({name: 'Home'}, 'Account'), false);
  assert.equal(alreadyShowing(undefined, 'Account'), false);
});

// Links for the sign-in screens come from the same reader.

test('a sign-in screen is handed a link that arrived before it was showing, once', () => {
  let now = 0;
  const inbox = new LinkInbox(1000, () => now);
  const got: string[] = [];
  inbox.offer('portico://account-return#a');
  const stop = inbox.subscribe(url => got.push(url));
  assert.deepEqual(got, ['portico://account-return#a']);
  stop();
  inbox.subscribe(url => got.push(url))();
  assert.deepEqual(got, ['portico://account-return#a'], 'not handed out twice');
  inbox.offer('portico://account-return#b');
  now = 2000;
  inbox.subscribe(url => got.push(url));
  assert.deepEqual(got, ['portico://account-return#a'], 'a link nobody took in time is forgotten');
  inbox.offer('portico://account-return#c');
  assert.deepEqual(got, ['portico://account-return#a', 'portico://account-return#c'], 'a listener gets a link as it arrives');
});

test('the app\'s intake: the launch link is read once, and a sign-in return or an invitation reaches the sign-in screens', async () => {
  const app = await intake();
  const {accountReturns, signedOutInvitations} = app.module;
  try {
    const invitation = `portico://join#code=${'I'.repeat(43)}&server=https%3A%2F%2Fdemo.getportico.tv`;
    const returns: string[] = [], invitations: string[] = [];
    // Nobody is signed in: the launch link is an invitation.
    await app.answer(invitation);
    signedOutInvitations.subscribe(url => invitations.push(url));
    assert.deepEqual(invitations, [invitation]);
    Linking.deliver('portico://account-return#transaction=t1');
    accountReturns.subscribe(url => returns.push(url));
    assert.deepEqual(returns, ['portico://account-return#transaction=t1']);
    assert.equal(app.reads(), 1);
    // The shell is handed the invitation too, once someone is signed in; a return never is.
    await app.select(ALICE);
    app.linkIntents.attach(alice, (url, taken) => { if (taken()) app.opened.push(url); });
    assert.deepEqual(app.opened, [invitation]);
  } finally { app.close(); }
});

test('the app\'s intake: an invitation that arrives while someone is signed in is the shell\'s alone', async () => {
  const app = await intake();
  try {
    const invitation = `portico://join#code=${'J'.repeat(43)}&server=https%3A%2F%2Fdemo.getportico.tv`;
    await app.answer(null);
    await app.select(ALICE);
    Linking.deliver(invitation);
    const invitations: string[] = [];
    app.module.signedOutInvitations.subscribe(url => invitations.push(url));
    assert.deepEqual(invitations, []);
  } finally { app.close(); }
});
