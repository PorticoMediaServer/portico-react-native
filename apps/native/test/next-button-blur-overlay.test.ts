import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {buttonSpec} from '@portico/design';
import {createTheme} from '../src-next/kit/theme.ts';
import * as controlModel from '../src-next/kit/controls/control-model.ts';
import {glassRecipe} from '../src-next/platform/glass.ts';
import {screenModule} from './helpers/screen-harness.mjs';

type Element = React.ReactElement<Record<string, any>>;
const flatten = (value: any): Record<string, any> => Array.isArray(value) ? Object.assign({}, ...value.map(flatten)) : value ?? {};
function elements(value: any): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  return React.isValidElement<Record<string, any>>(value) ? [value, ...elements(value.props.children)] : [];
}
async function button(os: 'android' | 'ios', isTV: boolean) {
  const theme = createTheme({isTV, width: isTV ? 1920 : 390});
  const {Button} = await screenModule(new URL('../src-next/kit/controls/Button.tsx', import.meta.url), {
    react: {...React, default: React}, '@portico/design': {buttonSpec},
    'react-native': {Platform: {OS: os, isTV}, View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', StyleSheet: {create: (s: any) => s, flatten, absoluteFill: {position: 'absolute', inset: 0}}},
    './Focusable': {Focusable: 'Focusable'}, './control-model': controlModel,
    '../../platform/native-blur': {BlurView: 'BlurView', glassRecipe: () => glassRecipe(os, isTV)},
    '../theme': {useTheme: () => theme}, '../Icon': {Icon: 'Icon'},
  });
  return {theme, render(variant: 'glass' | 'icon' | 'primary' | 'text', state: {focused: boolean; hovered: boolean; pressed: boolean}) {
    const onPress = () => {};
    const content: Element = Button.render({variant, children: 'Action', onPress, accessibilityLabel: 'Action', nextFocusDown: 17}, null);
    const focus: Element = (content.type as any).render(content.props, null);
    assert.equal(focus.props.onPress, onPress); assert.equal(focus.props.nextFocusDown, 17); assert.equal(focus.props.accessibilityLabel, 'Action');
    return elements(focus.props.children(state));
  }};
}

test('actual glass and icon Buttons remove only Android dependency tint and retain every drawn theme-alpha state', async () => {
  for (const os of ['android', 'ios'] as const) for (const isTV of [false, true]) {
    const actual = await button(os, isTV);
    for (const variant of ['glass', 'icon'] as const) for (const state of [{focused: false, hovered: false, pressed: false}, {focused: false, hovered: true, pressed: false}, {focused: true, hovered: false, pressed: false}]) {
      const nodes = actual.render(variant, state), blur = nodes.filter(node => node.type === 'BlurView');
      assert.equal(blur.length, glassRecipe(os, isTV).nativeBlur ? 1 : 0);
      if (blur.length) {
        assert.equal(blur[0]!.props.blurType, 'dark'); assert.equal(blur[0]!.props.blurAmount, buttonSpec.glass.blur);
        assert.equal(blur[0]!.props.reducedTransparencyFallbackColor, actual.theme.colors.raisedHigh);
        assert.equal(Object.hasOwn(blur[0]!.props, 'overlayColor'), os === 'android');
        if (os === 'android') assert.equal(blur[0]!.props.overlayColor, 'transparent');
      }
      const alpha = state.focused && isTV ? buttonSpec.glass.focusedTvAlpha : state.hovered ? buttonSpec.glass.hoverAlpha : buttonSpec.glass.alpha;
      const fills = nodes.filter(node => node.type === 'View').map(node => flatten(node.props.style).backgroundColor).filter(Boolean);
      assert.deepEqual(fills, [controlModel.colorAlpha(actual.theme.colors.text, alpha)], `${os}/${isTV}/${variant}: retain sole drawn fill`);
    }
  }
});

test('primary and text Buttons still have no blur dependency', async () => {
  for (const os of ['android', 'ios'] as const) {
    const actual = await button(os, false);
    for (const variant of ['primary', 'text'] as const) assert.equal(actual.render(variant, {focused: false, hovered: false, pressed: false}).filter(node => node.type === 'BlurView').length, 0);
  }
});
