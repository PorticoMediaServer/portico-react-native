import React, {useCallback, useEffect, useMemo, useRef} from 'react';
import {useIsFocused} from '@react-navigation/native';
import {useTVEventHandler} from 'react-native';
import {
  TVFocusMemory,
  TVFocusCoordinator,
  TVLogicalFocusRegistry,
  type TVFocusDirection,
  type TVFocusFence,
  type TVLogicalFocusContainer,
  type TVFocusTransactionResult,
} from '@portico-react-native/tv-focus';
import {
  ContentFocusProvider,
  type TVFocusableLogicalMetadata,
  type TVFocusNode,
} from './primitives';
import {
  tvNavigationFocusScope,
  type TVNavigationParams,
  type TVProductRouteName,
} from './tvNavigationPolicy';

const tvNavigationFocusMemory = new TVFocusMemory(128);
type TVFocusVirtualizer = {
  owns(focusId: string): boolean;
  reveal(focusId: string): void | Promise<void>;
};
const focusVirtualizers = new Set<TVFocusVirtualizer>();
const TVLogicalFocusContext = React.createContext<
  {focus(focusId: string): Promise<TVFocusTransactionResult>} | undefined
>(undefined);

export function useTVLogicalFocus() {
  const context = React.useContext(TVLogicalFocusContext);
  if (!context)
    throw new Error('useTVLogicalFocus requires TVNavigationFocusBoundary.');
  return context;
}

export function registerTVFocusVirtualizer(
  virtualizer: TVFocusVirtualizer,
): () => void {
  focusVirtualizers.add(virtualizer);
  return () => focusVirtualizers.delete(virtualizer);
}

export async function revealTVNavigationFocusId(
  focusId: string | undefined,
): Promise<boolean> {
  if (!focusId) return false;
  const virtualizer = [...focusVirtualizers].find(candidate =>
    candidate.owns(focusId),
  );
  if (!virtualizer) return false;
  await virtualizer.reveal(focusId);
  return true;
}

export function recallTVNavigationFocusId(scope: string): string | undefined {
  return tvNavigationFocusMemory.recall(scope);
}

export function clearTVNavigationFocusMemory(): void {
  tvNavigationFocusMemory.clear();
}

/**
 * Navigation-aware focus boundary for one tvOS route. React Navigation owns
 * route focus/blur; this boundary retains only a semantic target id and asks
 * the currently mounted native node to restore focus after the route is
 * visible. Data refreshes and unrelated target mounts never trigger focus.
 */
