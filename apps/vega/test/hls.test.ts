/**
 * The Vega player's own HLS reader (`hls.ts`), against a stand-in media element and server: a
 * title by its playlist's seconds, a live channel by its timeline, the connection measured as the
 * segments arrive, and each way a stream can stop told apart.
 */
import test, {afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {resetServer, segment, server} from './stubs/server.mjs';
import {VideoPlayer, resetWorld, world} from './stubs/w3cmedia.mjs';
import {HlsSource, type SourceError} from '../src/bridge/hls.ts';

const base = 'http://server.test/v1/media/GRANT/';
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(what: () => boolean, ms = 4000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) { if (Date.now() > end) throw new Error('timed out waiting'); await sleep(10); }
}
const spans = (player: any): [number, number][] => player.source.buffers[0].spans;
const near = (actual: number, expected: number, slack = 0.011) => assert.ok(Math.abs(actual - expected) <= slack, `${actual} is not ${expected}`);

let open: HlsSource[] = [];
afterEach(() => { for (const source of open) source.close(); open = []; resetServer(); resetWorld(); });

function start(url: string, originMs?: number) {
  const player = new VideoPlayer() as any;
  const failures: SourceError[] = [];
  const source = new HlsSource(player, url, error => failures.push(error), originMs);
  open.push(source);
  return {player, source, failures};
}

/** A film of `count` six-second segments in fragmented MP4, whose own clock starts a second in. */
function film(count = 40, bytes = 0) {
  let text = '#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXT-X-TARGETDURATION:7\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-MAP:URI="init.mp4"\n';
  server.routes.set(base + 'init.mp4', segment({init: true}));
  for (let n = 0; n < count; n++) { text += `#EXTINF:6.000,\ns${n}.m4s\n`; server.routes.set(`${base}s${n}.m4s`, segment({pts: 1 + n * 6, duration: 6, bytes})); }
  server.routes.set(base + 'index.m3u8', text + '#EXT-X-ENDLIST\n');
}

test('a title opens where it is to start and is kept filled a little ahead, no further', async () => {
  film();
  const {player, source, failures} = start(base + 'index.m3u8');
  await source.open(0);
  // The segments' own clock runs a second ahead of the playlist's: positions are the playlist's.
  assert.equal(source.elementTime(0), 1);
  player.currentTime = source.elementTime(0);
  assert.equal(source.position(), 0);
  await until(() => spans(player)[0]?.[1] === 37);
  await sleep(450);
  assert.deepEqual(spans(player), [[1, 37]]);
  assert.equal(server.log.includes(base + 's6.m4s'), false);
  near(source.bufferedSeconds(), 36);
  assert.equal(player.source.duration, 240);
  assert.deepEqual(failures, []);
});

test('a title resumed part way is filled from there, and a seek refills only when it must', async () => {
  film();
  const {player, source} = start(base + 'index.m3u8');
  await source.open(62);
  assert.equal(server.log.includes(base + 's0.m4s'), false);
  await until(() => spans(player)[0]?.[1] === 97);
  assert.deepEqual(spans(player), [[61, 97]]);
  // Inside what is held: buffered segments stay in place and are not fetched again.
  // Moving forward may fill one more segment inside the new 30-second look-ahead.
  const asked = server.log.length;
  assert.equal(source.seek(70), 71);
  await until(() => spans(player)[0]?.[1] === 103);
  assert.deepEqual(server.log.slice(asked), [base + 's16.m4s']);
  assert.deepEqual(spans(player), [[61, 103]]);
  // Outside it: emptied and filled from the segment that holds the place.
  assert.equal(source.seek(200), 201);
  await until(() => spans(player).length === 1 && spans(player)[0][0] === 199 && spans(player)[0][1] === 235);
  player.currentTime = 201;
  near(source.position(), 200);
});

test('the connection is measured from segments big enough to say something, while it is fresh', async () => {
  film(40, 100000);
  server.delay = 40;
  const {source} = start(base + 'index.m3u8');
  assert.equal(source.throughputKbps(), undefined);
  await source.open(0);
  await until(() => server.log.includes(base + 's5.m4s'));
  await sleep(120);
  const kbps = source.throughputKbps();
  // About 100 kB in about 40 ms: some 20 Mb/s. The exact figure is the test machine's.
  assert.ok(kbps !== undefined && kbps > 4000 && kbps < 40000, `measured ${kbps}`);
});

test('small segments say nothing of the connection', async () => {
  film(40, 100);
  const {source} = start(base + 'index.m3u8');
  await source.open(0);
  await until(() => server.log.includes(base + 's5.m4s'));
  assert.equal(source.throughputKbps(), undefined);
});

