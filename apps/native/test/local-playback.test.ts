/** OS-07: a download plays in Portico's own player with a session that never leaves the device. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {PlaybackService, type PlaybackApi} from '../../../packages/client-core/src/index.ts';
import {LocalPlayback, isLocalSession, type LocalMedia, type LocalProgress} from '../src/bridge/local-playback.ts';
import {PlaybackQueue} from '../src/bridge/playback-paths.ts';

const tick = () => new Promise(r => setImmediate(r));
const media: LocalMedia = {entryId: 'dl1', itemId: 'movie1', playId: 'play-1', fileUrl: 'file:///var/app/Library/Application%20Support/Downloads/dl1/movie.mp4', durationSeconds: 600, startSeconds: 42};

function setup(journal?: {entries: unknown[]}) {
  const server: string[] = [];
  const progress: LocalProgress[] = [];
  const inner: PlaybackApi = {
    createPlayback: async itemId => { server.push(`create ${itemId}`); return {id: 'srv1', generation: 1, streamUrl: '/media', mode: 'direct', duration: 100, resumeSeconds: 0}; },
    progressPlayback: async id => { server.push(`progress ${id}`); },
    stopPlayback: async id => { server.push(`stop ${id}`); },
    reportRouteFailure: async id => { server.push(`route ${id}`); return {route: 'original', escalates: true}; },
  };
  const local = new LocalPlayback(p => progress.push(p));
  const store = journal ?? {entries: []};
  // As in the app: the device queue is required for server plays, and a journal is kept.
  const service = new PlaybackService(local.wrap(inner), () => 'r' + Math.random(), {
    queueRequired: true,
    seekTimeoutMs: 1000,
    journal: {load: async () => store.entries as never, save: async entries => { store.entries = entries as unknown[]; }},
  });
  return {service, local, server, progress, store};
}

async function playing(x: ReturnType<typeof setup>, at = 50) {
  await x.service.playLocal(media.itemId, x.local.session(media), media.startSeconds);
  const s = x.service.getSnapshot();
  x.service.ready(s.intentId);
  x.service.seekApplied(s.intentId, s.pendingSeek!.revision, media.startSeconds, 'playing');
  x.service.fact(x.service.getSnapshot().intentId, at, 'playing');
}

test('a download plays from its file where the viewer left off, with no queue and no server call', async () => {
  const x = setup();
  await x.service.playLocal(media.itemId, x.local.session(media), media.startSeconds);
  const s = x.service.getSnapshot();
  assert.equal(s.phase, 'starting');
  assert.ok(isLocalSession(s.session?.id));
  assert.equal(s.session?.streamUrl, media.fileUrl);
  assert.equal(s.duration, 600);
  assert.equal(s.pendingSeek?.positionSeconds, 42);
  assert.equal(s.error, undefined, 'the device queue is not needed');
  assert.deepEqual(x.server, []);
});

test('progress goes to the offline journal, and leaving stops nothing on the server', async () => {
  const x = setup();
  await playing(x, 50);
  x.service.pause();
  await tick();
  x.service.leave();
  await tick(); await tick();
  assert.deepEqual(x.server, []);
  assert.ok(x.progress.length > 0);
  const last = x.progress.at(-1)!;
  assert.equal(last.entryId, 'dl1');
  assert.equal(last.itemId, 'movie1');
  assert.equal(last.playId, 'play-1', 'the play keeps the id its local session was made with');
  assert.equal(last.durationSeconds, 600);
  assert.equal(last.ended, false);
});

test('the end is recorded as ended', async () => {
  const x = setup();
  await playing(x, 590);
  x.service.fact(x.service.getSnapshot().intentId, 600, 'ended');
  await tick(); await tick();
  assert.equal(x.progress.at(-1)?.state, 'ended');
  assert.equal(x.progress.at(-1)?.ended, true);
  assert.deepEqual(x.server, []);
});

test('a retry after an error plays the file again as a new local session, never the server', async () => {
  const x = setup();
  await playing(x, 120);
  const first = x.service.getSnapshot().session!.id;
  x.service.fail(x.service.getSnapshot().intentId, 'The file could not be read.');
  assert.equal(x.service.getSnapshot().phase, 'error');
  await x.service.retry();
  await tick();
  const s = x.service.getSnapshot();
  assert.ok(isLocalSession(s.session?.id));
  assert.notEqual(s.session?.id, first);
  assert.equal(s.pendingSeek?.positionSeconds, 120, 'from where it stopped');
  assert.ok(!x.server.some(line => line.startsWith('create') || line.startsWith('stop')), x.server.join());
});

test('an engine failure on a local file fails at once (no route escalation to report)', async () => {
  const x = setup();
  await playing(x);
  x.service.engineFailed(x.service.getSnapshot().intentId, 'decode_error', '', 'This media could not be played.');
  await tick();
  assert.equal(x.service.getSnapshot().phase, 'error');
  assert.deepEqual(x.server, []);
});

test('local ids from a journal replayed after a restart never reach the server', async () => {
  const store = {entries: [{id: 'local:dl9:3', checkpoint: {generation: 1, sequence: 4, positionSeconds: 77, state: 'paused'}}]};
  const x = setup(store);
  await x.service.startRecovery();
  await tick(); await tick(); await tick();
  assert.deepEqual(x.server, []);
  assert.deepEqual(x.progress, [], 'the offline journal already holds that position');
});

test('a play from the server after a download still goes to the server', async () => {
  const x = setup();
  await playing(x);
  const wrapped = x.local.wrap({
    createPlayback: async () => ({id: 'srv2', generation: 1, streamUrl: '/m', mode: 'direct', duration: 1, resumeSeconds: 0}),
    progressPlayback: async () => {}, stopPlayback: async () => {},
  });
  const session = await wrapped.createPlayback('movie1', 'req');
  assert.equal(session.id, 'srv2');
});

test('only a file URL can be a local session', () => {
  const local = new LocalPlayback(() => {});
  assert.throws(() => local.session({...media, fileUrl: 'https://example.com/movie.mp4'}));
});

type Fake = {disposed: number; connect: () => () => void; dispose: () => void};
const fake = (): Fake => {
  const f: Fake = {disposed: 0, connect: () => () => {}, dispose: () => { f.disposed++; }};
  return f;
};

test('a download removes the installed queue until the next play from the server', () => {
  const made: Fake[] = [];
  const queue = new PlaybackQueue(() => { const f = fake(); made.push(f); return f as never; });
  const initial = fake();
  queue.install(initial as never);
  queue.goLocal();
  assert.equal(initial.disposed, 1);
  assert.equal(queue.controller, undefined);
  assert.equal(queue.playingLocal, true);
  queue.ensure();
  assert.equal(made.length, 1);
  assert.equal(queue.controller, made[0] as never);
  assert.equal(queue.playingLocal, false);
  queue.ensure();
  assert.equal(made.length, 1, 'an installed player is kept');
});
