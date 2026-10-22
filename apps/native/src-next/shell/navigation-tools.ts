import {ActivitySummaryService, type ActivitySummarySource} from '../../../../packages/client-core/src/admin/activity-summary';
import {localV1Http} from '../../../../packages/client-core/src/playback-v1/local-http';
import type {NativeShellBootstrapContext} from './bootstrap';

/** Display metadata from the selected server only. An absent name stays absent. */
export function navigationServerName(raw: unknown, serverId: string): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
  const value = raw as {id?: unknown; name?: unknown};
  if (value.id !== serverId || typeof value.name !== 'string') return;
  const name = value.name.trim();
  return name && name.length <= 256 && ![...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ? name : undefined;
}

/** One existing transport/feed, owned and retired by the native session runtime. */
export function createNavigationActivity(context: Pick<NativeShellBootstrapContext, 'api' | 'events' | 'session' | 'authority' | 'subscribeAuthority' | 'current'>) {
  const session = context.session();
  if (!session || session.viewer.role !== 'owner') return;
  const source: ActivitySummarySource = Object.freeze({http: localV1Http(context.api), scope: Object.freeze({
    ...session.viewer, sessionFamilyId: session.sessionFamilyId, authorizationEpoch: context.authority().epoch,
  })});
  const service = new ActivitySummaryService({source: {
    getSnapshot: () => context.current() ? source : null,
    subscribe: context.subscribeAuthority,
  }});
  return Object.freeze({service, events: context.events});
}

export type NavigationTool = Readonly<{onPress: () => void; count?: number}>;
export type NavigationTools = Readonly<{notifications?: NavigationTool; activity?: NavigationTool}>;
