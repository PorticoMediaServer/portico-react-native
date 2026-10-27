import test from 'node:test';
import assert from 'node:assert/strict';
import type {HomeDocument, HomeEntry, HomeRow} from '../../../packages/client-core/src/home';
import {createFocusRegistry, type FocusAddress} from '../src-next/kit/focus/registry';
import {createInitialRegionEntry} from '../src-next/kit/focus/initial-entry';
import {createTVPageBack} from '../src-next/screens/destinations/tv-page-back';
import {canYieldTVHomeMenu, homeMixesFocusRow, homeSpotlightFocusActions, homeStartModel, resolveTVHomeStart, type HomeMenuState} from '../src-next/screens/home/home-start';
import {tvFocusIds, tvHomeRegionMap} from '../src-next/shell/tv-focus';

// Actual registry and Back owner; host focus delivery is explicit and synchronous.
// These source vectors do not exercise a native remote, focus engine or Menu bridge.
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'opening', viewerFence: 'viewer'};
const ids = tvFocusIds(authority);
const entry: HomeEntry = {id: 'song', kind: 'song', libraryId: 'music', title: 'Offered song'};
const row: HomeRow = {id: 'music', title: 'Music', kind: 'ordinary', artworkShape: 'square', viewerFence: authority.viewerFence,
  endpoint: '/home/music', privacySensitivity: 'viewer', policyState: 'allowed', priority: 0, required: false, hideable: true,
  reorderable: true, critical: false, cursorCapable: false, entries: [entry], total: 1, start: 0, limit: 20, hasMore: false,
  nextCursor: '', revision: {catalog: 1, viewer: 1}};
function document(rows: readonly HomeRow[] = [], spotlight: HomeDocument['spotlight'] = []): HomeDocument {
  return {serverId: authority.serverId, viewerFence: authority.viewerFence, rows, spotlight,
    layout: {revision: 1, rowOrder: rows.map(value => value.id), hiddenRowIds: []}, revision: {catalog: 1, viewer: 1}, generatedAt: '2026-10-26T00:00:00Z'};
}
function fixture(value: HomeDocument, renderedRows = value.rows.map(item => item.id), mixesReady = false) {
  const registry = createFocusRegistry(), graph = tvHomeRegionMap(authority, renderedRows);
  registry.configure({...graph.spotlight, order: []});
  for (const region of graph.rows.values()) registry.configure(region);
  registry.configure({...graph.customize, order: ['customize']});
  const model = homeStartModel(value, authority, {mixesReady, playbackAvailable: true});
  let requests = 0;
  const attach = (address: FocusAddress) => registry.attach(address, {requestTVFocus() {requests++; registry.didFocus(address);}});
  const resolve = () => resolveTVHomeStart(registry, model);
  return {registry, graph, model, attach, resolve, requests: () => requests};
}
const clear: HomeMenuState = {home: true, visible: true, obscured: false, expanded: false, listening: false,
  scrolled: false, account: false, rail: false, chromeHidden: false, contentVisible: true, overlay: false};

test('resolved music-only Home uses its real first row; Back scrolls once and then yields', () => {
  const f = fixture(document([row])), start = {regionId: ids.row(row.id), childId: ids.entry(entry)};
  f.attach(start); f.attach(ids.last); f.registry.didFocus(ids.last);
  let top = false, scrolls = 0;
  const back = createTVPageBack(f.registry, {current: () => true, start: () => f.resolve().address,
    atTop: () => top && f.resolve().kind === 'ready', scrollTop: () => {scrolls++; top = true;}});
  assert.deepEqual(f.resolve(), {kind: 'ready', address: start});
  assert.equal(back.back(), true); assert.equal(scrolls, 1); assert.equal(f.requests(), 1);
  assert.deepEqual(f.registry.capture()?.childId, start.childId);
  assert.equal(back.back(), false); assert.equal(scrolls, 1);
  assert.equal(canYieldTVHomeMenu(f.resolve(), f.registry.capture(), clear), true);
  back.dispose();
});

test('empty resolved Home starts at Customize and the first Back already yields', () => {
  const f = fixture(document()); f.attach(ids.last); f.registry.didFocus(ids.last);
  let scrolls = 0;
  const back = createTVPageBack(f.registry, {current: () => true, start: () => f.resolve().address,
    atTop: () => f.resolve().kind === 'ready', scrollTop: () => {scrolls++;}});
  assert.deepEqual(f.resolve(), {kind: 'ready', address: ids.last});
  for (let index = 0; index < 8; index++) assert.equal(back.back(), false);
  assert.equal(scrolls, 0); assert.equal(f.requests(), 0);
  assert.equal(canYieldTVHomeMenu(f.resolve(), f.registry.capture(), clear), true);
  back.dispose();
});

