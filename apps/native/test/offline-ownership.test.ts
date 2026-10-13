/**
 * APP-01, APP-02 and APP-09: downloads, deferred viewing and auto-next belong to
 * the viewer that produced them.
 *
 * Every test drives the real `OfflineDownloads` against the native stub, so the
 * assertions are about what happened to the device's files and to the requests
 * actually sent to a server — not about internal bookkeeping.
 */
import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {device, crypto, emit, NativeModules} from './react-native-stub.mjs';
import {serviceText} from '../../../packages/client-core/src/presentation/service-text.ts';
import type {DownloadsService} from '../../../packages/client-core/src/index';
import type * as OfflineModule from '../src/bridge/offline-downloads.ts';

type Viewer = {authority: string; accountId: string; profileId: string; serverId: string};

const A: Viewer = {authority: 'local', accountId: 'account-a', profileId: 'profile-a', serverId: 'server-1'};
const B: Viewer = {authority: 'local', accountId: 'account-a', profileId: 'profile-b', serverId: 'server-1'};
const OTHER_SERVER: Viewer = {...A, serverId: 'server-2'};

/** Mirrors the bridge's own owner key, so each test states the expected value independently. */
const ownerKeyOf = (v: Viewer) => JSON.stringify([v.authority, v.accountId, v.profileId, v.serverId]);

/** The published signing key, so receipts actually verify in these tests. */
const KEYS = () => ({keys: [{id: 'key-1', algorithm: 'ed25519', publicKey: b64url(new Uint8Array(32)), createdAt: '2026-01-01T00:00:00.000Z', retiredAt: ''}]});
/** Acknowledges every submitted observation, as an applied server write would. */
const APPLIED = (body: any) => ({
  applied: body.entries.length, conflicts: 0,
  entries: body.entries.map((e: any) => ({playId: e.playId, itemId: e.itemId, outcome: 'applied', positionMs: e.positionMs, watched: !!e.watched, observedAt: e.observedAt})),
});

const b64url = (bytes: Uint8Array) =>
  Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const digest64 = 'a'.repeat(64);

/** A receipt in exactly the envelope `decodeDownloadReceipt` accepts. */
function receipt(opts: {id: string; viewer: Viewer; itemId: string; preparationId: string; expiresAt?: string}) {
  const claims = {
    kind: 'portico.download-receipt', version: '1', receiptId: opts.id, keyId: 'key-1',
    viewer: opts.viewer, itemId: opts.itemId, preparationId: opts.preparationId,
    quality: 'original', qualityLabel: 'Original',
    artifact: {sha256: digest64, bytes: 10},
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: opts.expiresAt ?? '2099-01-01T00:00:00.000Z',
  };
  const payload = b64url(new TextEncoder().encode(JSON.stringify(claims)));
  return {receiptId: opts.id, algorithm: 'ed25519', keyId: 'key-1', payload, signature: b64url(new Uint8Array(64)), claims, revision: 1};
}

/* ------------------------------------------------------------------------- *
 * The native module's newer contract: batched meta writes and the files that
 * travel beside a download. The shared stub predates the rewrite, so the four
 * methods (and the change event `start` emits) are added here.
 * ------------------------------------------------------------------------- */
const nativeDownloads = NativeModules.PorticoDownloads as unknown as Record<string, any>;
const baseStart = nativeDownloads.start as (request: any) => Promise<void>;
/** What `writeExtra`/`fetchExtra` saved, per entry and name. */
const extraStore = new Map<string, Map<string, string>>();
const extra = (id: string): Map<string, string> => {
  let files = extraStore.get(id);
  if (!files) { files = new Map(); extraStore.set(id, files); }
  return files;
};
nativeDownloads.start = async (request: any) => {
  await baseStart(request);
  const entry = device.entries.get(request.id);
  if (entry) emit('PorticoDownloadChanged', {...entry});
};
nativeDownloads.setMetas = async (metas: Record<string, string>) => {
  for (const [id, meta] of Object.entries(metas)) {
    const entry = device.entries.get(id);
    if (!entry) continue;
    device.entries.set(id, {...entry, meta});
    emit('PorticoDownloadChanged', {...device.entries.get(id)});
  }
};
nativeDownloads.writeExtra = async (id: string, name: string, text: string) => { extra(id).set(name, text); };
nativeDownloads.readExtra = async (id: string, name: string) => extra(id).get(name) ?? '';
nativeDownloads.fetchExtra = async (id: string, name: string, url: string) => { extra(id).set(name, url); return 'saved'; };

type Call = {path: string; method?: string; body?: any};

function server() {
  const calls: Call[] = [];
  const routes = new Map<string, (body: any) => unknown>();
  const api = {
    baseUrl: 'http://server.test',
    mediaUrl: (p: string) => 'http://server.test' + p,
    async request<T>(path: string, method?: string, body?: unknown, _signal?: AbortSignal): Promise<T> {
      calls.push({path, method, body});
      const handler = routes.get(path);
      if (!handler) throw new Error('no route: ' + path);
      return handler(body) as T;
    },
  };
  return {
    api, calls,
    route(path: string, handler: (body: any) => unknown) { routes.set(path, handler); return this; },
    sent(path: string) { return calls.filter(c => c.path === path); },
  };
}

