import type {ReactNode} from 'react';
import type {NativeShellRoute} from './routes';
import type {NativeShellRuntime} from './runtime';

export type NativeRouteRenderer = Readonly<{
  render: (route: NativeShellRoute, runtime: NativeShellRuntime) => ReactNode;
  scrollToTop?: (route: NativeShellRoute) => void;
}>;
type RouteKind = NativeShellRoute['kind'];

/** Later-phase owners register genuine renderers against these structural descriptors.
 * No old screen, generated screen, fallback business data or substitute screen is registered. */
export class NativeShellRouteRegistry {
  private renderers = new Map<RouteKind, NativeRouteRenderer>();
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void): (() => void) => {this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  register(kind: RouteKind, renderer: NativeRouteRenderer): () => void {
    if (this.renderers.has(kind)) throw new Error('native_route_already_registered');
    this.renderers.set(kind, renderer); this.changed();
    return () => {if (this.renderers.get(kind) === renderer) {this.renderers.delete(kind); this.changed();}};
  }
  get(kind: RouteKind): NativeRouteRenderer | undefined {return this.renderers.get(kind);}
  private changed() {for (const listener of [...this.listeners]) listener();}
}

export const nativeShellRoutes = new NativeShellRouteRegistry();
