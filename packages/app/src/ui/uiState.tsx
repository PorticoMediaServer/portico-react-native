import React, {createContext, useCallback, useContext, useMemo, useState} from 'react';
import type {PrototypePlatform} from '../ui-compat/contract';
import type {LibraryFilterPredicate} from '../data/library';

export type OverlayId = 'library' | 'filters' | 'sort' | 'view' | 'profile' | 'cast' | null;
export type LibraryViewMode = 'grid' | 'list';
export type PlayerPanelId =
  | 'volume'
  | 'quality'
  | 'subtitles'
  | 'chapters'
  | 'queue'
  | 'speed'
  | 'lyrics'
  | 'sleep'
  | null;

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
  libraryFilters: LibraryFilterPredicate[];
  setLibraryFilters(value: LibraryFilterPredicate[]): void;
  sort: string;
  setSort(value: string): void;
  sortDirection: 'asc' | 'desc';
  setSortDirection(value: 'asc' | 'desc'): void;
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
  tvAccountHubOpen: boolean;
  setTVAccountHubOpen(value: boolean): void;
  /** Clears viewer-bound/transient presentation at an auth/profile fence. */
  resetTransientState(): void;
}

const PrototypeUiContext = createContext<PrototypeUiValue | undefined>(undefined);

export function PrototypeUiProvider({children, platform}: {children: React.ReactNode; platform: PrototypePlatform}) {
  const [overlay, setOverlayState] = useState<OverlayId>(null);
  const [selectedLibraryId, setSelectedLibraryId] = useState('movies');
  const [libraryTab, setLibraryTab] = useState('Discover');
  const [filtersEnabled, setFiltersEnabled] = useState(false);
  const [libraryFilters, setLibraryFilters] = useState<LibraryFilterPredicate[]>([]);
  const [sort, setSort] = useState('Title');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const [liveTab, setLiveTab] = useState('Guide');
  const [savedTab, setSavedTab] = useState('Watchlist');
  const [searchQuery, setSearchQuery] = useState('');
  const [heroIndex, setHeroIndex] = useState(0);
  const [playerPanel, setPlayerPanel] = useState<PlayerPanelId>(null);
  const [railExpanded, setRailExpanded] = useState(false);
  const [tvAccountHubOpen, setTVAccountHubOpen] = useState(false);
  const setOverlay = useCallback((value: OverlayId) => {
    if (platform === 'tv' && value === 'cast') {
      return;
    }
    setOverlayState(value);
  }, [platform]);
  const resetTransientState = useCallback(() => {
    setOverlayState(null);
    setSelectedLibraryId('movies');
    setLibraryTab('Discover');
    setFiltersEnabled(false);
    setLibraryFilters([]);
    setSort('Title');
    setSortDirection('asc');
    setViewMode('grid');
    setLiveTab('Guide');
    setSavedTab('Watchlist');
    setSearchQuery('');
    setHeroIndex(0);
    setPlayerPanel(null);
    setRailExpanded(false);
    setTVAccountHubOpen(false);
  }, []);

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
    libraryFilters,
    setLibraryFilters,
    sort,
    setSort,
    sortDirection,
    setSortDirection,
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
    tvAccountHubOpen,
    setTVAccountHubOpen,
    resetTransientState,
  }), [filtersEnabled, heroIndex, libraryFilters, libraryTab, liveTab, overlay, platform, playerPanel, railExpanded, resetTransientState, savedTab, searchQuery, selectedLibraryId, setOverlay, sort, sortDirection, tvAccountHubOpen, viewMode]);

  return <PrototypeUiContext.Provider value={value}>{children}</PrototypeUiContext.Provider>;
}

export function usePrototypeUi(): PrototypeUiValue {
  const context = useContext(PrototypeUiContext);
  if (!context) {
    throw new Error('usePrototypeUi must be used within PrototypeUiProvider.');
  }
  return context;
}
