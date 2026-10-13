/**
 * Channels (Spec — Channels and Guide §2, §8.1): the entries and where Channels opens, the guide
 * source per entry over today's `/v1/guide`, the per-source memory and the reminder rules.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {GuideWindowStore, HOUR_MS, type ChannelSource, type GuideChannelRow} from '../../../packages/client-core/src/guide/index.ts';
import {demoChannels, demoPrograms} from '../../../packages/client-core/src/guide/testing/fixture.ts';
import {ALL, LIBRARY, RECORDINGS, REMINDER_LEAD_MS, serverWideUnavailable, channelEntries, channelGuideSource, defaultEntry, liveReminders, newRawIndex, parseChannelMemory, rememberChoice, sourceName, toggledReminders, type Reminder} from '../src/app/channels-model.ts';

const SERVER = 'srv';
const NOW = Date.parse('2026-09-22T19:20:00Z');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(setImmediate); };
const source = (id: string, over: Partial<ChannelSource> = {}): ChannelSource => ({id, name: id, type: 'live', position: 0, recordAvailable: false, ...over});

// ── Entries (§2.0) ──

test('one source: no All channels, and Channels opens on it', () => {
  const sources = [source('antenna', {name: 'Antenna'})];
  assert.deepEqual(channelEntries(sources).map(e => e.id), ['antenna']);
  assert.equal(defaultEntry(sources), 'antenna');
});

test('two or more sources: All channels first, and Channels always opens there', () => {
  const sources = [source('antenna', {name: 'Antenna'}), source('sports', {name: 'Sports package', position: 1})];
  const entries = channelEntries(sources);
  assert.deepEqual(entries.map(e => e.id), [ALL, 'antenna', 'sports']);
  assert.equal(entries[0]!.name, 'All channels');
  assert.equal(defaultEntry(sources), ALL);
});

test('live sources show the owner name and a neutral glyph, never their type; Library Channels get their own mark and catalogue name', () => {
  const entries = channelEntries([source('m3u-1', {name: 'Antenna', type: 'm3u'}), source(LIBRARY, {name: 'whatever the server says', type: 'library'})]);
  assert.deepEqual(entries.find(e => e.id === 'm3u-1'), {id: 'm3u-1', name: 'Antenna', icon: 'channels', library: false});
  assert.deepEqual(entries.find(e => e.id === LIBRARY), {id: LIBRARY, name: 'Library Channels', icon: 'library', library: true});
});

test('Recordings is an entry only when a live source records', () => {
  assert.ok(!channelEntries([source('a'), source(LIBRARY, {type: 'library'})]).some(e => e.id === RECORDINGS));
  assert.equal(channelEntries([source('a', {recordAvailable: true})]).at(-1)!.id, RECORDINGS);
});

test('no sources: no entries (the destination is hidden)', () => {
  assert.deepEqual(channelEntries([]), []);
});

test('source names for All channels rows: the owner name, Library Channels by its catalogue name', () => {
  const sources = [source('antenna', {name: 'Antenna'})];
  assert.equal(sourceName(sources, 'antenna'), 'Antenna');
  assert.equal(sourceName(sources, LIBRARY), 'Library Channels');
  assert.equal(sourceName(sources, 'gone'), '');
});

// ── Memory ──

test('memory: a damaged or older record reads as empty; unknown values are dropped', () => {
  assert.deepEqual(parseChannelMemory(null), {views: {}, sorts: {}});
  assert.deepEqual(parseChannelMemory('x'), {views: {}, sorts: {}});
  assert.deepEqual(parseChannelMemory({views: {a: 'guide', b: 'grid'}, sorts: {a: 'name', b: 'rating'}}), {views: {a: 'guide'}, sorts: {a: 'name'}});
});

test('memory: view and sort are remembered per source, newest last, at most 50 of each', () => {
  let m = parseChannelMemory(undefined);
  m = rememberChoice(m, 'antenna', {view: 'list'});
  m = rememberChoice(m, 'all', {sort: 'name'});
  assert.deepEqual(m, {views: {antenna: 'list'}, sorts: {all: 'name'}});
  for (let i = 0; i < 60; i++) m = rememberChoice(m, `s${i}`, {view: 'guide'});
  m = rememberChoice(m, 's10', {view: 'list'});
  const keys = Object.keys(m.views);
  assert.equal(keys.length, 50);
  assert.equal(keys.at(-1), 's10');
  assert.ok(!('antenna' in m.views));
});

// ── Reminders ──

const reminder = (id: string, start: number): Reminder => ({programId: id, channelId: 'c1', title: 'World Tonight', channelName: 'Northwind', start});

test('reminders: toggling adds and removes; passed and malformed ones are dropped', () => {
  let next = toggledReminders([], reminder('p1', NOW + HOUR_MS), NOW);
  assert.equal(next.on, true);
  assert.deepEqual(next.list.map(r => r.programId), ['p1']);
  next = toggledReminders(next.list, reminder('p1', NOW + HOUR_MS), NOW);
  assert.equal(next.on, false);
  assert.deepEqual(next.list, []);
  assert.deepEqual(liveReminders([reminder('old', NOW - HOUR_MS), null, {programId: 3}, reminder('soon', NOW + 60_000)], NOW).map(r => r.programId), ['soon']);
  assert.equal(REMINDER_LEAD_MS, 120_000);
});

// ── The guide source per entry (§8.1 stopgap) ──

/** Current bounded channel directory and named-channel programme reads over the demo fixture. */
function guideApi(opts: {failKind?: string} = {}) {
  const requests: string[] = [];
  const library = [{id: 'lc-1', name: 'Sharks', number: '', group: ''}, {id: 'lc-2', name: 'Aardvarks', number: '', group: ''}];
  const api = {
    async request<T>(path: string): Promise<T> {
      requests.push(path);
      const url = new URL(path, 'http://x'), q = url.searchParams;
      assert.ok(url.pathname === '/v1/guide/channels' || url.pathname === '/v1/guide', 'only current guide routes are used');
      const kind = q.get('kind')!, start = q.get('start')!, end = q.get('end')!;
      if (kind === opts.failKind) throw new Error('unavailable');
      const allKinds = [
        ...demoChannels.map(c => ({...c, provenance: 'live-source', sourceId: 'antenna'})),
        ...library.map(c => ({...c, provenance: 'library-channel', sourceId: 'library-src'})),
      ];
      let all = allKinds.filter(c => (kind === 'all' || c.provenance === kind) && c.provenance !== opts.failKind);
      if (q.get('sourceId')) all = all.filter(c => c.sourceId === q.get('sourceId'));
      if (q.get('group')) all = all.filter(c => c.group === q.get('group'));
      if (q.get('channels')) all = all.filter(c => q.get('channels')!.split(',').includes(c.id));
      if (q.get('sort') === 'name') all.sort((a, b) => a.name.localeCompare(b.name));
      else all.sort((a, b) => a.provenance.localeCompare(b.provenance) * -1 || (parseFloat(a.number) || 0) - (parseFloat(b.number) || 0) || a.name.localeCompare(b.name));
      const directory = url.pathname === '/v1/guide/channels';
      const limit = Number(q.get('limit')), offset = directory ? Number(q.get('offset')) : Number(q.get('cursor') || 0) * limit;
      assert.ok(limit > 0 && limit <= 50);
      if (!directory) assert.ok(q.get('channels'), 'programme reads name only the requested channels');
      const slice = all.slice(offset, offset + limit);
      const channels = slice.map(c => ({
        ...c, generation: 'g1', logoPath: '',
        programmes: directory ? [] : demoPrograms(c.id, Date.parse(start), Date.parse(end)).map(p => ({id: p.id, channelId: c.id, title: p.title, start: new Date(p.start).toISOString(), end: new Date(p.end).toISOString(), lineage: 'provider-id', seriesId: '', episodeId: '', newEvidence: 'unknown', description: `About ${p.title}`})),
        tuneAvailable: true, recordAvailable: c.provenance === 'live-source', tuneUnavailableReason: '', recordUnavailableReason: c.provenance === 'live-source' ? '' : 'not-recordable', favorite: false, hidden: false, preferenceRevision: 0,
      }));
      const sources = ['live-source', 'library-channel'].map(provenance => ({id: provenance === 'live-source' ? 'antenna' : 'library-src', name: provenance === 'live-source' ? 'Antenna' : 'Library Channels', generation: 'g1', publishedAt: new Date(NOW).toISOString(), availableStart: '', availableEnd: '', provenance, refreshState: 'healthy'}));
      if (directory) return {protocolVersion: '1.0', serverId: SERVER, directory: {viewerFence: 'fence', revision: 'r1', total: all.length, offset, limit, channels, sources}} as T;
      return {protocolVersion: '1.0', serverId: SERVER, guide: {
        state: all.length ? 'ready' : 'no-channels', viewerFence: 'fence', start, end, timezone: q.get('timezone'), observedAt: new Date(NOW).toISOString(),
        nextCursor: offset + limit < all.length ? String(offset / limit + 1) : '', channels,
        sources,
      }} as T;
    },
  };
  return {api, requests};
}