/** What the server says a title is; a valid `parseDownloadTitle` shape. */
const TITLE = () => ({
  kind: 'movie', title: 'Item one', year: 2020, durationSeconds: 1200,
  parentId: '', parentTitle: '', groupId: '', groupTitle: '', groupNumber: null, number: null, artist: '', onServer: true,
});

/** Enough of DownloadsService for the bridge; `request`/`grant`/`bundle` are the calls it makes. */
function downloadsService(items: any[] = []) {
  const listeners = new Set<() => void>();
  const stub = {
    getSnapshot: () => ({items, requests: [] as any[], busy: [] as string[], error: undefined}),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); },
    requested: [] as any[],
    granted: [] as any[],
    nextBatch: {batchId: 'b', items: [] as any[], rejected: [], accepted: 0, duplicate: false},
    async request(target: unknown, quality: string) { stub.requested.push({target, quality}); return stub.nextBatch; },
    async grant(preparation: {id: string; itemId?: string}, renew?: string) {
      stub.granted.push({id: preparation.id, renew});
      const token = 'tok_' + preparation.id;
      return {preparationId: preparation.id, itemId: preparation.itemId ?? '', url: '/v1/downloads/artifacts/' + token, token,
        issuedAt: '2026-01-01T00:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', renewAfterSeconds: 3600, renewed: false,
        artifact: {kind: 'prepared', ref: 'r', fileName: 'f.mp4', bytes: 10, sha256: digest64, estimated: false, container: 'mp4', contentType: 'video/mp4'}};
    },
    async bundle(preparation: {id: string; itemId: string}) {
      return {preparationId: preparation.id, itemId: preparation.itemId, quality: 'original', qualityLabel: 'Original', title: TITLE(), overview: '',
        media: {container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', width: 1920, height: 1080},
        artwork: [{role: 'poster', path: 'art/poster', contentType: 'image/jpeg'}],
        chapters: [], markers: [], audio: [],
        subtitles: [{id: 'sub1', revision: 1, language: 'en', title: 'English', default: false, forced: false, files: {vtt: {path: 'sub/en.vtt', contentType: 'text/vtt'}}}]};
    },
    publish() { for (const fn of listeners) fn(); },
    dispose() {},
  };
  return stub;
}

const preparation = (id: string, itemId: string) => ({
  id, itemId, libraryId: 'lib', profileId: 'profile-a', quality: 'original', origin: 'item', state: 'ready', reason: '',
  title: TITLE(), batchId: '', revision: 1, progress: {bytesDone: 10, bytesTotal: 10, bytesTotalEstimated: false, percent: 100, etaSeconds: null},
  actions: ['remove'], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', readyAt: '', expiresAt: '',
  artifact: {kind: 'prepared', ref: 'r', fileName: 'f.mp4', bytes: 10, sha256: digest64, estimated: false, container: 'mp4', contentType: 'video/mp4'},
});

/** A fresh module instance per test: the bridge exports a singleton. */
let previousBridge: typeof OfflineModule | undefined;
async function bridge(): Promise<typeof OfflineModule> {
  previousBridge?.offlineDownloads.disconnect();
  previousBridge?.offlineDownloads.dispose();
  device.reset();
  extraStore.clear();
  crypto.accept = () => true;
  previousBridge = (await import('../src/bridge/offline-downloads.ts?v=' + Math.random())) as typeof OfflineModule;
  return previousBridge;
}
/** `connect` starts a 60-second interval; nothing may be left running. */
afterEach(() => {
  previousBridge?.offlineDownloads.disconnect();
  previousBridge?.offlineDownloads.dispose();
  previousBridge = undefined;
});
const settle = () => new Promise(done => setTimeout(done, 20));

test('deferred progress drains successive 100-item batches and preserves failed batches for retry', async () => {
  const {offlineDownloads} = await bridge();
  const owner = ownerKeyOf(A);
  const plays = Object.fromEntries(Array.from({length: 250}, (_, i) => [`play-${i}`, {playId: `play-${i}`, itemId: `item-${i}`, positionSeconds: i, observedAt: '2026-09-25T12:00:00.000Z'}]));
  device.state = JSON.stringify({version: 3, settings: {wifiOnly: true, deleteWatched: false, autoNext: false, limitBytes: 0}, plays: {[owner]: plays}, resume: {}, keys: {}, wanted: {}, nextAfter: {}, renewed: {}});
  let failSecond = true;
  let batch = 0;
  const s = server().route('/v1/downloads/receipt-keys', KEYS).route('/v1/downloads/progress', body => {
    batch++;
    if (batch === 2 && failSecond) throw new Error('network unavailable');
    return APPLIED(body);
  });
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  assert.deepEqual(s.sent('/v1/downloads/progress').map(call => call.body.entries.length), [100, 100]);
  assert.equal(offlineDownloads.getSnapshot().pendingProgress, 150);
  failSecond = false;
  await offlineDownloads.syncProgress();
  assert.deepEqual(s.sent('/v1/downloads/progress').map(call => call.body.entries.length), [100, 100, 100, 50]);
  assert.equal(offlineDownloads.getSnapshot().pendingProgress, 0);
});