const origin = Date.parse('2026-10-13T18:00:00Z');
/** A channel of four-second segments. Segment n was on air n × 4 s after the origin. The
 * segments' own clock is `clock(n)`; a new programme may restart it. */
function channel(window: {first: number; count: number}, clock: (n: number) => number = n => 5000 + n * 4, more = '') {
  server.routes.set(base + 'index.m3u8', () => {
    let text = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n#EXT-X-MEDIA-SEQUENCE:${window.first}\n${more}`;
    for (let n = window.first; n < window.first + window.count; n++) text += `#EXT-X-PROGRAM-DATE-TIME:${new Date(origin + n * 4000).toISOString()}\n#EXTINF:4.000000,\ns${n}.ts\n`;
    return text;
  });
  for (let n = 0; n < 400; n++) server.routes.set(`${base}s${n}.ts`, () => (n >= window.first && n < window.first + window.count ? segment({pts: clock(n), duration: 4}) : {status: 404}));
}

test('a live channel begins behind the newest segment and says where it is on the channel\'s timeline', async () => {
  const window = {first: 100, count: 12};
  channel(window);
  const {player, source, failures} = start(base + 'index.m3u8', origin);
  await source.open(NaN);
  // Three segments behind the newest (111): segment 109, which follows nothing, so it is at zero.
  assert.equal(source.beginning(), 0);
  near(source.position(), 109 * 4);
  await until(() => spans(player)[0]?.[1] === 12);
  player.advance(5.5);
  near(source.position(), 110 * 4 + 1.5);
  assert.equal(source.throughputKbps(), undefined);
  // The playlist slides: the new segments are fetched once, by number, as they appear.
  window.first = 103;
  await until(() => spans(player)[0]?.[1] === 24, 6000);
  assert.deepEqual(server.log.filter(url => url.endsWith('.ts')).map(url => Number(/s(\d+)\.ts/.exec(url)![1])), [109, 110, 111, 112, 113, 114]);
  player.advance(14);
  near(source.position(), 113 * 4 + 3.5);
  assert.deepEqual(failures, []);
});

test('a live channel is opened at a moment on its timeline when one is asked for', async () => {
  channel({first: 100, count: 12});
  const {source} = start(base + 'index.m3u8', origin);
  await source.open(104 * 4 + 1.25);
  near(source.beginning(), 1.25);
  assert.equal(server.log.filter(url => url.endsWith('.ts'))[0], base + 's104.ts');
});

test('a live channel honours where the server says live viewing begins', async () => {
  channel({first: 100, count: 12}, undefined, '#EXT-X-START:TIME-OFFSET=-30.000000,PRECISE=YES\n');
  const {source} = start(base + 'index.m3u8', origin);
  await source.open(NaN);
  near(source.position(), 104 * 4);
});

test('seeking back on a live channel: at once inside what is held, refilled when it is not', async () => {
  channel({first: 100, count: 12});
  const {player, source} = start(base + 'index.m3u8', origin);
  await source.open(NaN);
  await until(() => spans(player)[0]?.[1] === 12);
  near(await source.seek(110 * 4 + 2), 6);
  // Twenty-odd seconds back: not held, so the buffer is emptied and filled from segment 103.
  const element = await source.seek(103 * 4 + 1);
  player.currentTime = element;
  near(source.position(), 103 * 4 + 1);
  assert.ok(server.log.includes(base + 's103.ts'));
  // A moment that has left the window is its oldest segment; one not broadcast yet is where live viewing begins.
  player.currentTime = await source.seek(10);
  near(source.position(), 100 * 4);
  player.currentTime = await source.seek(999999);
  near(source.position(), 109 * 4);
});

test('a change of programme on a device that keeps the segments\' own clock is carried across', async () => {
  world.sequenceMode = false;
  // The clock restarts at segment 105.
  channel({first: 100, count: 12}, n => (n < 105 ? 5000 + n * 4 : 100 + (n - 105) * 4));
  const {player, source, failures} = start(base + 'index.m3u8', origin);
  await source.open(103 * 4);
  assert.equal(source.beginning(), 5412);
  player.currentTime = source.beginning();
  await until(() => spans(player).length === 2 && spans(player)[0][1] === 128);
  assert.deepEqual(spans(player), [[100, 128], [5412, 5420]]);
  near(source.position(), 103 * 4);
  // Playing to the end of the first programme: playback is taken to where the next one landed.
  player.paused = false;
  player.advance(7.95);
  near(source.position(), 104 * 4 + 3.95);
  await until(() => player.currentTime < 200);
  near(player.currentTime, 100.01);
  near(source.position(), 105 * 4);
  player.advance(6);
  near(source.position(), 106 * 4 + 2);
  assert.deepEqual(failures, []);
});