test('nonplayable Spotlight starts at the actual Details action, never invented Play', () => {
  const details: HomeEntry = {...entry, homeActions: {play: false, queue: false, playlist: false, collection: false,
    myList: false, favorite: false, watched: false, played: false, rating: false, editMetadata: false, refreshMetadata: false,
    delete: false, download: false, details: true, state: {watchlisted: false, favorite: false, watched: false, rating: null,
      personalRevision: 1, containerRevision: 1}, selection: {play: false, queue: false, playlist: false, collection: false,
      myList: false, favorite: false, watched: false, download: false, edit: false, refresh: false, delete: false}}};
  const f = fixture(document([], [{entry: details, reason: {kind: 'featured', text: {code: 'featured', fallback: 'Featured'}}}]));
  const actions = homeSpotlightFocusActions(details, undefined, {platform: 'tv', playbackAvailable: true});
  assert.deepEqual(actions.order, ['details']);
  f.registry.configure({...f.graph.spotlight, order: actions.order});
  assert.equal(f.resolve().kind, 'waiting', 'an offered but unattached action is still deferred');
  const address = {regionId: ids.spotlight, childId: 'details'}; f.attach(address); f.registry.didFocus(address);
  assert.deepEqual(f.resolve(), {kind: 'ready', address});
  const back = createTVPageBack(f.registry, {current: () => true, start: () => f.resolve().address,
    atTop: () => f.resolve().kind === 'ready', scrollTop() {assert.fail('already at actual Details start');}});
  assert.equal(back.back(), false); assert.equal(canYieldTVHomeMenu(f.resolve(), f.registry.capture(), clear), true);
  back.dispose();
});

test('a genuinely virtualized first row waits rather than skipping to mounted Customize', () => {
  const f = fixture(document([row])); f.attach(ids.last); f.registry.didFocus(ids.last);
  let top = false, scrolls = 0;
  const back = createTVPageBack(f.registry, {current: () => true, start: () => f.resolve().address,
    atTop: () => top && f.resolve().kind === 'ready', scrollTop: () => {top = true; scrolls++;}});
  assert.equal(f.resolve().kind, 'waiting'); assert.equal(canYieldTVHomeMenu(f.resolve(), f.registry.capture(), clear), false);
  for (let index = 0; index < 8; index++) assert.equal(back.back(), true);
  assert.equal(scrolls, 1); assert.equal(f.requests(), 0);
  const address = {regionId: ids.row(row.id), childId: ids.entry(entry)};
  f.attach(address);
  assert.equal(f.requests(), 1); assert.equal(back.back(), false);
  back.dispose();
});

test('Home start follows the committed rendered row order and skips only explicitly disabled regions', () => {
  const later = {...row, id: 'later'};
  const f = fixture(document([later, row]), [row.id, later.id]);
  const firstAddress = {regionId: ids.row(row.id), childId: ids.entry(entry)};
  const laterAddress = {regionId: ids.row(later.id), childId: ids.entry(entry)};
  f.attach(firstAddress); f.attach(laterAddress); f.attach(ids.last);
  assert.deepEqual(f.resolve().address, firstAddress, 'latest document order cannot replace the actual retained Home order');
  f.registry.configure({...f.graph.rows.get(row.id)!, enabled: false});
  assert.deepEqual(f.resolve().address, laterAddress);
});

test('real mixes are a fallback before Customize and unresolved or foreign documents never yield', () => {
  const f = fixture(document(), [homeMixesFocusRow], true), address = {regionId: ids.row(homeMixesFocusRow), childId: 'mix'};
  f.attach(address); f.attach(ids.last); assert.deepEqual(f.resolve().address, address);
  for (const value of [undefined, {...document(), serverId: 'other'}, {...document(), viewerFence: 'other'}]) {
    const start = resolveTVHomeStart(f.registry, homeStartModel(value, authority, {mixesReady: true}));
    assert.equal(start.kind, 'waiting'); assert.equal(canYieldTVHomeMenu(start, address, clear), false);
  }
});

test('Menu yields only at that same actual Home start with all other owners absent', () => {
  const f = fixture(document()); f.attach(ids.last);
  const start = f.resolve();
  assert.equal(canYieldTVHomeMenu(start, ids.last, clear), true);
  const blocked: Partial<HomeMenuState>[] = [{home: false}, {visible: false}, {obscured: true}, {expanded: true},
    {listening: true}, {scrolled: true}, {account: true}, {rail: true}, {chromeHidden: true}, {contentVisible: false}, {overlay: true}];
  for (const state of blocked) assert.equal(canYieldTVHomeMenu(start, ids.last, {...clear, ...state}), false, JSON.stringify(state));
  assert.equal(canYieldTVHomeMenu(start, undefined, clear), false);
  assert.equal(canYieldTVHomeMenu(start, {regionId: ids.rail, childId: 'home'}, clear), false);
  assert.equal(canYieldTVHomeMenu(start, {regionId: ids.row(row.id), childId: 'lower'}, clear), false);
});

test('initial Home entry uses the same deferred resolver and requests its actual row only once', () => {
  const f = fixture(document([row])), initial = createInitialRegionEntry(f.registry, ids.spotlight);
  const request = () => {const start = f.resolve(); return initial.request({active: start.kind === 'ready', primary: start.address?.regionId ?? ids.spotlight});};
  assert.equal(request(), 'waiting'); assert.equal(f.requests(), 0);
  const address = {regionId: ids.row(row.id), childId: ids.entry(entry)};
  f.attach(address); assert.equal(request(), 'requested'); assert.equal(f.requests(), 1);
  f.registry.didFocus(ids.last);
  assert.equal(request(), 'finished'); assert.equal(f.requests(), 1, 'later data/render cannot reclaim the starting row');
});