test('APP-01: a refusal that only means “not your receipt” never deletes the file', async () => {
  const {offlineDownloads} = await bridge();
  const recovered = receipt({id: 'r-a2', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'refused', code: 'unknown_receipt'}]}))
    .route('/v1/downloads/receipts', (body: any) => ({results: [{preparationId: body.preparationIds[0], outcome: 'issued', code: '', receipt: recovered, titleOnServer: true}]}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();

  assert.deepEqual(device.removed, [], 'the file must survive an unknown_receipt refusal');
  assert.ok(device.entries.has('prep-a'));
  assert.equal(s.sent('/v1/downloads/receipts').length, 1, 'an unknown receipt triggers a recovery attempt instead');
});

test('APP-01: a genuine owner-scoped revocation still removes the file', async () => {
  const {offlineDownloads} = await bridge();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'refused', code: 'revoked'}]}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();

  assert.deepEqual(device.removed, ['prep-a'], 'a revoked receipt must still take the file');
});

test('APP-01: removing a download asks the server to revoke its receipt', async () => {
  const {offlineDownloads} = await bridge();
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: rA}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: rA, code: ''}]}))
    .route('/v1/downloads/receipts/revoke', () => ({}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  await offlineDownloads.remove(offlineDownloads.getSnapshot().entries[0]!);
  await settle();

  assert.deepEqual(device.removed, ['prep-a']);
  const revoked = s.sent('/v1/downloads/receipts/revoke');
  assert.equal(revoked.length, 1);
  assert.deepEqual(revoked[0]!.body.receiptIds, ['r-a']);
});

test('APP-01: another viewer’s downloads are never submitted, listed or removed', async () => {
  const {offlineDownloads} = await bridge();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});
  const rB = receipt({id: 'r-b', viewer: B, itemId: 'item-2', preparationId: 'prep-b'});
  device.seed({id: 'prep-b', itemId: 'item-2', meta: {receipt: rB}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    // Answer as the real server would if A's receipt were ever submitted by B.
    .route('/v1/downloads/receipts/revalidate', (body: any) => ({
      results: body.receiptIds.map((id: string) => id === 'r-b'
        ? {receiptId: id, outcome: 'renewed', code: '', receipt: rB}
        : {receiptId: id, outcome: 'refused', code: 'unknown_receipt'}),
    }));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, B);
  await settle();

  const sent = s.sent('/v1/downloads/receipts/revalidate');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.body.receiptIds, ['r-b'], 'only the connected viewer’s receipts go to the server');
  assert.deepEqual(device.removed, [], 'A’s file is never touched while B is signed in');
  assert.ok(device.entries.has('prep-a'), 'A’s bytes are still on the device');
  assert.deepEqual(offlineDownloads.getSnapshot().entries.map((e: {id: string}) => e.id), ['prep-b'], 'B sees their own download and none of A’s');
});

test('APP-01: an entry with no owner at all is shown to nobody', async () => {
  const {offlineDownloads} = await bridge();
  // No receipt and no recorded owner: nothing says whose copy this is.
  device.seed({id: 'prep-orphan', itemId: 'item-1'});
  // A recorded owner with no receipt yet still belongs to that viewer.
  device.seed({id: 'prep-owned', itemId: 'item-2', meta: {owner: ownerKeyOf(A)}});

  offlineDownloads.adopt(A);
  await offlineDownloads.open();
  await settle();
  assert.deepEqual(offlineDownloads.getSnapshot().entries.map((e: {id: string}) => e.id), ['prep-owned']);

  offlineDownloads.adopt(B);
  await settle();
  assert.deepEqual(offlineDownloads.getSnapshot().entries, [], 'the unowned copy is not handed to anyone');
});

test('APP-01: a native entry is read as the module reports it: folder, waiting and a held intent', async () => {
  const {offlineDownloads} = await bridge();
  device.seed({id: 'prep-a', itemId: 'item-1', dir: 'file:///docs/prep-a/', waiting: 'wifi', intent: 'hold', meta: {owner: ownerKeyOf(A), extras: ['poster']}});

  offlineDownloads.adopt(A);
  await offlineDownloads.open();
  await settle();

  const entry = offlineDownloads.getSnapshot().entries[0]!;
  assert.equal(entry.artworkUrl, 'file:///docs/prep-a/extras/poster', 'artwork is named from the entry folder');
  assert.equal(entry.waiting, 'wifi');
  assert.equal(entry.held, true, 'a held intent is the person having paused it');
});

