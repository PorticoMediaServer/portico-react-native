import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi} from '../../../packages/client-core/src/index.ts';
import {NativeTitleController} from '../src-next/screens/watch/title-controller.ts';

const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'viewer'};
function fixture() {
  let current = authority, held: Promise<void> | undefined;
  const listeners = new Set<() => void>(), paths: URL[] = [], signals: (AbortSignal | null | undefined)[] = [], starts: any[] = [];
  const episode = (id: string) => ({id, kind: 'episode', title: id, libraryId: 'library', available: true, navigation: {view: 'item', entityId: id}, playback: {itemId: id, startMs: 17000}});
  const api = new HttpLocalApi('https://portico.test', '', async (input, init) => {
    const url = new URL(String(input)); paths.push(url); signals.push(init?.signal); await held;
    const selectedSeason = url.searchParams.get('selectedSeasonId') ?? 's1';
    const next = url.searchParams.get('cursor') === 'next';
    const entries = next ? [episode('e3')] : url.searchParams.get('playState') === 'unplayed' ? [episode('e2')] : [episode('e1'), episode('e2')];
    const revision = {catalog: 1, viewer: 1};
    return new Response(JSON.stringify({scope: {serverId: 'server', libraryId: 'library', viewerFence: 'viewer'}, revision,
      show: {id: 'show', libraryId: 'library', title: 'Actual show', libraryKind: 'tv', providerMatchStatus: 'matched'}, selected: {seasonId: selectedSeason},
      seasons: ['s1', 's2'].map((id, number) => ({id, showId: 'show', title: id, number: number + 1})), seasonTotalCount: 2, nextSeasonCursor: '',
      nextUp: episode('e2'), episodes: {scope: {serverId: 'server', libraryId: 'library', libraryKind: 'tv', viewerFence: 'viewer', view: 'season', entityId: selectedSeason}, revision,
        query: {sort: 'episode', direction: 'asc', category: '', q: '', limit: 40, searchMode: 'none'}, sections: [{id: 'episodes', type: 'list', entries, totalCount: 3, nextCursor: next ? '' : 'next'}]},
    }), {status: 200});
  });
  const controller = new NativeTitleController({api, scope: {serverId: 'server', viewerId: 'viewer'}, entry: {id: 'show', libraryId: 'library', kind: 'show', title: 'Actual show'},
    authority, current: () => current, subscribeCurrent(listener) {listeners.add(listener); return () => {listeners.delete(listener);};}, requestId: async () => 'request', playback: {start: async input => {starts.push(input);}}});
  return {controller, paths, signals, starts, hold: (value: Promise<void>) => {held = value;}, retire: () => {current = {...current, epoch: 'new'}; for (const listener of listeners) listener();}};
}

test('title reads canonical show pages, sends Hide watched and retains it through a season change', async () => {
  const d = fixture();
  try {
    await d.controller.open(); assert.equal(d.controller.getSnapshot().workspace?.phase, 'ready');
    await d.controller.moreEpisodes(); assert.deepEqual(d.controller.getSnapshot().episodes.map(entry => entry.id), ['e1', 'e2', 'e3']);
    d.controller.remember({itemId: 'e3', offset: 22});
    await d.controller.hideWatched(true);
    assert.equal(d.paths.at(-1)?.searchParams.get('playState'), 'unplayed');
    assert.equal(d.controller.getSnapshot().place.hideWatched, true);
    assert.deepEqual(d.controller.getSnapshot().episodes.map(entry => entry.id), ['e2']);
    await d.controller.season('s2');
    assert.equal(d.paths.at(-1)?.searchParams.get('selectedSeasonId'), 's2');
    assert.equal(d.paths.at(-1)?.searchParams.get('playState'), 'unplayed');
    assert.equal(d.controller.getSnapshot().place.seasonId, 's2');
  } finally {d.controller.dispose();}
});

test('show Play uses only the genuine projected continuation and its exact resume position', async () => {
  const d = fixture();
  try {
    await d.controller.open(); await d.controller.play();
    assert.equal(d.starts.length, 1); assert.deepEqual(d.starts[0].target, {itemId: 'e2', startSeconds: 17});
    await d.controller.play(d.controller.entry, true); assert.equal(d.starts.length, 1);
  } finally {d.controller.dispose();}
});

test('an authority replacement aborts a pending title request and cannot apply its filter state', async () => {
  const d = fixture();
  try {
    await d.controller.open(); let release!: () => void;
    d.hold(new Promise<void>(resolve => {release = resolve;}));
    const pending = d.controller.hideWatched(true);
    await new Promise(resolve => setImmediate(resolve)); d.retire();
    assert.equal(d.signals.at(-1)?.aborted, true);
    release(); await pending;
    assert.equal(d.controller.getSnapshot().retired, true); assert.equal(d.controller.getSnapshot().place.hideWatched, false);
  } finally {d.controller.dispose();}
});
