import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';
import type {PrototypePlatform} from '@portico-prototypes/contract';

export type OverlayId = 'library' | 'filters' | 'sort' | 'view' | 'profile' | 'scenario' | 'cast' | 'tv-pairing' | null;
export type LibraryViewMode = 'grid' | 'list';
export type PlayerPanelId = 'settings' | 'subtitles' | 'chapters' | 'friends' | 'queue' | null;

interface PrototypeUiValue {
  platform: PrototypePlatform;
  overlay: OverlayId;
  setOverlay(value: OverlayId): void;
  selectedLibraryId: string;
  setSelectedLibraryId(value: string): void;
  libraryTab: string;
  setLibraryTab(value: string): void;
  filtersEnabled: boolean;
  setFiltersEnabled(value: boolean): void;
  sort: string;
  setSort(value: string): void;
  viewMode: LibraryViewMode;
  setViewMode(value: LibraryViewMode): void;
  liveTab: string;
  setLiveTab(value: string): void;
  savedTab: string;
  setSavedTab(value: string): void;
  searchQuery: string;
  setSearchQuery(value: string): void;
  heroIndex: number;
  setHeroIndex(value: number): void;
  playerPanel: PlayerPanelId;
  setPlayerPanel(value: PlayerPanelId): void;
  railExpanded: boolean;
  setRailExpanded(value: boolean): void;
}

const PrototypeUiContext = createContext<PrototypeUiValue | undefined>(undefined);

export function PrototypeUiProvider({children, platform}: {children: React.ReactNode; platform: PrototypePlatform}) {
  const [overlay, setOverlayState] = useState<OverlayId>(null);
  const [selectedLibraryId, setSelectedLibraryId] = useState('movies');
  const [libraryTab, setLibraryTab] = useState('Discover');
  const [filtersEnabled, setFiltersEnabled] = useState(false);
  const [sort, setSort] = useState('Title');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const [liveTab, setLiveTab] = useState('Guide');
  const [savedTab, setSavedTab] = useState('Watchlist');
  const [searchQuery, setSearchQuery] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [playerPanel, setPlayerPanel] = useState<PlayerPanelId>(null);
  const [railExpanded, setRailExpanded] = useState(false);
  const setOverlay = useCallback((value: OverlayId) => {
    if (platform === 'tv' && value === 'cast') {
      return;
    }
    setOverlayState(value);
  }, [platform]);

  const value = useMemo<PrototypeUiValue>(() => ({
    platform,
    overlay,
    setOverlay,
    selectedLibraryId,
    setSelectedLibraryId,
    libraryTab,
    setLibraryTab,
    filtersEnabled,
    setFiltersEnabled,
    sort,
    setSort,
    viewMode,
    setViewMode,
    liveTab,
    setLiveTab,
    savedTab,
    setSavedTab,
    searchQuery,
    setSearchQuery,
    heroIndex,
    setHeroIndex,
    playerPanel,
    setPlayerPanel,
    railExpanded,
    setRailExpanded,
  }), [filtersEnabled, heroIndex, libraryTab, liveTab, overlay, platform, playerPanel, railExpanded, savedTab, searchQuery, selectedLibraryId, setOverlay, sort, viewMode]);

  return <PrototypeUiContext.Provider value={value}>{children}</PrototypeUiContext.Provider>;
}

export function usePrototypeUi(): PrototypeUiValue {
  const context = useContext(PrototypeUiContext);
  if (!context) {
    throw new Error('usePrototypeUi must be used within PrototypeUiProvider.');
  }
  return context;
}
