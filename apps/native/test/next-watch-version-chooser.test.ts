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
  './TVVersionPanel': {NativeWatchTVVersionPanel: 'Panel'},
});
const text = {t: () => ''};
const rows = [{id: 'v2', primary: 'Director’s Cut', secondary: '4K Dolby Vision, Dolby TrueHD with Atmos 7.1, 58.2 GB'}, {id: 'v1', primary: '1080p', secondary: 'AAC stereo, 2.4 GB'}];
test('chooser uses one sheet or Playback-info panel focus owner, two text lines and immediate exact-row start', async () => {
  for (const tv of [false, true]) {
    isTV = tv;
    const starts: string[] = [], listeners = new Set<() => void>();
    let current = true, dismissed = 0, tree: any, finish!: (accepted: boolean) => void;
    const destination = {title: 'Play a different version', subject: 'Actual title', rows, selectedVersionId: 'v1',
      dispose: () => {current = false; for (const listener of listeners) listener();},
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

test('native conditional rows use injected technical names and actual file-default streams in grouped order', () => {
  const options: any = {itemId: 'item', versions: [
    {id: 'v2', edition: 'Director’s Cut', video: [{height: 2160}], audio: [{id: 'commentary', default: false}, {id: 'main', default: true}], sizeBytes: 58.2},
    {id: 'v1', video: [{height: 1080}], audio: [{id: 'first'}], sizeBytes: 2.4},
  ], preferred: {audioId: 'commentary'}};
  const selectedAudio: string[] = [];
  const presentation = {title: 'Play a different version',
    videoPictureName: (video: any) => video.height === 2160 ? '4K Dolby Vision' : '1080p',
    videoAudioFormatName: (audio: any) => {selectedAudio.push(audio.id); return audio.id === 'main' ? 'Dolby TrueHD with Atmos 7.1' : 'AAC stereo';},
    sizeName: (size: number) => `${size} GB`,
  };
  assert.deepEqual(nativeVersionChoices(options, 'item', text, presentation), rows);
  assert.deepEqual(selectedAudio, ['main', 'first']);
  assert.deepEqual(nativeVersionChoices(options, 'item', text, presentation, 'v2', 1), [rows[1]]);
  assert.equal(nativeVersionChoices({...options, versions: [options.versions[1]]}, 'item', text, presentation).length, 0);
  assert.equal(nativeVersionChoices({...options, versions: [options.versions[0], options.versions[0]]}, 'item', text, presentation).length, 0);
  assert.equal(nativeVersionChoices(options, 'other', text, presentation).length, 0);
});

test('chooser stays mounted while a source-changing start settles; Back cancels its actual lifetime', async () => {
  isTV = true;
  const listeners = new Set<() => void>();
  let current = true, disposed = 0, dismissed = 0, tree: any, finish!: (value: boolean) => void;
  const destination = {title: 'Play a different version', subject: 'Title: Special Edition', rows,
    isCurrent: () => current, subscribe: (f: () => void) => {listeners.add(f); return () => {listeners.delete(f);};},
    dispose: () => {disposed++;}, choose: () => new Promise<boolean>(resolve => {finish = resolve;})};
  const host = createHookHost(() => {tree = NativeVersionChooser({destination, onDismiss: () => {dismissed++;}, reportError: assert.fail});});
  host.mount();
  try {
    await act(() => {tree.props.children.props.children[0].props.onPress();});
    await act(() => {current = false; for (const listener of listeners) listener();});
    assert.equal(tree.props.open, true); assert.equal(dismissed, 0); assert.equal(disposed, 0);
    await act(() => {tree.props.onOpenChange(false);});
    assert.equal(dismissed, 1); assert.equal(disposed, 1);
    await act(() => {finish(false);});
    assert.equal(dismissed, 1);
  } finally {host.unmount();}
  assert.equal(listeners.size, 0);
});