test('APP-01: the same account on a different server is a different owner', async () => {
  const {offlineDownloads} = await bridge();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'refused', code: 'unknown_receipt'}]}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, OTHER_SERVER);
  await settle();

  assert.equal(s.sent('/v1/downloads/receipts/revalidate').length, 0, 'nothing to renew for this owner');
  assert.deepEqual(device.removed, []);
});

test('APP-01: a renewal answered after the viewer changed cannot write back', async () => {
  const {offlineDownloads} = await bridge();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});
  let release!: (value: unknown) => void;
  const held = new Promise(done => { release = done; });
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', async () => {
      await held;
      return {results: [{receiptId: 'r-a', outcome: 'refused', code: 'revoked'}]};
    });

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  // B signs in while A's revalidation is still outstanding.
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, B);
  await settle();
  release(undefined);
  await settle();

  assert.deepEqual(device.removed, [], 'a result from the previous connection must not act on the device');
});

test('APP-01: receipts are renewed at most once a day for one viewer', async () => {
  const {offlineDownloads} = await bridge();
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: rA}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: rA, code: ''}]}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  assert.equal(s.sent('/v1/downloads/receipts/revalidate').length, 1, 'the first connection renews');
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  assert.equal(s.sent('/v1/downloads/receipts/revalidate').length, 1, 'a second connection the same day does not');
});

test('APP-01: a receipt close to expiry is renewed without waiting the day', async () => {
  const {offlineDownloads} = await bridge();
  const owner = ownerKeyOf(A);
  const soon = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a', expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: soon}});
  device.state = JSON.stringify({version: 3, settings: {wifiOnly: true, deleteWatched: false, autoNext: false, limitBytes: 0}, plays: {}, resume: {}, keys: {}, wanted: {}, nextAfter: {}, renewed: {[owner]: Date.now()}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: soon, code: ''}]}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  assert.equal(s.sent('/v1/downloads/receipts/revalidate').length, 1, 'a receipt near its end is renewed at once');
});

test('APP-01: a transfer that already has an address keeps it alive by renewing its token', async () => {
  const {offlineDownloads} = await bridge();
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', state: 'downloading', meta: {receipt: rA, token: 'old-token', owner: ownerKeyOf(A)}});
  const service = downloadsService();
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: rA, code: ''}]}));

  offlineDownloads.connect(s.api as any, service as unknown as DownloadsService, A);
  await settle();
  assert.ok(service.granted.some(g => g.id === 'prep-a' && g.renew === 'old-token'), 'the address this device holds is renewed, not replaced');
});

test('APP-01: a renewal batch is written with one setMetas call and a viewer change deletes nothing', async () => {
  const {offlineDownloads} = await bridge();
  const first = receipt({id: 'r-a1', viewer: A, itemId: 'item-1', preparationId: 'prep-1'});
  const second = receipt({id: 'r-a2', viewer: A, itemId: 'item-2', preparationId: 'prep-2'});
  const third = receipt({id: 'r-a3', viewer: A, itemId: 'item-3', preparationId: 'prep-3'});
  device.seed({id: 'prep-1', itemId: 'item-1', meta: {receipt: first}});
  device.seed({id: 'prep-2', itemId: 'item-2', meta: {receipt: second}});
  device.seed({id: 'prep-3', itemId: 'item-3', meta: {receipt: third}});
  const renewed: Record<string, unknown> = {'r-a1': first, 'r-a2': second, 'r-a3': third};
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(done => { release = done; });
  const started = new Promise<void>(done => { entered = done; });
  const batches: string[][] = [];
  const original = nativeDownloads.setMetas;
  nativeDownloads.setMetas = async (metas: Record<string, string>) => { batches.push(Object.keys(metas)); await original(metas); entered(); await held; };
  try {
    const s = server()
      .route('/v1/downloads/receipt-keys', KEYS)
      .route('/v1/downloads/receipts/revalidate', (body: any) => ({results: body.receiptIds.map((id: string) => ({receiptId: id, outcome: 'renewed', receipt: renewed[id], code: ''}))}));
    offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
    await started;
    // B signs in while the batch is being written to the device.
    offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, B);
    release();
    await settle();
    assert.equal(batches.length, 1, 'a batch of renewals is written with one setMetas call');
    assert.deepEqual([...batches[0]!].sort(), ['prep-1', 'prep-2', 'prep-3']);
    assert.deepEqual(device.removed, [], 'a viewer change during the write deletes nothing');
    assert.ok(device.entries.has('prep-1') && device.entries.has('prep-2') && device.entries.has('prep-3'));
  } finally {
    release();
    nativeDownloads.setMetas = original;
  }
});

