import type {ReactNode} from 'react';
import type {GroupSessionService} from '../../../../../packages/client-core/src/group-session';
import type {SettingsContext, SettingsCustomId} from '../../../../../packages/client-core/src/presentation/settings-structure';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeRouteRenderer} from '../../shell/route-registry';

/** Native-internal ports. Assembly binds only the selected viewer's real services. */
export type NativeSettingsLivePorts = Readonly<{
  /** The exact bootstrap object that owns the one device source bound by
   * bindNativeDeviceSettings. Device rows borrow it; never pass a rebuilt owner. */
  context: NativeShellBootstrapContext;
  /** Capabilities come from the actual platform/runtime, not guessed UI support. */
  settingsContext: () => SettingsContext;
  serverName: () => string;
  requestId: () => string;
  /** DVR's existing protocol requires 24 genuine random bytes encoded as 48 lower-case hex
   * characters. Accounts binds nativeRouteCrypto.random(24); the UUID port above is separate. */
  dvrRequestId: () => Promise<string>;
  /** Borrowed from the app's one group/follower lifetime; this factory never duplicates it. */
  together: GroupSessionService;
  accountActions: Readonly<{signOut: () => Promise<void>; linkTV: () => void}>;
  /** Account/device custom surfaces remain with their semantic owners. Required, never a stub. */
  renderSettingsPanel: (id: SettingsCustomId, runtime: NativeShellRuntime) => ReactNode;
}>;

export type NativeSettingsLiveRenderers = Readonly<{
  settings: NativeRouteRenderer;
  live: NativeRouteRenderer;
  together: NativeRouteRenderer;
  serverDashboard: NativeRouteRenderer;
  dispose: () => void;
}>;