test('a channel that moved on while viewing was paused goes on from the oldest segment it still has', async () => {
  const window = {first: 100, count: 12};
  channel(window);
  const {player, source, failures} = start(base + 'index.m3u8', origin);
  await source.open(100 * 4);
  // Half a minute is held and nothing more is fetched; meanwhile the channel moves a long way on.
  await until(() => spans(player)[0]?.[1] === 32);
  window.first = 200;
  await sleep(450);
  // Viewing resumes and plays on: segment 108 is gone, so the playlist is read again.
  player.advance(20);
  await until(() => server.log.includes(base + 's200.ts'), 6000);
  await until(() => spans(player)[0]?.[1] >= 36);
  assert.deepEqual(failures, []);
  player.advance(12.5);
  near(source.position(), 200 * 4 + 0.5);
});

test('what has been watched on a channel is given back', async () => {
  channel({first: 100, count: 40});
  const {player, source} = start(base + 'index.m3u8', origin);
  await source.open(100 * 4);
  await until(() => spans(player)[0]?.[1] === 32);
  // 70 s in: more is fetched ahead, and all but the last half minute behind is removed.
  player.advance(70);
  await until(() => spans(player)[0]?.[1] >= 100 && spans(player)[0][0] >= 36, 6000);
  assert.ok(spans(player)[0][0] <= 40);
  near(source.position(), 100 * 4 + 70);
});

test('each way a stream stops is told apart', async () => {
  // The server refuses: its answer is kept.
  film();
  server.routes.set(base + 's1.m4s', {status: 404});
  let run = start(base + 'index.m3u8');
  await run.source.open(0);
  await until(() => run.failures.length === 1);
  assert.deepEqual([run.failures[0].status, run.failures[0].network, run.failures[0].refused], [404, false, '']);
  run.source.close();

  // The server is busy: an answer that waiting may change.
  server.routes.set(base + 's1.m4s', {status: 500});
  run = start(base + 'index.m3u8');
  await run.source.open(0);
  await until(() => run.failures.length === 1);
  assert.deepEqual([run.failures[0].status, run.failures[0].network], [500, true]);
  run.source.close();

  // No answer at all.
  server.offline = true;
  run = start(base + 'index.m3u8');
  await run.source.open(0);
  assert.deepEqual([run.failures[0].status, run.failures[0].network, run.failures[0].refused], [0, true, '']);
  server.offline = false;

  // The media element will not take the stream, or its bytes.
  film();
  world.refuse = /video\/mp4/;
  run = start(base + 'index.m3u8');
  await run.source.open(0);
  assert.deepEqual([run.failures[0].network, run.failures[0].refused], [false, 'unsupported']);
  world.refuse = null;
  world.appendFails = true;
  run = start(base + 'index.m3u8');
  await run.source.open(0);
  assert.deepEqual([run.failures[0].network, run.failures[0].refused], [false, 'decode']);
});

test('a closed stream fetches nothing more and reports nothing', async () => {
  film();
  const {source, failures} = start(base + 'index.m3u8');
  await source.open(0);
  source.close();
  const asked = server.log.length;
  server.offline = true;
  await sleep(500);
  assert.equal(server.log.length, asked);
  assert.deepEqual(failures, []);
});

test('HLS discards a followed cross-origin response before any media is appended', async () => {
  const url = 'http://redirect-hls.test/v1/media/HLSREDIRECT/index.m3u8';
  server.routes.set(url, {status: 200, from: 'http://capture.test/index.m3u8', text: '#EXTM3U\n#EXTINF:6,\nsecret.m4s\n'});
  const {source, player, failures} = start(url);
  await source.open(0);
  assert.ok(failures.length > 0);
  assert.equal(player.source, null);
  assert.deepEqual(server.log, [url]);
});

test('a playlist cannot send its resource grant to another origin', async () => {
  const url = 'http://playlist-hls.test/v1/media/HLSPLAYLIST/index.m3u8';
  server.routes.set(url, '#EXTM3U\n#EXTINF:6,\nhttp://capture.test/v1/media/HLSPLAYLIST/s0.m4s\n#EXT-X-ENDLIST\n');
  const {source, failures} = start(url);
  await source.open(0);
  assert.ok(failures.length > 0);
  assert.deepEqual(server.log, [url]);
});
