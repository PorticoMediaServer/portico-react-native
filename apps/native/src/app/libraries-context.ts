import {createContext, useContext} from 'react';
import type {LibrariesState} from './libraries';

export const LibrariesContext = createContext<LibrariesState>({items: [], loading: false, reload: () => {}});

export function useLibrariesContext(): LibrariesState {
  return useContext(LibrariesContext);
}