test('APP-02: offline viewing is posted for its own viewer, not whoever connects next', async () => {
  const {offlineDownloads} = await bridge();
  const claims = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: claims}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: claims, code: ''}]}))
    .route('/v1/downloads/progress', APPLIED);

  // A watches it and stops; the observation is queued.
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  s.calls.length = 0;
  emit('PorticoDownloadPlayback', {id: 'prep-a', positionSeconds: 120, durationSeconds: 1000, ended: false});
  await settle();

  // B signs in before it was ever sent.
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, B);
  await settle();
  assert.equal(s.sent('/v1/downloads/progress').length, 0, 'A’s viewing must not be submitted as B');

  // A comes back: it goes up once, attributed correctly, and is then cleared.
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  const posted = s.sent('/v1/downloads/progress');
  assert.equal(posted.length, 1);
  assert.deepEqual(posted[0]!.body.entries.map((e: {itemId: string}) => e.itemId), ['item-1']);
  assert.equal(posted[0]!.body.entries[0].positionMs, 120_000, 'the server takes positions in whole milliseconds');
  assert.equal('positionSeconds' in posted[0]!.body.entries[0], false);
  assert.ok(posted[0]!.body.entries[0].playId, 'every play is named by its own id');
  assert.equal('watched' in posted[0]!.body.entries[0], false, 'the device reports where the play stopped; the server decides if it counts');

  s.calls.length = 0;
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  assert.equal(s.sent('/v1/downloads/progress').length, 0, 'an acknowledged observation is not resent');
});

test('APP-02: a resume position does not cross between profiles', async () => {
  const {offlineDownloads} = await bridge();
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  const rB = receipt({id: 'r-b', viewer: B, itemId: 'item-1', preparationId: 'prep-b'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: rA}});
  device.seed({id: 'prep-b', itemId: 'item-1', meta: {receipt: rB}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', (body: any) => ({results: body.receiptIds.map((id: string) => ({receiptId: id, outcome: 'renewed', receipt: id === 'r-a' ? rA : rB, code: ''}))}))
    .route('/v1/downloads/progress', APPLIED);

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  emit('PorticoDownloadPlayback', {id: 'prep-a', positionSeconds: 300, durationSeconds: 1000, ended: false});
  await settle();

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, B);
  await settle();
  const entry = offlineDownloads.getSnapshot().entries.find(e => e.id === 'prep-b')!;
  assert.ok(entry, 'B sees their own copy');
  await offlineDownloads.play(entry);
  assert.deepEqual(device.played, [{id: 'prep-b', startSeconds: 0}], 'B starts at the beginning, not A’s position');
});

test('APP-01: a renewal brings the server’s position and whether the title is still on the server', async () => {
  const {offlineDownloads} = await bridge();
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: rA}});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: rA, code: '', titleOnServer: false, viewing: {positionSeconds: 200, watched: false}}]}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();

  const entry = offlineDownloads.getSnapshot().entries[0]!;
  assert.equal(entry.onServer, false, 'titleOnServer is stored and surfaced');
  assert.equal(offlineDownloads.note(entry), serviceText('downloads.offline.goneFromServer'));
  await offlineDownloads.play(entry);
  assert.deepEqual(device.played, [{id: 'prep-a', startSeconds: 200}], 'the server’s position becomes this copy’s resume point');
});

test('APP-02: a renewal does not override a play this device has not sent yet', async () => {
  const {offlineDownloads} = await bridge();
  const owner = ownerKeyOf(A);
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: rA}});
  device.state = JSON.stringify({
    version: 3, settings: {wifiOnly: true, deleteWatched: false, autoNext: false, limitBytes: 0},
    plays: {[owner]: {'play-1': {playId: 'play-1', itemId: 'item-1', positionSeconds: 300, observedAt: '2026-09-01T00:00:00.000Z'}}},
    resume: {[owner]: {'item-1': 300}}, keys: {}, wanted: {}, nextAfter: {}, renewed: {},
  });
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/progress', () => { throw new Error('offline'); })
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: rA, code: '', titleOnServer: true, viewing: {positionSeconds: 50, watched: false}}]}));

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();
  await offlineDownloads.play(offlineDownloads.getSnapshot().entries[0]!);
  assert.deepEqual(device.played, [{id: 'prep-a', startSeconds: 300}], 'the unsent play is newer than the server’s figure');
});