test('All channels: live sources first in number order, then Library Channels; the raw objects are kept for tuning', async () => {
  const {api} = guideApi();
  const raw = newRawIndex();
  const src = channelGuideSource(api, SERVER, {entry: ALL, timezone: 'America/New_York', sort: 'number'}, raw, () => NOW);
  const page = await src.channels(0, 50, new AbortController().signal);
  assert.equal(page.total, demoChannels.length + 2);
  assert.deepEqual(page.items.slice(-2).map(c => [c.name, c.kind]), [['Aardvarks', 'library'], ['Sharks', 'library']]);
  const numbers = page.items.filter(c => c.kind === 'live').map(c => parseFloat(c.number)).filter(Number.isFinite);
  assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b));
  assert.ok(raw.channels.get(page.items[0]!.id));
  assert.equal(raw.programmes.size, 0);
  await src.programs(page.items.map(c => c.id), NOW, NOW + HOUR_MS, new AbortController().signal);
  assert.ok(raw.programmes.size > 0);
});

test('sort by name interleaves sources alphabetically', async () => {
  const {api} = guideApi();
  const src = channelGuideSource(api, SERVER, {entry: ALL, timezone: 'UTC', sort: 'name'}, newRawIndex(), () => NOW);
  const names = (await src.channels(0, 50, new AbortController().signal)).items.map(c => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.equal(names[0], 'Aardvarks');
});

test('one source asks only its own kind and passes the group filter', async () => {
  const {api, requests} = guideApi();
  const group = demoChannels.find(c => c.group)!.group;
  const src = channelGuideSource(api, SERVER, {entry: 'antenna', timezone: 'UTC', sort: 'number', group}, newRawIndex(), () => NOW);
  const page = await src.channels(0, 50, new AbortController().signal);
  assert.ok(page.items.length > 0 && page.items.every(c => c.group === group));
  assert.ok(requests.every(r => r.includes('kind=live-source') && r.includes('sourceId=antenna') && r.includes(`group=${encodeURIComponent(group).replace(/%20/g, '+')}`)));
});

test('the directory retains healthy sources when another is unavailable; a failed selected source surfaces the error', async () => {
  const all = channelGuideSource(guideApi({failKind: 'library-channel'}).api, SERVER, {entry: ALL, timezone: 'UTC', sort: 'number'}, newRawIndex(), () => NOW);
  assert.equal((await all.channels(0, 50, new AbortController().signal)).total, demoChannels.length);
  const one = channelGuideSource(guideApi({failKind: 'live-source'}).api, SERVER, {entry: 'antenna', timezone: 'UTC', sort: 'number'}, newRawIndex(), () => NOW);
  await assert.rejects(one.channels(0, 50, new AbortController().signal));
});

test('through the windowed store: bounded directory pages and named-channel blocks', async t => {
  const {api, requests} = guideApi();
  const src = channelGuideSource(api, SERVER, {entry: ALL, timezone: 'UTC', sort: 'number'}, newRawIndex(), () => NOW);
  const store = new GuideWindowStore({source: src, channelPageSize: 5});
  t.after(() => store.dispose());
  store.setViewport({firstRow: 0, lastRow: 15, start: NOW - 20 * 60_000, end: NOW + 2 * HOUR_MS});
  await settle();
  assert.equal(store.getSnapshot().total, demoChannels.length + 2);
  assert.ok(store.programsFor(0, NOW, NOW + HOUR_MS).complete);
  const directories = requests.filter(r => r.startsWith('/v1/guide/channels?'));
  assert.equal(directories.length, 4);
  assert.ok(directories.every(r => new URL(r, 'http://x').searchParams.get('limit') === '5'));
  assert.ok(requests.length <= 4 + 4 * 5, `${requests.length} requests`);
});

// ── FEAT-01 ──

const row = (id: string, tuneAvailable: boolean, reason = ''): GuideChannelRow => ({id, kind: 'live', number: '', name: id, group: '', favorite: false, tuneAvailable, tuneUnavailableReason: reason, recordAvailable: false, guide: 'full'});

test('server-wide: every channel unavailable for a server reason → one notice (the most basic reason wins)', () => {
  assert.equal(serverWideUnavailable([row('a', false, 'decoder_confinement_unavailable'), row('b', false, 'decoder_confinement_unavailable')]), 'platform');
  assert.equal(serverWideUnavailable([row('a', false, 'ffmpeg_not_configured'), row('b', false, 'delivery_unavailable')]), 'tools');
  assert.equal(serverWideUnavailable([row('a', false, 'channel_runtime_unavailable')]), 'delivery');
});

test('server-wide: not when one channel plays, when a reason is the channel\'s own, or with no channels', () => {
  assert.equal(serverWideUnavailable([row('a', false, 'decoder_confinement_unavailable'), row('b', true)]), null);
  assert.equal(serverWideUnavailable([row('a', false, 'decoder_confinement_unavailable'), row('b', false, 'source-unavailable')]), null);
  assert.equal(serverWideUnavailable([]), null);
});
