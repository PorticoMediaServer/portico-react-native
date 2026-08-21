import {
  normalizeViewerScope,
  sameViewerScope,
  type PorticoClient,
  type ViewerScope,
} from '@porticomediaserver/client-core';

export type ViewerPublicationSnapshot = {
  acceptingWrites: boolean;
  scope?: ViewerScope;
  transitioning: boolean;
};

type ViewerClientBinding = {
  active: boolean;
  scope: ViewerScope;
  snapshot: () => ViewerPublicationSnapshot;
};

const bindings = new WeakMap<object, ViewerClientBinding>();

function assertActive(binding: ViewerClientBinding): void {
  const runtime = binding.snapshot();
  if (!binding.active
    || !runtime.acceptingWrites
    || runtime.transitioning
    || !runtime.scope
    || !sameViewerScope(binding.scope, runtime.scope)) {
    const error = new Error(
      'This Portico client is fenced while the active viewing profile changes.',
    );
    error.name = 'ViewerClientPublicationFencedError';
    throw error;
  }
}

/**
 * Wraps an authenticated client in a synchronous publication fence. The
 * wrapper is deliberately inactive until AppSession and viewer runtime commit
 * the same authoritative scope. A still-mounted A screen therefore cannot
 * borrow B's newly installed global credential family.
 */
export function guardViewerClient(
  client: PorticoClient,
  scope: ViewerScope,
  snapshot: () => ViewerPublicationSnapshot,
): PorticoClient {
  const binding: ViewerClientBinding = {
    active: false,
    scope: normalizeViewerScope(scope),
    snapshot,
  };
  const guarded = new Proxy(client as object, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        assertActive(binding);
        return Reflect.apply(value, target, args);
      };
    },
  }) as PorticoClient;
  bindings.set(guarded as object, binding);
  return guarded;
}

/** Synchronously makes every subsequent call through this client fail. */
export function fenceViewerClient(client: PorticoClient | undefined): void {
  const binding = client ? bindings.get(client as object) : undefined;
  if (binding) binding.active = false;
}

/**
 * Opens a client only after the authoritative AppSession ref and viewer
 * runtime both name the exact same scope.
 */
export function activateViewerClient(
  client: PorticoClient,
  scope: ViewerScope,
): void {
  const binding = bindings.get(client as object);
  if (!binding || !sameViewerScope(binding.scope, scope)) {
    throw new Error(
      'The Portico AppSession client was not bound to its authoritative viewing scope.',
    );
  }
  const runtime = binding.snapshot();
  if (!runtime.acceptingWrites
    || runtime.transitioning
    || !runtime.scope
    || !sameViewerScope(runtime.scope, binding.scope)) {
    throw new Error(
      'The Portico AppSession cannot publish before its viewer runtime is authoritative.',
    );
  }
  binding.active = true;
}

export function viewerClientIsActive(client: PorticoClient): boolean {
  const binding = bindings.get(client as object);
  if (!binding) return false;
  try {
    assertActive(binding);
    return true;
  } catch {
    return false;
  }
}
