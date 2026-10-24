import type {ReactNode, RefObject} from 'react';
import type {View} from 'react-native';
import type {Library} from '../../../../packages/client-core/src/index';
import type {HomeService} from '../../../../packages/client-core/src/home-service';
import type {HomeChannel, HomeCollection, HomeRow, HomeSeeAll} from '../../../../packages/client-core/src/home';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {TextEnvironment} from '../../../../packages/client-core/src/presentation/kit-model';
import type {ArtworkSource, AmbientArtSource, ProfileOption} from '../kit/artwork';
import type {AccountMenuProps} from '../kit/shell/AccountShell';
import type {LibraryMenuProps} from '../kit/browse';
import type {LayoutSelection} from '../kit/layout/types';
import type {StateViewProps} from '../kit/states';
import type {ShellAuthority, ShellDestination} from './model';
import type {LastLibraryMemory} from './library-memory';
import type {NativeShellPlaybackAdapter} from './playback';
import type {NativeWatchOutletPort} from './watch-outlet';

export type NativeShellSnapshot = Readonly<{
  authority: ShellAuthority;
  destination: ShellDestination;
  /** The title's genuine library may differ from its retained origin page. */
  railDestination?: ShellDestination;
  /** A non-shell route retains its origin without making that page current. */
  contentVisible?: boolean;
  selectionActive: boolean;
  homeObscured: boolean;
  homeVisible: boolean;
  mediaExpanded: boolean;
  libraries: readonly Library[];
  hasLiveTV: boolean;
  profile: ProfileOption;
  serverName?: string;
  unreadNotificationCount?: number;
  unreadNotifications: boolean;
  account: Pick<AccountMenuProps, 'accountLine' | 'actions' | 'profiles' | 'viewerRole' | 'serverAction'>;
}>;

export type NativeHomeActions = Readonly<{
  navigate: (entry: ContentEntry) => void;
  play: (entry: ContentEntry, target: NonNullable<ContentEntry['playback']>) => void;
  more: (entry: ContentEntry, rowId?: string, anchorRef?: RefObject<View | null>) => void;
  myList: (entry: ContentEntry, selected: boolean) => Promise<void>;
  channel: (channel: HomeChannel) => void;
  channelMore: (channel: HomeChannel, anchorRef?: RefObject<View | null>) => void;
  collectionMore: (collection: HomeCollection, rowId: string, anchorRef?: RefObject<View | null>) => void;
  seeAll: (destination: HomeSeeAll) => void;
  customize: () => void;
}>;

/** Bootstrapped by the real session/transport owner, never by mock data or global credentials.
 * A new authority must replace the HomeService, selection and authenticated image bindings. */
export interface NativeShellRuntime {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => NativeShellSnapshot;
  home: HomeService;
  memory: LastLibraryMemory;
  text: TextEnvironment;
  actions: NativeHomeActions;
  artwork: (path: string | undefined) => ArtworkSource | undefined;
  ambient: (path: string | undefined) => AmbientArtSource | undefined;
  selection: (rowId: string) => LayoutSelection & {isMenuOpen?: (id: string) => boolean};
  setHomeWindow: (row: HomeRow, sectionOrder: number, first: number, last: number, visible: boolean, physicalIds?: readonly string[], retainedIds?: readonly string[], visibleIds?: readonly string[]) => void;
  homeMenuRow?: (windowId: string) => HomeRow | undefined;
  renderSelection: () => ReactNode;
  renderRoutes: () => ReactNode;
  /** Persistent watch chrome above the one native picture surface. */
  renderWatch?: () => ReactNode;
  libraryMenu: (library: Library) => LibraryMenuProps;
  /** Full browse, search and player screens stay with their later-phase owners. */
  renderDestination: (destination: ShellDestination, openLibrary: (id: string) => void) => ReactNode;
  renderHomeEmpty: () => ReactNode;
  error: (error: unknown, retry: () => void) => StateViewProps;
  reportError: (error: unknown) => void;
  onDestination: (destination: ShellDestination) => void;
  scrollToTop: (destination: ShellDestination) => void;
  registerScrollToTop: (destination: ShellDestination, handler: () => void) => () => void;
  /** Registered by the TV shell; assembly dispatches only after topmost holds/player. */
  registerTVRailBack?: (handler: () => boolean) => () => void;
  /** Destination-scoped; legacy Home callers omit destination. A false result continues navigation Back. */
  registerTVPageBack?: (handler: () => boolean, destination?: ShellDestination) => () => void;
  onArtworkError: (error: unknown, entry: ContentEntry) => void;
  playback?: NativeShellPlaybackAdapter;
  /** Present in the real bootstrap. Missing measurement withholds expanded
   * bounds; it does not retire the persistent player owner. */
  watch?: NativeWatchOutletPort;
  /** The effective server preference, expressed in seconds by the assembly. */
  skipBackSeconds: number;
  /** Only installed when a real device destination control exists. */
  castControl?: ReactNode;
  desktopActivity?: ReactNode;
}