test('APP-02: an old bookkeeping document keeps only its settings and keys', async () => {
  const {offlineDownloads} = await bridge();
  // A document laid out for an earlier contract: only settings and the server's keys are carried
  // over; the plays, resume points, wants and next-up intents were shaped for something else.
  device.state = JSON.stringify({
    version: 2,
    settings: {wifiOnly: false, deleteWatched: true, autoNext: true, limitBytes: 1234},
    progress: {'item-1': {itemId: 'item-1', positionSeconds: 90, observedAt: '2026-01-01T00:00:00.000Z'}},
    resume: {'item-1': 90},
    wanted: {[ownerKeyOf(A)]: {'item-9': {title: 'Old want'}}},
    nextAfter: {[ownerKeyOf(A)]: {'item-1': {quality: 'original'}}},
    legacy: {progress: {}, resume: {}, wanted: {}},
    keys: {'key-1': b64url(new Uint8Array(32))},
  });
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/progress', APPLIED);

  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, A);
  await settle();

  const saved = JSON.parse(device.state);
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.settings, {wifiOnly: false, deleteWatched: true, autoNext: true, limitBytes: 1234}, 'settings are carried over');
  assert.equal(saved.keys['key-1'], b64url(new Uint8Array(32)), 'the server’s keys are carried over');
  assert.deepEqual(saved.plays, {}, 'old plays are not adopted by whoever signs in');
  assert.deepEqual(saved.resume, {}, 'nor are old resume points');
  assert.deepEqual(saved.wanted, {}, 'nor old wants');
  assert.deepEqual(saved.nextAfter, {}, 'nor old next-up intents');
  assert.equal(s.sent('/v1/downloads/progress').length, 0, 'an unowned record is never posted');
});

test('APP-09: finishing a title with auto-next on queues the next one for transfer', async () => {
  const {offlineDownloads} = await bridge();
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'});
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: rA, libraryId: 'lib'}});
  const next = preparation('prep-next', 'item-2');
  const service = downloadsService([next]);
  service.nextBatch = {batchId: 'b', items: [next], rejected: [], accepted: 1, duplicate: false};
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts/revalidate', () => ({results: [{receiptId: 'r-a', outcome: 'renewed', receipt: rA, code: ''}]}))
    .route('/v1/downloads/progress', APPLIED)
    .route('/v1/downloads/receipts', () => ({results: []}));

  offlineDownloads.connect(s.api as any, service as unknown as DownloadsService, A);
  await settle();
  await offlineDownloads.setSettings({autoNext: true});
  emit('PorticoDownloadPlayback', {id: 'prep-a', positionSeconds: 1000, durationSeconds: 1000, ended: true});
  await settle();

  assert.equal(service.requested.length, 1, 'the server is asked to prepare the next title');
  assert.deepEqual(service.requested[0].target, {nextAfterMediaId: 'item-1'});
  assert.deepEqual(device.started.map((r: {id: string}) => r.id), ['prep-next'], 'and the prepared next title is actually transferred');
  assert.equal(JSON.parse(device.started[0]!.meta).owner, ownerKeyOf(A), 'under the watching viewer');
});

test('APP-01: a transfer takes its receipt, address and title before any byte moves', async () => {
  const {offlineDownloads} = await bridge();
  const p = preparation('prep-new', 'item-9');
  const service = downloadsService([p]);
  const issued = receipt({id: 'r-new', viewer: A, itemId: 'item-9', preparationId: 'prep-new'});
  const s = server()
    .route('/v1/downloads/receipt-keys', KEYS)
    .route('/v1/downloads/receipts', (body: any) => ({results: [{preparationId: body.preparationIds[0], outcome: 'issued', code: '', receipt: issued, titleOnServer: true}]}));

  offlineDownloads.connect(s.api as any, service as unknown as DownloadsService, A);
  await settle();
  await offlineDownloads.fetch(p as any);
  await settle();

  const meta = JSON.parse(device.started[0]!.meta);
  assert.equal(meta.owner, ownerKeyOf(A), 'the owner is recorded before the bytes arrive');
  assert.equal(meta.onServer, true);
  assert.equal(meta.token, 'tok_prep-new', 'the address is the one the grant issued');
  assert.equal(meta.receipt.receiptId, 'r-new', 'the receipt is taken before the transfer starts');
  assert.equal(s.sent('/v1/downloads/receipts').length, 1);
  // What travels with the download is written beside it, too.
  assert.ok(extra('prep-new').has('bundle.json'), 'the bundle description is saved');
  assert.ok(extra('prep-new').has('poster'), 'artwork is fetched beside the file');
  assert.ok(extra('prep-new').has('sub-sub1-1.vtt'), 'subtitle files are fetched beside the file');

  // And an in-flight transfer is not listed for a different viewer.
  offlineDownloads.connect(s.api as any, downloadsService() as unknown as DownloadsService, B);
  await settle();
  assert.deepEqual(offlineDownloads.getSnapshot().entries.map((e: {id: string}) => e.id), []);
});

/* ------------------------------------------------------------------------- *
 * APP-03: a cold launch with no server still reaches this device's downloads.
 * ------------------------------------------------------------------------- */

/** What a device looks like after a previous online session: keys remembered. */
const storedWithKeys = () => JSON.stringify({
  version: 3,
  settings: {wifiOnly: true, deleteWatched: false, autoNext: false, limitBytes: 0},
  plays: {}, resume: {}, wanted: {}, nextAfter: {}, renewed: {},
  keys: {'key-1': b64url(new Uint8Array(32))},
});

