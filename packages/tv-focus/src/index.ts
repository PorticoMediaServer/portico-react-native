export interface TVFocusFence {
  accountId?: string;
  authorizationGeneration?: string | number;
  contractRevision?: string | number;
  profileId?: string;
  serverId?: string;
}

export * from './logicalFocus';

export interface TVFocusRouteIdentity {
  name: string;
  semanticId?: string;
}

export interface TVFocusMemoryEntry {
  focusId: string;
  routeScope: string;
}

function canonical(value: string | number | undefined): string {
  return value === undefined ? '-' : encodeURIComponent(String(value));
}

/**
 * A viewer-fenced route identity. It intentionally contains no credentials,
 * URLs, titles, search text, or navigator instance keys.
 */
export function tvFocusRouteScope(
  fence: TVFocusFence,
  route: TVFocusRouteIdentity,
): string {
  return [
    'tv-focus-v1',
    canonical(fence.accountId),
    canonical(fence.profileId),
    canonical(fence.serverId),
    canonical(fence.authorizationGeneration),
    canonical(fence.contractRevision),
    canonical(route.name),
    canonical(route.semanticId),
  ].join(':');
}

/**
 * Bounded semantic focus memory. Native view references never escape a
 * mounted route; only stable ids are retained, making navigator detach and
 * remount safe and preventing one viewer's node from leaking into another
 * viewer scope.
 */
export class TVFocusMemory {
  private readonly entries = new Map<string, string>();

  constructor(private readonly limit = 128) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('TVFocusMemory requires a positive integer limit.');
    }
  }

  remember(routeScope: string, focusId: string): void {
    if (!routeScope || !focusId) return;
    this.entries.delete(routeScope);
    this.entries.set(routeScope, focusId);
    while (this.entries.size > this.limit) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (!oldest) break;
      this.entries.delete(oldest);
    }
  }

  recall(routeScope: string): string | undefined {
    const value = this.entries.get(routeScope);
    if (!value) return undefined;
    this.entries.delete(routeScope);
    this.entries.set(routeScope, value);
    return value;
  }

  forget(routeScope: string): void {
    this.entries.delete(routeScope);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface TVFocusRestorationTarget {
  requestTVFocus?: () => void;
}

/**
 * Keeps route-local native targets out of persisted focus memory. A route
 * focus event arms restoration of an exact semantic target. Late mounts may
 * satisfy it; arbitrary live updates and unrelated mounts may not steal focus.
 */
export class TVRouteFocusRegistry<T extends TVFocusRestorationTarget> {
  private active = false;
  private activation = 0;
  private pendingId?: string;
  private readonly targets = new Map<string, T>();

  constructor(
    readonly routeScope: string,
    private readonly memory: TVFocusMemory,
  ) {}

  mount(focusId: string | undefined, target: T): {activation: number; target: T} | undefined {
    if (!focusId) return undefined;
    this.targets.set(focusId, target);
    if (!this.active || this.pendingId !== focusId) return undefined;
    this.pendingId = undefined;
    return {activation: this.activation, target};
  }

  unmount(focusId: string | undefined, target: T): void {
    if (!focusId || this.targets.get(focusId) !== target) return;
    this.targets.delete(focusId);
  }

  focused(focusId: string | undefined): void {
    if (!this.active || !focusId || !this.targets.has(focusId)) return;
    this.pendingId = undefined;
    this.memory.remember(this.routeScope, focusId);
  }

  activate(): {activation: number; target: T} | undefined {
    this.active = true;
    this.activation += 1;
    const remembered = this.memory.recall(this.routeScope);
    this.pendingId = remembered;
    const target = remembered ? this.targets.get(remembered) : undefined;
    if (!target) return undefined;
    this.pendingId = undefined;
    return {activation: this.activation, target};
  }

  deactivate(): void {
    this.active = false;
    this.activation += 1;
    this.pendingId = undefined;
  }

  canRestore(activation: number, target: T): boolean {
    return this.active
      && this.activation === activation
      && [...this.targets.values()].includes(target);
  }

  firstMountedTarget(): T | undefined {
    return this.targets.values().next().value;
  }

  get isActive(): boolean {
    return this.active;
  }

  get pendingFocusId(): string | undefined {
    return this.active ? this.pendingId : undefined;
  }
}
