import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
import {shellLayout} from '../src-next/shell/model.ts';
let window = {width: 960, height: 540};
const {NativeWatchTVVersionPanel} = await screenModule(new URL('../src-next/screens/watch/TVVersionPanel.tsx', import.meta.url), {
  react: {...React, default: React}, 'react-native': {View: 'View', useWindowDimensions: () => window},
  'react-native-reanimated': {default: {View: 'Animated'}}, '../../shell/model': {shellLayout},
  '../../kit/overlays/OverlayHost': {OverlayPortal: 'Portal', useOverlayLifecycle() {}},
  '../../kit/overlays/surface': {FocusBoundary: 'Focus', PanelBackground: 'Background', SurfaceHeader: 'Header', useSurfaceMotion: () => ({present: true, style: {}, enterMs: 0})},
});
test('version760 overlay fits the existing TV canvas once at1920/960/3840/non16:9 without another picture slot', () => {
  for (const size of [{width: 1920, height: 1080}, {width: 960, height: 540}, {width: 3840, height: 2160}, {width: 1000, height: 800}]) {
    window = size; let tree: any;
    const host = createHookHost(() => {tree = NativeWatchTVVersionPanel({open: true, onOpenChange() {}, title: 'Actual localized title', children: 'Actual rows'});});
    host.mount();
    try {
      const layout = shellLayout(window.width, window.height, true), canvas = tree.props.children.props.children;
      assert.deepEqual(canvas.props.style.transform, [{scale: layout.scale}]);
      assert.equal(canvas.props.style.width, 1920); assert.equal(canvas.props.style.height, 1080);
      assert.equal(tree.props.rect.width, 760 * layout.scale);
      assert.equal(tree.props.rect.x, layout.left + 1160 * layout.scale);
      assert.equal(canvas.props.children.props.style[0].width, 760);
      assert.equal(canvas.props.children.props.children[1].type, 'Focus');
    } finally {host.unmount();}
  }
});
