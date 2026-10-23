import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {act, createHookHost} from './hook-driver.ts';
import {nativeVersionChoices} from '../src-next/screens/watch/version-options.ts';
let isTV = false;
const {NativeVersionChooser} = await screenModule(new URL('../src-next/screens/watch/VersionChooser.tsx', import.meta.url), {
  react: {...React, default: React}, 'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View'},
  '../../kit/controls': {Focusable: 'Row', Button: 'Button'}, '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}}, '../../kit/overlays': {BottomSheet: 'Sheet', SidePanel: 'Panel'},
  '../../kit/theme': {nativeType: () => ({}), useTheme: () => ({isTV, colors: {}, type: {bodyStrong: {}, body: {}}})},
});
const text = {t: () => ''};
const rows = [{id: 'v2', primary: 'Director’s Cut', secondary: '4K Dolby Vision, Dolby TrueHD with Atmos 7.1, 58.2 GB'}, {id: 'v1', primary: '1080p', secondary: '1080p, AAC stereo, 2.4 GB'}];
test('chooser uses one sheet or Playback-info panel focus owner, two text lines and immediate exact-row start', async () => {
  for (const tv of [false, true]) {
    isTV = tv;
    const starts: string[] = [], listeners = new Set<() => void>();
    let current = true, dismissed = 0, tree: any, finish!: (accepted: boolean) => void;
    const destination = {title: 'Play a different version', subject: 'Actual title', rows, selectedVersionId: 'v1',
      subscribe: (f: () => void) => {listeners.add(f); return () => {listeners.delete(f);};}, isCurrent: () => current,
      choose: (id: string) => {starts.push(id); return new Promise<boolean>(resolve => {finish = resolve;});}};
    const host = createHookHost(() => {tree = NativeVersionChooser({destination, onDismiss: () => {dismissed++;}, reportError: assert.fail});});
    host.mount();
    try {
      assert.equal(tree.type, tv ? 'Panel' : 'Sheet'); assert.equal(tree.props.title, destination.title);
      const rendered = tree.props.children.props.children;
      assert.equal(rendered.length, 2);
      assert.deepEqual(rendered.map((row: any) => React.Children.toArray(row.props.children({focused: false}).props.children).filter((child: any) => child.type === 'Text').map((text: any) => text.props.children)), rows.map(row => [row.primary, row.secondary]));
      if (tv) {assert.equal(tree.props.width, 760); assert.equal(tree.props.showClose, false); assert.equal(tree.props.description, 'Actual title');}
      else assert.ok(tree.props.headerContent);
      assert.equal(rendered[1].props.ref, tree.props.initialFocusRef);
      await act(() => {rendered[0].props.onPress(); rendered[0].props.onPress();});
      assert.deepEqual(starts, ['v2']); assert.equal(dismissed, 0);
      await act(() => {finish(true);}); assert.equal(dismissed, 1);
      // A replaced route/source closes the same destination; it cannot start again.
      await act(() => {current = false; for (const f of listeners) f();});
      await act(() => {tree.props.children.props.children[0].props.onPress();});
      assert.deepEqual(starts, ['v2']);
    } finally {host.unmount();}
    assert.equal(listeners.size, 0);
  }
});

test('canonical two-line formatter owns row text; grouped offer order, failure exclusion and menu eligibility stay independent', () => {
  const options: any = {itemId: 'item', versions: [{id: 'v2', edition: 'Director’s Cut'}, {id: 'v1'}]};
  const presentation = {title: 'Play a different version', row: (version: any) => rows.find(row => row.id === version.id)!};
  assert.deepEqual(nativeVersionChoices(options, 'item', text, presentation), rows);
  assert.deepEqual(nativeVersionChoices(options, 'item', text, presentation, 'v2', 1), [rows[1]]);
  assert.equal(nativeVersionChoices({...options, versions: [options.versions[1]]}, 'item', text, presentation).length, 0);
  assert.equal(nativeVersionChoices({...options, versions: [options.versions[0], options.versions[0]]}, 'item', text, presentation).length, 0);
  assert.equal(nativeVersionChoices(options, 'other', text, presentation).length, 0);
});
