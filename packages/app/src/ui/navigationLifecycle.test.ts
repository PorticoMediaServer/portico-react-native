import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {
  porticoRouteAccessibilityLabel,
  publishPorticoNavigationLifecycle,
  subscribePorticoNavigationLifecycle,
  usePorticoNavigationLifecycle,
} from './navigationLifecycle';

function LifecycleProbe({enabled, route}: {enabled: boolean; route: {name: 'home' | 'library'}}) {
  usePorticoNavigationLifecycle(route, 'handheld', enabled);
  return null;
}

test('publishes route lifecycle without coupling navigation to telemetry transport', () => {
  const listener = jest.fn();
  const unsubscribe = subscribePorticoNavigationLifecycle(listener);
  publishPorticoNavigationLifecycle({event: 'focus', platform: 'handheld', route: {name: 'home'}});
  expect(listener).toHaveBeenCalledWith({event: 'focus', platform: 'handheld', route: {name: 'home'}});
  unsubscribe();
  publishPorticoNavigationLifecycle({event: 'blur', platform: 'handheld', route: {name: 'home'}});
  expect(listener).toHaveBeenCalledTimes(1);
});

test('uses normalized Product Language for accessibility route names', () => {
  expect(porticoRouteAccessibilityLabel({name: 'home'})).toBe('Home');
  expect(porticoRouteAccessibilityLabel({name: 'settings'})).toBe('Settings');
});

test('does not publish synthetic Home lifecycle events for non-product phases', () => {
  const listener = jest.fn();
  const unsubscribe = subscribePorticoNavigationLifecycle(listener);
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(LifecycleProbe, {enabled: false, route: {name: 'home'}}));
  });
  expect(listener).not.toHaveBeenCalled();
  act(() => {
    renderer.update(React.createElement(LifecycleProbe, {enabled: true, route: {name: 'library'}}));
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(listener).toHaveBeenCalledWith({event: 'focus', platform: 'handheld', route: {name: 'library'}});
  act(() => {
    renderer.update(React.createElement(LifecycleProbe, {enabled: false, route: {name: 'home'}}));
  });
  expect(listener).toHaveBeenCalledTimes(2);
  expect(listener).toHaveBeenLastCalledWith({event: 'blur', platform: 'handheld', route: {name: 'library'}});
  act(() => renderer.unmount());
  unsubscribe();
});