export function TVNavigationFocusBoundary({
  children,
  fence,
  onContentFocus,
  onContentMount,
  onContentUnmount,
  params,
  routeName,
  containers = [],
}: {
  children: React.ReactNode;
  containers?: readonly TVLogicalFocusContainer[];
  fence: TVFocusFence;
  onContentFocus?(node?: TVFocusNode, semanticId?: string): void;
  onContentMount?(node: TVFocusNode, semanticId?: string): void;
  onContentUnmount?(node: TVFocusNode, semanticId?: string): void;
  params?: TVNavigationParams;
  routeName: TVProductRouteName;
}) {
  const isFocused = useIsFocused();
  const scope = tvNavigationFocusScope(fence, routeName, params);
  const registry = useMemo(() => {
    const next = new TVLogicalFocusRegistry<TVFocusNode>();
    containers.forEach(container =>
      next.registerContainer({
        ...container,
        virtualizer: container.virtualizer ?? {
          reveal: async focusId => {
            await revealTVNavigationFocusId(focusId);
          },
        },
      }),
    );
    return next;
  }, [containers]);
  const coordinator = useMemo(
    () =>
      new TVFocusCoordinator(registry, {
        requestFocus(target) {
          target.requestTVFocus?.();
          return Boolean(target.requestTVFocus);
        },
      }),
    [registry],
  );
  const focusFrame = useRef<number | undefined>(undefined);
  const active = useRef(false);
  const currentFocusId = useRef<string | undefined>(undefined);
  const pendingFocusId = useRef<string | undefined>(undefined);
  const targets = useRef(new Map<string, TVFocusNode>());
  const logicalNodes = useRef(new Set<string>());
  const mountDisposers = useRef(new Map<string, () => void>());
  const logicalRegistry = useRef(registry);

  const cancelScheduledFocus = useCallback(() => {
    if (focusFrame.current === undefined) return;
    cancelAnimationFrame(focusFrame.current);
    focusFrame.current = undefined;
  }, []);

  const scheduleFocus = useCallback(
    (target: TVFocusNode | undefined) => {
      if (!target) return;
      cancelScheduledFocus();
      focusFrame.current = requestAnimationFrame(() => {
        focusFrame.current = undefined;
        if (!active.current || ![...targets.current.values()].includes(target))
          return;
        target.requestTVFocus?.();
      });
    },
    [cancelScheduledFocus],
  );

  useTVEventHandler(event => {
    if (!active.current) return;
    const direction = event.eventType as TVFocusDirection;
    if (
      direction !== 'down' &&
      direction !== 'left' &&
      direction !== 'right' &&
      direction !== 'up'
    )
      return;
    const focusId = currentFocusId.current;
    const node = focusId ? registry.node(focusId) : undefined;
    if (!focusId || !node) return;
    const explicitEdge = Boolean(node.neighbours?.[direction]);
    const graphOwned =
      registry.container(node.containerId)?.movement === 'graph';
    if (
      !graphOwned &&
      !explicitEdge &&
      !node.boundaryDirections?.includes(direction)
    )
      return;
    const targetId = registry.move(focusId, direction);
    if (targetId) void coordinator.focus(targetId);
  });

  useEffect(() => {
    if (isFocused) {
      active.current = true;
      const remembered = tvNavigationFocusMemory.recall(scope);
      pendingFocusId.current = remembered;
      const target = remembered ? targets.current.get(remembered) : undefined;
      if (target) {
        pendingFocusId.current = undefined;
        scheduleFocus(target);
      } else if (remembered && registry.node(remembered)) {
        void coordinator.focus(remembered).then(result => {
          if (result.status === 'focused') pendingFocusId.current = undefined;
        });
      } else if (remembered) void revealTVNavigationFocusId(remembered);
    } else {
      active.current = false;
      coordinator.cancel();
      cancelScheduledFocus();
    }
    return () => {
      active.current = false;
      coordinator.cancel();
      cancelScheduledFocus();
    };
  }, [
    cancelScheduledFocus,
    coordinator,
    isFocused,
    registry,
    scheduleFocus,
    scope,
  ]);

  const logicalFocus = useMemo(
    () => ({focus: (focusId: string) => coordinator.focus(focusId)}),
    [coordinator],
  );
  return (
    <TVLogicalFocusContext.Provider value={logicalFocus}>
      <ContentFocusProvider
        onContentFocus={(node, semanticId) => {
          if (semanticId && node) {
            currentFocusId.current = semanticId;
            pendingFocusId.current = undefined;
            tvNavigationFocusMemory.remember(scope, semanticId);
          }
          onContentFocus?.(node, semanticId);
        }}
        onContentMount={(node, semanticId, metadata) => {
          if (logicalRegistry.current !== registry) {
            mountDisposers.current.forEach(dispose => dispose());
            mountDisposers.current.clear();
            logicalNodes.current.clear();
            logicalRegistry.current = registry;
          }
          if (semanticId) targets.current.set(semanticId, node);
          if (
            semanticId &&
            metadata &&
            registry.container(metadata.container.id)
          ) {
            if (!logicalNodes.current.has(semanticId)) {
              registry.registerNode(logicalNode(semanticId, metadata));
              logicalNodes.current.add(semanticId);
            }
            mountDisposers.current.get(semanticId)?.();
            mountDisposers.current.set(
              semanticId,
              registry.mount(semanticId, node),
            );
            coordinator.mounted(semanticId);
          }
          if (active.current && semanticId === pendingFocusId.current) {
            pendingFocusId.current = undefined;
            scheduleFocus(node);
          }
          onContentMount?.(node, semanticId);
        }}
        onContentUnmount={(node, semanticId) => {
          if (semanticId && targets.current.get(semanticId) === node)
            targets.current.delete(semanticId);
          if (semanticId) {
            mountDisposers.current.get(semanticId)?.();
            mountDisposers.current.delete(semanticId);
          }
          onContentUnmount?.(node, semanticId);
        }}
      >
        {children}
      </ContentFocusProvider>
    </TVLogicalFocusContext.Provider>
  );
}

function logicalNode(id: string, metadata: TVFocusableLogicalMetadata) {
  return {
    boundaryDirections: metadata.boundaryDirections,
    containerId: metadata.container.id,
    disabled: metadata.disabled,
    id,
    lifecycle: metadata.lifecycle,
    neighbours: metadata.neighbours,
    order: metadata.order,
    routeEpoch: metadata.routeEpoch,
    viewerEpoch: metadata.viewerEpoch,
  };
}
