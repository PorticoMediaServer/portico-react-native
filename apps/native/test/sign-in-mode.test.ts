/**
 * Signing in elsewhere while signed in (Justin, 18 Oct 2026: the browsing shell is never reachable
 * during a sign-in): the mode belongs to the viewer it was opened for, ends with them, and what is
 * kept for their return (the shell's place, the row it was opened from) is theirs alone, once.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {SignInMode} from '../src/app/sign-in-mode.ts';
import {PendingLinkOwner, linkViewerKey} from '../src/shell/pending-link.ts';

const demo = linkViewerKey({authority: 'local', accountId: 'a', profileId: 'p', serverId: 'demo'});
const home = linkViewerKey({authority: 'local', accountId: 'b', profileId: 'q', serverId: 'home'});

test('a sign-in belongs to the viewer it was opened for; nobody signed in cannot open one', () => {
  const mode = new SignInMode();
  let told = 0;
  mode.subscribe(() => told++);
  mode.open(null, {kind: 'direct'});
  assert.equal(mode.current(null), undefined);
  assert.equal(told, 0);
  mode.open(demo, {kind: 'switch', serverId: 'home'}, 'server:home');
  assert.deepEqual(mode.current(demo), {kind: 'switch', serverId: 'home'});
  assert.equal(mode.current(home), undefined, 'not another viewer\'s');
  assert.equal(mode.current(null), undefined, 'not once nobody is signed in');
  assert.equal(told, 1);
  mode.close();
  assert.equal(mode.current(demo), undefined);
  assert.equal(told, 2);
});

test('cancelled: the viewer\'s shell comes back where it was, focus on the row it was opened from, once', () => {
  const mode = new SignInMode();
  const place = {routes: [{name: 'SettingsRoot'}], index: 0};
  mode.open(demo, {kind: 'direct'}, 'direct');
  mode.keepShell(demo, place);
  assert.equal(mode.takeShell(demo), undefined, 'not while the sign-in is still showing');
  assert.equal(mode.takeOpener(demo), undefined);
  mode.close();
  mode.settle(demo);
  assert.equal(mode.takeShell(home), undefined, 'never another viewer\'s');
  assert.equal(mode.takeShell(demo), place);
  assert.equal(mode.takeShell(demo), undefined, 'once');
  assert.equal(mode.takeOpener(demo), 'direct');
  assert.equal(mode.takeOpener(demo), undefined);
  // A shell that goes for any other reason keeps nothing.
  mode.keepShell(demo, place);
  assert.equal(mode.takeShell(demo), undefined);
});

test('signed in elsewhere, or the sign-in ended meanwhile: the mode ends and nothing of the old viewer is offered to the new one', () => {
  const mode = new SignInMode();
  mode.open(demo, {kind: 'switch'}, 'switch');
  mode.keepShell(demo, {routes: []});
  mode.settle(home);
  assert.equal(mode.current(home), undefined);
  assert.equal(mode.takeShell(home), undefined);
  assert.equal(mode.takeOpener(home), undefined);
  assert.equal(mode.takeShell(demo), undefined, 'forgotten, not kept for later');
  mode.open(demo, {kind: 'direct'});
  mode.settle(null);
  assert.equal(mode.current(demo), undefined, 'their sign-in ended: the sign-in screens, not a sign-in for them');
});

test('a link arriving during the sign-in waits: the old viewer\'s shell opens it on Back, a new viewer never does', () => {
  // The shell is not mounted during the sign-in, so nothing is attached to open the link.
  for (const outcome of ['back', 'signedIn'] as const) {
    const links = new PendingLinkOwner();
    links.setViewer(demo);
    links.offer('portico://item/42');
    const opened: string[] = [];
    if (outcome === 'signedIn') links.setViewer(home);
    const detach = links.attach(outcome === 'back' ? demo! : home!, (url, taken) => { if (taken()) opened.push(url); });
    assert.deepEqual(opened, outcome === 'back' ? ['portico://item/42'] : [], outcome);
    detach();
  }
});