test('APP-03: the saved viewer can list and play their downloads with no connection', async () => {
  const {offlineDownloads} = await bridge();
  device.state = storedWithKeys();
  device.seed({id: 'prep-a', itemId: 'item-1', title: 'Kept title', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});

  // No api, no service: exactly a cold launch behind a dead network.
  offlineDownloads.adopt(A);
  await offlineDownloads.open();
  await settle();

  const listed = offlineDownloads.getSnapshot().entries;
  assert.deepEqual(listed.map((e: {id: string}) => e.id), ['prep-a']);
  assert.equal(offlineDownloads.playable(listed[0]!), '', 'a valid receipt plays offline');
  await offlineDownloads.play(listed[0]!);
  assert.deepEqual(device.played, [{id: 'prep-a', startSeconds: 0}]);
});

test('APP-03: the offline route exposes only the saved viewer’s downloads', async () => {
  const {offlineDownloads} = await bridge();
  device.state = storedWithKeys();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});
  device.seed({id: 'prep-b', itemId: 'item-2', meta: {receipt: receipt({id: 'r-b', viewer: B, itemId: 'item-2', preparationId: 'prep-b'})}});

  offlineDownloads.adopt(B);
  await offlineDownloads.open();
  await settle();

  assert.deepEqual(offlineDownloads.getSnapshot().entries.map((e: {id: string}) => e.id), ['prep-b']);
});

test('APP-03: an expired receipt is listed but refuses to play until the server is reached', async () => {
  const {offlineDownloads} = await bridge();
  device.state = storedWithKeys();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a', expiresAt: '2026-02-01T00:00:00.000Z'})}});

  offlineDownloads.adopt(A);
  await offlineDownloads.open();
  await settle();

  const entry = offlineDownloads.getSnapshot().entries[0]!;
  assert.equal(offlineDownloads.playable(entry), serviceText('downloads.offline.needsCheckIn'));
  await assert.rejects(() => offlineDownloads.play(entry));
  assert.deepEqual(device.played, [], 'nothing was handed to the native player');
});

test('APP-03: a receipt whose signature does not verify never plays offline', async () => {
  const {offlineDownloads} = await bridge();
  crypto.accept = () => false;
  device.state = storedWithKeys();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});

  offlineDownloads.adopt(A);
  await offlineDownloads.open();
  await settle();

  const entry = offlineDownloads.getSnapshot().entries[0]!;
  assert.equal(offlineDownloads.playable(entry), serviceText('downloads.offline.needsSetup'));
  await assert.rejects(() => offlineDownloads.play(entry));
});

test('APP-03: signing out withdraws the offline list without deleting the files', async () => {
  const {offlineDownloads} = await bridge();
  device.state = storedWithKeys();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});

  offlineDownloads.adopt(A);
  await offlineDownloads.open();
  await settle();
  assert.equal(offlineDownloads.getSnapshot().entries.length, 1);

  const heldEntry = offlineDownloads.getSnapshot().entries[0]!;
  offlineDownloads.adopt(undefined);
  await assert.rejects(offlineDownloads.play(heldEntry), (e: Error) => e.message === serviceText('downloads.offline.signIn'));
  assert.deepEqual(device.played, []);
  assert.deepEqual(offlineDownloads.getSnapshot().entries, [], 'nobody is named, so nothing is listed');
  assert.ok(device.entries.has('prep-a'), 'and the bytes are still there for when they sign back in');
});

for (const change of ['server', 'signout'] as const) {
  test(`APP-02: a grant resolving after ${change} cannot start a transfer`, async () => {
    const {offlineDownloads} = await bridge();
    const first = server().route('/v1/downloads/receipt-keys', KEYS);
    const second = server().route('/v1/downloads/receipt-keys', KEYS);
    second.api.mediaUrl = p => 'http://other-server.test' + p;
    const service = downloadsService();
    const grant = service.grant;
    let release!: () => void;
    const held = new Promise<void>(done => { release = done; });
    service.grant = async p => { await held; return grant(p); };
    offlineDownloads.connect(first.api, service as unknown as DownloadsService, A);
    await settle();
    const pending = offlineDownloads.fetch(preparation('prep-held', 'item-held') as any);
    const refused = assert.rejects(pending, (e: Error) => e.message === serviceText('downloads.connectToStart'));
    if (change === 'server') offlineDownloads.connect(second.api, downloadsService() as unknown as DownloadsService, OTHER_SERVER);
    else offlineDownloads.adopt(undefined);
    release();
    await refused;
    assert.deepEqual(device.started, [], 'the old bearer grant is never dispatched after authority changes');
  });
}

