import type {ReactNode, RefObject} from 'react';
import type {View} from 'react-native';
import type {SearchEntry, SearchGroup, SearchGroupResult, SearchSnapshot} from '../../../../../packages/client-core/src/search';
import type {MessageId} from '../../../../../packages/i18n/src';
import type {CardSelection} from '../../kit/cards';

/** These are bounded, authorized producer tiles, never inferred from loaded results. */
export type NativeSearchGenre = Readonly<{
  id: string; name: string; count: number; backdropPath?: string;
  coverPaths: readonly string[]; tint?: string;
}>;
export type NativeSearchExploreSnapshot = Readonly<{
  phase: 'idle' | 'loading' | 'ready' | 'error';
  genres: readonly NativeSearchGenre[];
  initialHeading: MessageId; emptyHeading: MessageId;
  error?: unknown;
}>;
export type NativeSearchExplorePort = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeSearchExploreSnapshot;
  load: () => Promise<void>;
  openGenre: (genre: NativeSearchGenre) => void;
}>;
export type NativeSearchSelectionPort = Readonly<{
  /** The producer's exact scope/query/revision and IDs, with bounded mounted windows. */
  register: (snapshot: SearchSnapshot, groups: readonly SearchGroupResult[]) => () => void;
  item: (group: SearchGroup, entry: SearchEntry) => CardSelection;
  render: () => ReactNode;
}>;
export type NativeSearchActions = Readonly<{
  open: (entry: SearchEntry, group: SearchGroup) => void;
  play: (entry: SearchEntry, group: SearchGroup) => void;
  menu: (entry: SearchEntry, group: SearchGroup, anchorRef?: RefObject<View | null>) => void;
  isMenuOpen?: (entry: SearchEntry, group: SearchGroup) => boolean;
}>;
