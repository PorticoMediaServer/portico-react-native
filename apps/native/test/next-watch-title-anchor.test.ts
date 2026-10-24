import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
const {TitleEpisode, TitleRelated} = await screenModule(new URL('../src-next/screens/watch/TitleScreen.tsx', import.meta.url), {
  react: {...React, default: React}, 'react-native': {},
  '../../../../../packages/player-core/src': {}, '../../../../../packages/client-core/src/presentation/kit-model/text': {},
  '../../../../../packages/client-core/src/presentation/kit-model': {}, '../../../../../packages/i18n/src': {},
  '../../kit/artwork': {}, '../../kit/cards': {EpisodeTile: 'EpisodeTile', PosterCard: 'PosterCard'},
  '../../kit/controls': {}, '../../kit/layout/Hero': {}, '../../kit/states': {}, './SeasonsSheet': {NativeSeasonsSheet: 'SeasonsSheet'}, './ShowSettingsSheet': {NativeShowSettingsSheet: 'ShowSettingsSheet'}, './TitleEpisodePlate': {NativeTitleEpisodePlate: 'EpisodePlate'}, './TitlePeople': {TitlePeople: 'TitlePeople'}, '../../kit/theme': {},
});
test('each real title card retains its own native ref and unchanged TV/keyboard/a11y callback shape', () => {
  for (const render of [TitleEpisode, TitleRelated]) {
    const entry = {id: 'real', kind: 'episode', title: 'Real member'}, selected: any[] = [];
    const onNavigate = () => {}, onPlay = () => {};
    const selection = {active: false, selected: false, onEnter() {}, onToggle() {}};
    let tree: any;
    const host = createHookHost(() => {tree = render({entry, title: entry.title, primaryAction: 'play', onPlay, onNavigate, selection, moreExpanded: true, more: (...args: unknown[]) => {selected.push(args);}});});
    host.mount();
    try {
      const ref = tree.props.menuAnchorRef; ref.current = {nativeTag: 42};
      assert.equal(tree.props.onMore.length, 0); tree.props.onMore();
      assert.equal(selected[0][0], entry); assert.equal(selected[0][1], ref);
      host.rerender(); assert.equal(tree.props.menuAnchorRef, ref);
      assert.equal(tree.props.selection, selection);
      assert.equal(tree.props.onPlay, onPlay); assert.equal(tree.props.onNavigate, onNavigate); assert.equal(tree.props.moreExpanded, true);
    } finally {host.unmount();}
  }
});
