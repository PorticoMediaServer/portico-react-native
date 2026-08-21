export type TVFocusDirection = 'down' | 'left' | 'right' | 'up';

export interface TVLogicalFocusContainer {
  defaultFocusId?: string;
  entryFocusId?: string;
  id: string;
  lifecycle?: 'active' | 'hidden' | 'unmounted';
  movement?: 'graph' | 'native';
  neighbours?: Partial<Record<TVFocusDirection, string>>;
  parentId?: string;
  virtualizer?: TVFocusVirtualizer;
}

export interface TVLogicalFocusNode {
  boundaryDirections?: readonly TVFocusDirection[];
  containerId: string;
  disabled?: boolean;
  id: string;
  lifecycle?: 'active' | 'hidden' | 'unmounted';
  neighbours?: Partial<Record<TVFocusDirection, string>>;
  order?: number;
  routeEpoch?: number;
  viewerEpoch?: number;
}

export interface TVFocusVirtualizer {
  reveal(focusId: string): Promise<void> | void;
}

/**
 * Logical focus topology. It deliberately knows nothing about native view
 * instances, so virtualized items remain addressable while unmounted.
 */
export class TVLogicalFocusRegistry<T> {
  private readonly containers = new Map<string, TVLogicalFocusContainer>();
  private readonly nodes = new Map<string, TVLogicalFocusNode>();
  private readonly targets = new Map<string, T>();

  constructor(
    private viewerEpoch = 0,
    private routeEpoch = 0,
  ) {}

  setEpochs(viewerEpoch: number, routeEpoch: number): void {
    if (viewerEpoch === this.viewerEpoch && routeEpoch === this.routeEpoch)
      return;
    this.viewerEpoch = viewerEpoch;
    this.routeEpoch = routeEpoch;
    this.targets.clear();
  }

  registerContainer(container: TVLogicalFocusContainer): () => void {
    if (!container.id) throw new Error('A focus container requires an id.');
    if (container.parentId === container.id)
      throw new Error('A focus container cannot parent itself.');
    if (this.containers.has(container.id))
      throw new Error(`Duplicate focus container: ${container.id}`);
    if (container.parentId && !this.containers.has(container.parentId)) {
      throw new Error(`Unknown parent focus container: ${container.parentId}`);
    }
    for (let parent = container.parentId; parent; ) {
      if (parent === container.id)
        throw new Error(`Focus container cycle: ${container.id}`);
      parent = this.containers.get(parent)?.parentId;
    }
    this.containers.set(container.id, container);
    return () => {
      if (this.containers.get(container.id) !== container) return;
      this.containers.delete(container.id);
    };
  }

  registerNode(node: TVLogicalFocusNode): () => void {
    if (!node.id || !node.containerId)
      throw new Error('A logical focus node requires id and containerId.');
    if (!this.containers.has(node.containerId))
      throw new Error(`Unknown focus container: ${node.containerId}`);
    if (this.nodes.has(node.id))
      throw new Error(`Duplicate logical focus node: ${node.id}`);
    this.nodes.set(node.id, node);
    return () => {
      if (this.nodes.get(node.id) !== node) return;
      this.nodes.delete(node.id);
      this.targets.delete(node.id);
    };
  }

  mount(focusId: string, target: T): () => void {
    const node = this.nodes.get(focusId);
    if (!node) throw new Error(`Unknown logical focus node: ${focusId}`);
    if (!this.inCurrentEpoch(node)) return () => undefined;
    this.targets.set(focusId, target);
    return () => {
      if (this.targets.get(focusId) === target) this.targets.delete(focusId);
    };
  }

  target(focusId: string): T | undefined {
    return this.targets.get(focusId);
  }

  nearestMounted(focusId: string): {focusId: string; target: T} | undefined {
    const origin = this.nodes.get(focusId);
    if (!origin) return undefined;
    const originOrder = origin.order ?? 0;
    return this.orderedNodes(origin.containerId)
      .filter(
        node =>
          node.id !== focusId &&
          this.isEnabled(node.id) &&
          this.targets.has(node.id),
      )
      .sort(
        (left, right) =>
          Math.abs((left.order ?? 0) - originOrder) -
            Math.abs((right.order ?? 0) - originOrder) ||
          (left.order ?? 0) - (right.order ?? 0) ||
          left.id.localeCompare(right.id),
      )
      .map(node => ({focusId: node.id, target: this.targets.get(node.id)!}))[0];
  }

