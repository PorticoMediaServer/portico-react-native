import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultI18n} from '../../../packages/i18n/src';
import {tvFocusIds} from '../src-next/shell/tv-focus';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const authority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'fence'};

test('actual Home overlays export fenced native rating controls and append genuine row See all last', async () => {
  const h = hooks(), calls: unknown[] = [];
  const row = {id: 'continue', title: 'Continue Watching', seeAll: {type: 'library', libraryId: 'movies'}};
  const state: any = {displayMembers: [{item: {kind: 'movie'}, entry: {id: 'actual'}}], rating: {value: 6, phase: 'ready'},
    menu: null, mixedEdit: false, deletion: null};
  const controller = {subscribe: () => () => {}, getSnapshot: () => state, closeMenu: () => {calls.push('close-menu');},
    setRatingValue: (value: number) => calls.push(value), submitRating: async () => {calls.push('submit-rating');}};
  const runtime = {getSnapshot: () => ({authority, account: {viewerRole: 'owner'}}), homeMenuRow: () => row,
    actions: {seeAll: (destination: unknown) => calls.push(destination)}};
  const {HomeSelectionOverlays} = await screenModule(new URL('../src-next/shell/HomeSelectionOverlays.tsx', import.meta.url), {
    react: h.react, 'react-native': {Text: 'Text', View: 'View'}, '../../../../packages/i18n/src': {defaultI18n},
    '../../../../packages/client-core/src/presentation/errors': {}, '../../../../packages/client-core/src/presentation/server-text': {serverTextLabel: (_: unknown, text: unknown, fallback: string) => text ?? fallback},
    '../kit/overlays': {Menu: 'Menu', Dialog: 'Dialog'}, '../kit/selection': {DeleteMediaDialog: 'Delete', MixedEditExplainer: 'Mixed'},
    '../kit/controls/Button': {Button: 'Button'}, '../kit/controls/Focusable': {Focusable: 'Focusable'}, '../kit/artwork': {}, '../kit/Icon': {Icon: 'Icon'},
    '../kit/theme': {useTheme: () => ({isTV: true, type: {}, colors: {}})}, '../platform/haptics': {}, './selection-display': {memberTitle: () => 'Actual title'},
    './HomeDestinationPicker': {HomeDestinationPicker: 'Picker'}, './HomeBulkEditor': {HomeBulkEditor: 'Editor'}, './tv-focus': {tvFocusIds},
  });
  const render = () => h.render(() => HomeSelectionOverlays({controller, runtime, reportError: (error: unknown) => {throw error;}}));
  const tree = render(), ids = tvFocusIds(authority), rating = nodes(tree).filter(node => node.type === 'Focusable');
  assert.deepEqual(rating.map(node => node.props.testID), [1, 2, 3, 4, 5].map(value => `${ids.surface('rating')}-stars-${value}`));
  assert.equal(nodes(tree).find(node => node.type === 'Dialog').props.testID, ids.surface('rating'));
  rating[2].props.onPress();
  assert.deepEqual(calls, [6, 'submit-rating']);
  state.menu = {windowId: 'actual-window', key: 'actual-key', member: state.displayMembers[0], groups: []};
  const menu = nodes(render()).find(node => node.type === 'Menu');
  assert.equal(menu.props.testID, ids.menu('actual-window', 'actual-key'));
  assert.equal(menu.props.items.at(-1).id, 'see-all');
  menu.props.items.at(-1).onSelect();
  assert.deepEqual(calls.slice(-2), ['close-menu', row.seeAll], 'the actual offered row descriptor reaches the existing route callback');
});
