import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {HttpLocalApi} from '../../../packages/client-core/src/index.ts';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {NativeCollectionController} from '../src-next/screens/collections/controller.ts';

const themed = {useTheme: () => ({isTV: true, colors: {ink: '#000', text: '#fff', textSecondary: '#ccc', textTertiary: '#999', raised: '#111', line: '#222', accent: '#3af', accentStrong: '#4bf'}, type: {}})};
const {NativeCollectionScreen, CollectionCard} = await screenModule(new URL('../src-next/screens/collections/CollectionScreen.tsx', import.meta.url), {
  react: {...React, default: React},
  'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => ({width: 1920, height: 1080})},
  '../../../../../packages/i18n/src': {defaultI18n},
  '../../kit/artwork': {AmbientArt: 'Ambient', Artwork: 'Artwork'}, '../../kit/cards': {PosterCard: 'Poster'},
  '../../kit/controls': {Button: 'Button', Chip: 'Chip', Focusable: 'Focusable'}, '../../kit/Icon': {Icon: 'Icon'},
  '../../kit/overlays': {Menu: 'Menu'}, '../../kit/states': {StateView: 'StateView'},
  '../../kit/browse/presentation': {browseType: (_theme: unknown, size: number) => ({fontSize: size})}, '../../kit/theme': themed,
});
const descendants = (node: any): any[] => Array.isArray(node) ? node.flatMap(descendants) : node?.props ? [node, ...descendants(node.props.children)] : [];
const projection = (sort = 'custom') => ({
  scope: {serverId: 'server', libraryId: 'library', libraryKind: 'movie', view: 'collection', entityId: 'c1', viewerFence: 'fence'},
  revision: {catalog: 1, viewer: 2}, heading: {key: 'entity.title', fallback: 'Toy Story Collection'}, navigation: [],
  query: {sort, direction: 'asc', category: '', q: '', limit: 40, searchMode: 'none'},
  sorts: [{id: 'custom', labelKey: 'sort.custom', directions: ['asc']}, {id: 'title', labelKey: 'sort.title', directions: ['asc', 'desc']}], filters: [],
  sections: [{id: 'items', type: 'grid', heading: {key: 'entity.title', fallback: 'Toy Story Collection'}, totalCount: 2, nextCursor: '',
    entries: [{id: 'm1', kind: 'movie', title: 'Toy Story', year: 1995}, {id: 'm2', kind: 'movie', title: 'Toy Story 2', year: 1999, watched: true}]}],
});

test('the collection controller reads the real collection view and its own sorts', async () => {
  const paths: string[] = [];
  const api = new HttpLocalApi('https://portico.test', '', async input => {
    const url = new URL(String(input)); paths.push(url.search);
    return new Response(JSON.stringify(projection(url.searchParams.get('sort') ?? 'custom')), {status: 200});
  });
  const controller = new NativeCollectionController({api, scope: {serverId: 'server', viewerId: 'viewer'}, libraryId: 'library', collectionId: 'c1', title: 'Fallback', current: () => true});
  try {
    assert.equal(paths.length, 0);
    await controller.open();
    const state = controller.getSnapshot();
    assert.equal(state.phase, 'ready');
    assert.equal(state.title, 'Toy Story Collection');
    assert.deepEqual(state.entries.map(entry => entry.title), ['Toy Story', 'Toy Story 2']);
    assert.equal(state.totalCount, 2);
    assert.equal(state.sort, 'custom');
    assert.deepEqual(state.sorts.map(sort => sort.id), ['custom', 'title']);
    await controller.sort('title', 'desc');
    assert.equal(paths.at(-1)?.includes('sort=title'), true);
    assert.equal(paths.at(-1)?.includes('view=collection'), true);
    assert.equal(paths.at(-1)?.includes('entityId=c1'), true);
  } finally {controller.dispose();}
});

test('TV collection draws the name, film facts, Play all, Shuffle and the real member row', () => {
  const calls: string[] = [], back: (() => boolean)[] = [];
  const state = {phase: 'ready' as const, title: 'Toy Story Collection', entries: [{id: 'm1', kind: 'movie', title: 'Toy Story', year: 1995}, {id: 'm2', kind: 'movie', title: 'Toy Story 2', year: 1999, watched: true}],
    totalCount: 2, sorts: [{id: 'custom', labelKey: 'sort.custom', directions: ['asc'] as const}, {id: 'title', labelKey: 'sort.title', directions: ['asc', 'desc'] as const}], sort: 'custom'};
  const runtime = {ambient: () => undefined, artwork: () => undefined, registerTVPageBack: (handler: () => boolean) => {back.push(handler); return () => {};}, error: () => ({})} as any;
  let tree: any;
  const host = createHookHost(() => {tree = NativeCollectionScreen({state, runtime,
    onPlay: () => calls.push('play'), onShuffle: () => calls.push('shuffle'), onSort: () => calls.push('sort'),
    onOpen: () => calls.push('open'), onBack: () => calls.push('back'), onRetry: () => calls.push('retry'), onMore: () => calls.push('more')});});
  host.mount();
  try {
    const nodes = descendants(tree);
    assert.ok(nodes.some(node => node.type === 'Text' && node.props.children === 'Toy Story Collection'));
    assert.ok(nodes.some(node => node.type === 'Text' && node.props.children === `${defaultI18n.t('next.browse.filmCount', {count: 2})} · 1995 – 1999`));
    const play = nodes.find(node => node.props.testID === 'collection-play-all');
    assert.equal(play.props.hasTVPreferredFocus, true); play.props.onPress(); assert.ok(calls.includes('play'));
    nodes.find(node => node.props.testID === 'collection-shuffle').props.onPress(); assert.ok(calls.includes('shuffle'));
    assert.equal(nodes.filter(node => node.type === CollectionCard).length, 2);
    assert.equal(nodes.find(node => node.props.testID === 'collection-sort') !== undefined, true);
    assert.equal(back.length, 1); assert.equal(back[0](), true); assert.ok(calls.includes('back'));
  } finally {host.unmount();}
});