  node(focusId: string): TVLogicalFocusNode | undefined {
    return this.nodes.get(focusId);
  }

  available(focusId: string): boolean {
    return this.isEnabled(focusId);
  }

  container(containerId: string): TVLogicalFocusContainer | undefined {
    return this.containers.get(containerId);
  }

  setContainerLifecycle(
    containerId: string,
    lifecycle: TVLogicalFocusContainer['lifecycle'],
  ): void {
    const container = this.containers.get(containerId);
    if (!container) throw new Error(`Unknown focus container: ${containerId}`);
    this.containers.set(containerId, {...container, lifecycle});
    if (lifecycle !== 'active') {
      for (const node of this.nodes.values()) {
        if (node.containerId === containerId) this.targets.delete(node.id);
      }
    }
  }

  setNodeLifecycle(
    focusId: string,
    lifecycle: TVLogicalFocusNode['lifecycle'],
  ): void {
    const node = this.nodes.get(focusId);
    if (!node) throw new Error(`Unknown logical focus node: ${focusId}`);
    this.nodes.set(focusId, {...node, lifecycle});
    if (lifecycle !== 'active') this.targets.delete(focusId);
  }

  first(containerId: string): string | undefined {
    const container = this.containers.get(containerId);
    if (
      !container ||
      container.lifecycle === 'hidden' ||
      container.lifecycle === 'unmounted'
    )
      return undefined;
    const entry = container.entryFocusId;
    if (entry && this.isEnabled(entry)) return entry;
    const preferred = container?.defaultFocusId;
    if (preferred && this.isEnabled(preferred)) return preferred;
    return this.orderedNodes(containerId).find(node => this.isEnabled(node.id))
      ?.id;
  }

  move(fromId: string, direction: TVFocusDirection): string | undefined {
    const from = this.nodes.get(fromId);
    if (!from || !this.isEnabled(fromId)) return undefined;
    const explicit = from.neighbours?.[direction];
    if (explicit && this.isEnabled(explicit)) return explicit;
    const container = this.containers.get(from.containerId);
    // Native engines retain geometric movement inside ordinary containers.
    // The graph participates only for explicit edges or graph-owned groups.
    if (!container || (container.movement ?? 'native') === 'native') {
      return this.boundary(fromId, direction);
    }
    const siblings = this.orderedNodes(from.containerId).filter(node =>
      this.isEnabled(node.id),
    );
    const index = siblings.findIndex(node => node.id === fromId);
    if (index < 0) return undefined;
    const delta = direction === 'left' || direction === 'up' ? -1 : 1;
    return siblings[index + delta]?.id ?? this.boundary(fromId, direction);
  }

  boundary(fromId: string, direction: TVFocusDirection): string | undefined {
    const from = this.nodes.get(fromId);
    if (!from || !this.isEnabled(fromId)) return undefined;
    let container = this.containers.get(from.containerId);
    const visited = new Set<string>();
    while (container && !visited.has(container.id)) {
      visited.add(container.id);
      let neighbourId = container.neighbours?.[direction];
      while (neighbourId && !visited.has(neighbourId)) {
        visited.add(neighbourId);
        const target = this.first(neighbourId);
        if (target) return target;
        neighbourId = this.containers.get(neighbourId)?.neighbours?.[direction];
      }
      container = container.parentId
        ? this.containers.get(container.parentId)
        : undefined;
    }
    return undefined;
  }

  private isEnabled(focusId: string): boolean {
    const node = this.nodes.get(focusId);
    const container = node ? this.containers.get(node.containerId) : undefined;
    return Boolean(
      node &&
      !node.disabled &&
      node.lifecycle !== 'hidden' &&
      node.lifecycle !== 'unmounted' &&
      container?.lifecycle !== 'hidden' &&
      container?.lifecycle !== 'unmounted' &&
      this.inCurrentEpoch(node),
    );
  }

  private inCurrentEpoch(node: TVLogicalFocusNode): boolean {
    return (
      (node.viewerEpoch === undefined ||
        node.viewerEpoch === this.viewerEpoch) &&
      (node.routeEpoch === undefined || node.routeEpoch === this.routeEpoch)
    );
  }

  private orderedNodes(containerId: string): TVLogicalFocusNode[] {
    return [...this.nodes.values()]
      .filter(node => node.containerId === containerId)
      .sort(
        (left, right) =>
          (left.order ?? 0) - (right.order ?? 0) ||
          left.id.localeCompare(right.id),
      );
  }
}

