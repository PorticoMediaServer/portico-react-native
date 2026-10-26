import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeDownloadOpening} from '../src-next/screens/downloads/download-opening';
import {askNativeDownload, closeNativeDownload, getNativeDownloadSnapshot, nativeDownloadRequestKey, subscribeNativeDownload} from '../src-next/screens/downloads/request';

function fixture() {
  const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'one', viewerFence: 'viewer'};
  let selected = {sessionFamilyId: 'family', tokenGeneration: 'one', authorizationHorizon: 'horizon', deviceId: 'device', installationId: 'installation',
    viewer: {serverId: 'server', accountId: 'account', profileId: 'profile', authority: 'local', role: 'Owner'}};
  let route = {route: {kind: 'home'}, revision: 1}, active = true;
  const navigated: unknown[] = [];
  const context = {api: {}, authority: () => authority, session: () => selected, current: () => active,
    navigation: {getSnapshot: () => route, open: (destination: unknown, original: unknown) => navigated.push([destination, original])}};
  askNativeDownload({title: 'Film', itemId: 'item'});
  const request = getNativeDownloadSnapshot()!;
  return {context: context as never, request, navigated, authority, opening: createNativeDownloadOpening(context as never, request),
    route: () => {route = {...route, revision: route.revision + 1};},
    family: () => {selected = {...selected, sessionFamilyId: 'successor'};},
    generation: () => {selected = {...selected, tokenGeneration: 'two'};},
    retire: () => {active = false;}};
}

test('equal-valued requests have different presentation identity and an old close cannot dismiss the successor', () => {
  const f = fixture(), oldKey = nativeDownloadRequestKey(f.request);
  askNativeDownload({title: 'Film', itemId: 'item'});
  const successor = getNativeDownloadSnapshot()!;
  assert.notEqual(nativeDownloadRequestKey(successor), oldKey);
  assert.equal(f.opening.current(), false);
  assert.equal(f.opening.close(), false);
  assert.equal(getNativeDownloadSnapshot(), successor);
  closeNativeDownload(successor);
});

test('ordinary close aborts business work but inert paint remains only on its original page', () => {
  const f = fixture(), ticket = f.opening.claim()!;
  assert.ok(ticket);
  assert.equal(f.opening.close(), true);
  assert.equal(f.opening.signal.aborted, true);
  assert.equal(f.opening.owns(ticket), false);
  assert.equal(f.opening.claim(), undefined);
  assert.equal(f.opening.paintCurrent(), true);
  f.route();
  assert.equal(f.opening.paintCurrent(), false);
});

test('route occurrence, family, token generation and bootstrap retirement cannot lend a stale opening authority', () => {
  for (const change of ['route', 'family', 'generation', 'retire'] as const) {
    const f = fixture(), ticket = f.opening.claim()!;
    f[change]();
    assert.equal(f.opening.current(), false, change);
    assert.equal(f.opening.owns(ticket), false, change);
    assert.equal(f.opening.paintCurrent(), false, change);
    closeNativeDownload(f.request);
  }
});

test('the page lifetime can revoke this request even while the shell stays current', () => {
  const f = fixture(), life = new AbortController();
  let page = true;
  askNativeDownload({title: 'Film', itemId: 'item', lifetime: {signal: life.signal, isCurrent: () => page}});
  const request = getNativeDownloadSnapshot()!, opening = createNativeDownloadOpening(f.context, request);
  assert.equal(opening.current(), true);
  page = false;
  assert.equal(opening.current(), false);
  page = true; life.abort();
  assert.equal(opening.current(), false);
  assert.equal(opening.claim(), undefined);
  closeNativeDownload(request);
});

test('the mutation claim exists before a supplied currentness callback can reenter it', () => {
  const f = fixture(), life = new AbortController();
  let opening: ReturnType<typeof createNativeDownloadOpening> | undefined, reenter = false;
  let nested: object | undefined;
  askNativeDownload({title: 'Film', itemId: 'item', lifetime: {signal: life.signal, isCurrent: () => {
    if (reenter) {reenter = false; nested = opening!.claim();}
    return true;
  }}});
  const request = getNativeDownloadSnapshot()!;
  opening = createNativeDownloadOpening(f.context, request); reenter = true;
  const ticket = opening.claim();
  assert.ok(ticket); assert.equal(nested, undefined);
  assert.equal(opening.claim(), undefined);
  opening.release({}); assert.equal(opening.claim(), undefined, 'foreign finally cannot release the owner');
  opening.release(ticket); assert.ok(opening.claim());
  closeNativeDownload(request);
});

test('replacing the request inside currentness refuses the pending old claim', () => {
  const f = fixture(), life = new AbortController(); let replace = false;
  askNativeDownload({title: 'Film', itemId: 'item', lifetime: {signal: life.signal, isCurrent: () => {
    if (replace) {replace = false; askNativeDownload({title: 'Film', itemId: 'item'});}
    return true;
  }}});
  const request = getNativeDownloadSnapshot()!, opening = createNativeDownloadOpening(f.context, request);
  replace = true;
  assert.equal(opening.claim(), undefined);
  assert.equal(opening.close(), false);
  assert.notEqual(getNativeDownloadSnapshot(), request);
  closeNativeDownload();
});

test('a late result cannot acquire a successor request or release its command', async () => {
  const f = fixture(), ticket = f.opening.claim()!;
  let finish!: () => void, published = false;
  const pending = new Promise<void>(resolve => {finish = resolve;}).then(() => {
    if (f.opening.owns(ticket)) published = true;
    f.opening.release(ticket);
  });
  askNativeDownload({title: 'Film', itemId: 'item'});
  const successor = createNativeDownloadOpening(f.context, getNativeDownloadSnapshot()!), next = successor.claim()!;
  finish(); await pending;
  assert.equal(published, false);
  assert.equal(successor.owns(next), true);
  closeNativeDownload();
});

test('View downloads uses captured authority and refuses replacement during compare-close publication', () => {
  const f = fixture();
  const off = subscribeNativeDownload(() => {
    if (!getNativeDownloadSnapshot()) askNativeDownload({title: 'Successor', itemId: 'item'});
  });
  try {assert.equal(f.opening.viewDownloads(), false); assert.deepEqual(f.navigated, []);}
  finally {off(); closeNativeDownload();}
  const next = fixture();
  assert.equal(next.opening.viewDownloads(), true);
  assert.deepEqual(next.navigated, [[{kind: 'downloads'}, next.authority]]);
});

test('View downloads never borrows a changed authority after close publishes', () => {
  const f = fixture();
  const off = subscribeNativeDownload(() => {f.authority.epoch = 'successor';});
  try {assert.equal(f.opening.viewDownloads(), false); assert.deepEqual(f.navigated, []);}
  finally {off(); closeNativeDownload();}
});

test('the store freezes target and lifetime descriptors without changing the offered signal', () => {
  const life = new AbortController(), container = {kind: 'season' as const, id: 'original'};
  const lifetime = {signal: life.signal, isCurrent: () => true};
  askNativeDownload({title: 'Series', container, lifetime});
  const request = getNativeDownloadSnapshot()!;
  container.id = 'changed'; lifetime.isCurrent = () => false;
  assert.equal(request.container?.id, 'original');
  assert.equal(request.lifetime?.signal, life.signal);
  assert.equal(request.lifetime?.isCurrent(), true);
  assert.equal(Object.isFrozen(request.container), true);
  assert.equal(Object.isFrozen(request.lifetime), true);
  closeNativeDownload(request);
});