test('APP-01: stale key discovery cannot publish keys after changing servers', async () => {
  const {offlineDownloads} = await bridge();
  let release!: () => void;
  const held = new Promise<void>(done => { release = done; });
  const oldKeys = {keys: [{...KEYS().keys[0]!, id: 'old-server-key'}]};
  const first = server().route('/v1/downloads/receipt-keys', async () => { await held; return oldKeys; });
  const second = server().route('/v1/downloads/receipt-keys', KEYS);
  offlineDownloads.connect(first.api, downloadsService() as unknown as DownloadsService, A);
  await settle();
  offlineDownloads.connect(second.api, downloadsService() as unknown as DownloadsService, OTHER_SERVER);
  await settle();
  release();
  await settle();
  assert.equal(JSON.parse(device.state).keys['old-server-key'], undefined);
});

test('APP-09: offline completion survives restart and only its owner retries auto-next', async () => {
  let {offlineDownloads} = await bridge();
  const rA = receipt({id: 'r-a', viewer: A, itemId: 'episode-1', preparationId: 'prep-a'});
  device.state = storedWithKeys();
  device.seed({id: 'prep-a', itemId: 'episode-1', quality: 'original', meta: {receipt: rA, libraryId: 'lib'}});
  offlineDownloads.adopt(A);
  await offlineDownloads.open();
  await offlineDownloads.setSettings({autoNext: true});
  emit('PorticoDownloadPlayback', {id: 'prep-a', positionSeconds: 100, durationSeconds: 100, ended: true});
  await settle();
  const saved = device.state;
  assert.ok(JSON.parse(saved).nextAfter[ownerKeyOf(A)]['episode-1']);
  offlineDownloads.dispose();
  ({offlineDownloads} = await bridge());
  device.state = saved;
  const next = preparation('prep-next', 'episode-2');
  const service = downloadsService([next]);
  service.nextBatch = {batchId: 'b', items: [next], rejected: [], accepted: 1, duplicate: false};
  const s = server().route('/v1/downloads/receipt-keys', KEYS).route('/v1/downloads/progress', APPLIED);
  offlineDownloads.connect(s.api, service as unknown as DownloadsService, B);
  await settle();
  assert.deepEqual(service.requested, []);
  offlineDownloads.connect(s.api, service as unknown as DownloadsService, A);
  await settle();
  assert.deepEqual(service.requested, [{target: {nextAfterMediaId: 'episode-1'}, quality: 'original'}]);
  assert.equal(device.started.length, 1);
  assert.equal(JSON.parse(device.started[0].meta).owner, ownerKeyOf(A));
  assert.deepEqual(JSON.parse(device.state).nextAfter[ownerKeyOf(A)], {});
});

test('APP-09: a failed next-episode request is retained and retried on reconnect', async () => {
  const {offlineDownloads} = await bridge();
  device.state = JSON.stringify({...JSON.parse(storedWithKeys()), settings: {autoNext: true}, nextAfter: {[ownerKeyOf(A)]: {'episode-1': {quality: 'original'}}}});
  const failing = downloadsService();
  failing.request = async () => { throw new Error('offline'); };
  const s = server().route('/v1/downloads/receipt-keys', KEYS);
  offlineDownloads.connect(s.api, failing as unknown as DownloadsService, A);
  await settle();
  assert.ok(JSON.parse(device.state).nextAfter[ownerKeyOf(A)]['episode-1']);
  const recovered = downloadsService();
  offlineDownloads.connect(s.api, recovered as unknown as DownloadsService, A);
  await settle();
  assert.equal(recovered.requested.length, 1);
  assert.deepEqual(JSON.parse(device.state).nextAfter[ownerKeyOf(A)], {});
});

test('APP-03: restoring the saved viewer loads the cold offline entry point without mounting a downloads screen', async () => {
  const {offlineDownloads} = await bridge();
  device.state = storedWithKeys();
  device.seed({id: 'prep-a', itemId: 'item-1', meta: {receipt: receipt({id: 'r-a', viewer: A, itemId: 'item-1', preparationId: 'prep-a'})}});
  offlineDownloads.adopt(A);
  await settle();
  assert.equal(offlineDownloads.getSnapshot().ready, true);
  assert.equal(offlineDownloads.getSnapshot().entries.some(e => e.state === 'ready'), true, 'the auth-screen card can now become visible without a network request');
  await offlineDownloads.play(offlineDownloads.getSnapshot().entries[0]!);
  assert.equal(device.played.length, 1);
});

test('APP-02: a completed request from an old download sheet cannot enqueue for the new viewer', async () => {
  const {offlineDownloads} = await bridge();
  const first = downloadsService();
  const next = preparation('prep-held', 'item-held');
  const second = downloadsService([next]);
  const s = server().route('/v1/downloads/receipt-keys', KEYS);
  offlineDownloads.connect(s.api, first as unknown as DownloadsService, A);
  await settle();
  offlineDownloads.connect(s.api, second as unknown as DownloadsService, B);
  await settle();
  await offlineDownloads.want(['item-held'], {title: 'Old request'}, first as unknown as DownloadsService);
  await settle();
  assert.deepEqual(device.started, []);
  assert.equal(JSON.parse(device.state).wanted[ownerKeyOf(B)]?.['item-held'], undefined);
});
