import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import {PrototypeUiProvider, usePrototypeUi} from './uiState';

test('viewer fence clears transient overlays, panels, search and selection state', () => {
  let ui: ReturnType<typeof usePrototypeUi> | undefined;
  function Probe() { ui = usePrototypeUi(); return null; }
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(<PrototypeUiProvider platform="mobile"><Probe /></PrototypeUiProvider>);
  });
  act(() => {
    ui?.setOverlay('profile');
    ui?.setPlayerPanel('subtitles');
    ui?.setSearchQuery('private query');
    ui?.setSelectedLibraryId('viewer-library');
    ui?.setRailExpanded(true);
    ui?.setTVAccountHubOpen(true);
  });
  act(() => ui?.resetTransientState());
  expect(ui).toMatchObject({overlay: null, playerPanel: null, railExpanded: false, searchQuery: '', selectedLibraryId: 'movies', tvAccountHubOpen: false});
  act(() => renderer!.unmount());
});