/** Semantic memory never retains native targets and is epoch-fenced. */
export class TVSemanticFocusMemory {
  private readonly memory = new Map<
    string,
    {focusId: string; routeEpoch: number; viewerEpoch: number}
  >();

  remember(
    scope: string,
    focusId: string,
    viewerEpoch: number,
    routeEpoch: number,
  ): void {
    if (!scope || !focusId) return;
    this.memory.set(scope, {focusId, routeEpoch, viewerEpoch});
  }

  recall(
    scope: string,
    viewerEpoch: number,
    routeEpoch: number,
  ): string | undefined {
    const entry = this.memory.get(scope);
    return entry?.viewerEpoch === viewerEpoch && entry.routeEpoch === routeEpoch
      ? entry.focusId
      : undefined;
  }

  clearViewer(viewerEpoch: number): void {
    for (const [scope, entry] of this.memory) {
      if (entry.viewerEpoch === viewerEpoch) this.memory.delete(scope);
    }
  }
}

export interface TVNativeFocusAdapter<T> {
  requestFocus(target: T): boolean | Promise<boolean>;
}

export type TVFocusTransactionResult =
  | {focusId: string; status: 'focused'}
  | {focusId: string; status: 'cancelled' | 'missing' | 'unmounted'};

/** Serializes reveal/mount/request into one cancellable focus authority. */
export class TVFocusCoordinator<T> {
  private activation = 0;
  private waiters = new Map<string, Set<() => void>>();

  constructor(
    readonly registry: TVLogicalFocusRegistry<T>,
    readonly adapter: TVNativeFocusAdapter<T>,
    private readonly mountTimeoutMs = 250,
  ) {}

  cancel(): void {
    this.activation += 1;
    this.flushWaiters();
  }

  mounted(focusId: string): void {
    const callbacks = this.waiters.get(focusId);
    this.waiters.delete(focusId);
    callbacks?.forEach(callback => callback());
  }

  async focus(focusId: string): Promise<TVFocusTransactionResult> {
    const activation = ++this.activation;
    const node = this.registry.node(focusId);
    if (!node || !this.registry.available(focusId))
      return {focusId, status: 'missing'};
    let target = this.registry.target(focusId);
    if (!target) {
      await this.registry
        .container(node.containerId)
        ?.virtualizer?.reveal(focusId);
      if (activation !== this.activation) return {focusId, status: 'cancelled'};
      target = this.registry.target(focusId);
      if (!target) {
        await this.waitForMount(focusId, activation);
        if (activation !== this.activation)
          return {focusId, status: 'cancelled'};
        target = this.registry.target(focusId);
      }
    }
    if (!target) {
      const nearest = this.registry.nearestMounted(focusId);
      if (!nearest) return {focusId, status: 'unmounted'};
      focusId = nearest.focusId;
      target = nearest.target;
    }
    const focused = await this.adapter.requestFocus(target);
    if (activation !== this.activation) return {focusId, status: 'cancelled'};
    return {focusId, status: focused ? 'focused' : 'unmounted'};
  }

  private waitForMount(focusId: string, activation: number): Promise<void> {
    if (activation !== this.activation || this.registry.target(focusId))
      return Promise.resolve();
    return new Promise(resolve => {
      const callbacks = this.waiters.get(focusId) ?? new Set();
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timeout);
        callbacks.delete(finish);
        if (!callbacks.size) this.waiters.delete(focusId);
        resolve();
      };
      const timeout = setTimeout(finish, this.mountTimeoutMs);
      callbacks.add(finish);
      this.waiters.set(focusId, callbacks);
    });
  }

  private flushWaiters(): void {
    const waiters = this.waiters;
    this.waiters = new Map();
    waiters.forEach(callbacks => callbacks.forEach(callback => callback()));
  }
}

export type TVOSFocusableTarget = {requestTVFocus?: () => void};
export type AndroidTVFocusableTarget = {
  focus?: () => void;
  requestFocus?: () => void;
};

export const tvOSFocusAdapter: TVNativeFocusAdapter<TVOSFocusableTarget> = {
  requestFocus(target) {
    if (!target.requestTVFocus) return false;
    target.requestTVFocus();
    return true;
  },
};

export const androidTVFocusAdapter: TVNativeFocusAdapter<AndroidTVFocusableTarget> =
  {
    requestFocus(target) {
      const request = target.requestFocus ?? target.focus;
      if (!request) return false;
      request.call(target);
      return true;
    },
  };
