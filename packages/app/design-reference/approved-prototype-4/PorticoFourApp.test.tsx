import React from 'react';
import ReactTestRenderer, {type ReactTestRendererJSON} from 'react-test-renderer';
import {PorticoFourApp} from './PorticoFourApp';

jest.mock('./useReducedMotion', () => ({useReducedMotion: () => true}));

jest.mock('lucide-react-native', () => {
  const ReactModule = require('react');
  const {View} = require('react-native');
  const Icon = (props: Record<string, unknown>) => ReactModule.createElement(View, props);
  return new Proxy({}, {get: () => Icon});
});

jest.mock('react-native-safe-area-context', () => {
  const ReactModule = require('react');
  const {View} = require('react-native');
  return {
    SafeAreaProvider: ({children}: {children: React.ReactNode}) => children,
    SafeAreaView: ({children, ...props}: {children: React.ReactNode}) => ReactModule.createElement(View, props, children),
    useSafeAreaInsets: () => ({bottom: 0, left: 0, right: 0, top: 0}),
  };
});

function visit(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null, assertion: (item: ReactTestRendererJSON) => void): void {
  if (!node || typeof node === 'string') {
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(child => visit(child, assertion));
    return;
  }
  assertion(node);
  node.children?.forEach(child => visit(child, assertion));
}

function collectStrings(node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null, values: string[]): void {
  if (!node) {
    return;
  }
  if (typeof node === 'string') {
    values.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach(child => collectStrings(child, values));
    return;
  }
  if (typeof node.props.accessibilityLabel === 'string') {
    values.push(node.props.accessibilityLabel);
  }
  node.children?.forEach(child => collectStrings(child, values));
}

test.each(['mobile', 'tv'] as const)('renders Prototype 4 on %s without a standing preferred-focus claim', async platform => {
  jest.useFakeTimers();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<PorticoFourApp platform={platform} />);
  });
  ReactTestRenderer.act(() => jest.runOnlyPendingTimers());

  const preferredClaims: ReactTestRendererJSON[] = [];
  visit(renderer!.toJSON(), node => {
    if (node.props.hasTVPreferredFocus === true) {
      preferredClaims.push(node);
    }
  });
  if (platform === 'tv') {
    expect(preferredClaims).toHaveLength(1);
    expect(preferredClaims[0]?.props.testID).toBe('portico-home-initial-focus');
    const initialControl = renderer!.root.findAllByProps({testID: 'portico-home-initial-focus'}).find(node => typeof node.props.onFocus === 'function');
    expect(initialControl).toBeDefined();
    ReactTestRenderer.act(() => initialControl!.props.onFocus({}));
    const claimsAfterFocus: ReactTestRendererJSON[] = [];
    visit(renderer!.toJSON(), node => {
      if (node.props.hasTVPreferredFocus === true) {
        claimsAfterFocus.push(node);
      }
    });
    expect(claimsAfterFocus).toHaveLength(0);
  } else {
    expect(preferredClaims).toHaveLength(0);
  }

  const strings: string[] = [];
  collectStrings(renderer!.toJSON(), strings);
  const output = strings.join(' | ');
  if (platform === 'tv') {
    expect(output).not.toContain('Playback destination');
    expect(output).not.toContain('Downloads');
  } else {
    expect(output).toContain('Playback destination');
    expect(output).toContain('Downloads');
  }
  ReactTestRenderer.act(() => renderer!.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('keeps inactive tvOS primary routes mounted but outside layout, input, and accessibility', async () => {
  jest.useFakeTimers();
  let renderer: ReactTestRenderer.ReactTestRenderer;
  await ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<PorticoFourApp platform="tv" />);
  });
  ReactTestRenderer.act(() => jest.runOnlyPendingTimers());

  const home = renderer!.root.findByProps({testID: 'portico-route-home'});
  const library = renderer!.root.findByProps({testID: 'portico-route-library'});
  expect(home.props.pointerEvents).toBe('auto');
  expect(home.props.accessibilityElementsHidden).toBe(false);
  expect(home.props.style).not.toContainEqual({display: 'none'});
  expect(library.props.pointerEvents).toBe('none');
  expect(library.props.accessibilityElementsHidden).toBe(true);
  expect(library.props.importantForAccessibility).toBe('no-hide-descendants');
  expect(library.props.style).toContainEqual({display: 'none'});

  ReactTestRenderer.act(() => renderer!.unmount());
  jest.clearAllTimers();
  jest.useRealTimers();
});
