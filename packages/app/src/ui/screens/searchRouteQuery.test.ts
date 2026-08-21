import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {useSearchRouteQuery} from './searchRouteQuery';

describe('routed search query synchronization', () => {
  it('hydrates once, preserves edits, applies changed deep links, and clears changed route input', () => {
    const setSearchQuery = jest.fn();
    const setDebouncedQuery = jest.fn();
    const setSubmittedQuery = jest.fn();
    const setters = {setSearchQuery, setDebouncedQuery, setSubmittedQuery};
    function Probe({query}: {query?: unknown}) {
      useSearchRouteQuery(query, setters);
      return null;
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Probe, {query: '  rookie  '})); });
    expect(setSearchQuery).toHaveBeenLastCalledWith('  rookie  ');
    expect(setDebouncedQuery).toHaveBeenLastCalledWith('rookie');
    expect(setSubmittedQuery).toHaveBeenLastCalledWith('rookie');

    // A local text edit rerenders the screen while route identity is stable.
    // The route must not overwrite that user-owned input.
    setSearchQuery.mockClear();
    setDebouncedQuery.mockClear();
    setSubmittedQuery.mockClear();
    act(() => { renderer.update(React.createElement(Probe, {query: '  rookie  '})); });
    expect(setSearchQuery).not.toHaveBeenCalled();
    expect(setDebouncedQuery).not.toHaveBeenCalled();
    expect(setSubmittedQuery).not.toHaveBeenCalled();

    act(() => { renderer.update(React.createElement(Probe, {query: 'arrival'})); });
    expect(setSearchQuery).toHaveBeenLastCalledWith('arrival');
    expect(setDebouncedQuery).toHaveBeenLastCalledWith('arrival');
    expect(setSubmittedQuery).toHaveBeenLastCalledWith('arrival');

    act(() => { renderer.update(React.createElement(Probe, {query: undefined})); });
    expect(setSearchQuery).toHaveBeenLastCalledWith('');
    expect(setDebouncedQuery).toHaveBeenLastCalledWith('');
    expect(setSubmittedQuery).toHaveBeenLastCalledWith('');
    act(() => renderer.unmount());
  });

  it('does not clear user-owned state when Search opens without a route query', () => {
    const setters = {
      setSearchQuery: jest.fn(),
      setDebouncedQuery: jest.fn(),
      setSubmittedQuery: jest.fn(),
    };
    function Probe() {
      useSearchRouteQuery(undefined, setters);
      return null;
    }

    let renderer!: TestRenderer.ReactTestRenderer;
    act(() => { renderer = TestRenderer.create(React.createElement(Probe)); });
    expect(setters.setSearchQuery).not.toHaveBeenCalled();
    expect(setters.setDebouncedQuery).not.toHaveBeenCalled();
    expect(setters.setSubmittedQuery).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
