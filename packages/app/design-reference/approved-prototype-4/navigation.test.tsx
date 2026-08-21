import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {PorticoNavigationProvider, usePorticoNavigation} from './navigation';

let navigation: ReturnType<typeof usePorticoNavigation> | undefined;

function NavigationProbe() {
  navigation = usePorticoNavigation();
  return null;
}

beforeEach(() => {
  navigation = undefined;
});

test.each(['openSearch', 'openSettings', 'openSignIn', 'openRecoveryGallery'] as const)('%s does not push the same singleton route twice', method => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <PorticoNavigationProvider>
        <NavigationProbe />
      </PorticoNavigationProvider>,
    );
  });

  ReactTestRenderer.act(() => {
    navigation![method]();
    navigation![method]();
  });

  expect(navigation!.stack).toHaveLength(2);
  expect(navigation!.stack[0]).toEqual({name: 'home'});
  ReactTestRenderer.act(() => renderer!.unmount());
});

test('selecting a primary destination clears pushed routes without remounting another root destination', () => {
  let renderer: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(
      <PorticoNavigationProvider>
        <NavigationProbe />
      </PorticoNavigationProvider>,
    );
  });

  ReactTestRenderer.act(() => navigation!.openSearch());
  ReactTestRenderer.act(() => navigation!.selectPrimary('library'));

  expect(navigation!.stack).toEqual([{name: 'library'}]);
  ReactTestRenderer.act(() => renderer!.unmount());
});
