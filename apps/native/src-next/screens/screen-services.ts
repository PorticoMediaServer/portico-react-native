import {presentError, type ErrorContext} from '../../../../packages/client-core/src/presentation/errors';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {ToastMessage} from '../kit/overlays/types';
import type {NativeShellRuntime} from '../shell/runtime';
import {titleRoute, type NativeShellNavigation} from '../shell/routes';
import {NativeScreenLifetime, type NativeScreenAuthority} from './settings-live/lifetime';

export type NativeScreenServicesOwner = NativeScreenAuthority & Readonly<{
  navigation: Pick<NativeShellNavigation, 'open'>;
}>;

/** Authority-local feedback and navigation. A screen still owns its entry,
 * membership and action lifetime; this service does not substitute Home grants. */
export class NativeScreenServices {
  private readonly lifetime: NativeScreenLifetime;
  private readonly listeners = new Set<() => void>();
  private toast: ToastMessage | null = null;
  private sequence = 0;
  private off: () => void;
  private disposed = false;
  private readonly owner: NativeScreenServicesOwner;
  private readonly newRequestId: () => Promise<string>;

  constructor(owner: NativeScreenServicesOwner, newRequestId: () => Promise<string>) {
    this.owner = owner; this.newRequestId = newRequestId;
    this.lifetime = new NativeScreenLifetime(owner);
    this.lifetime.assert();
    this.off = owner.subscribeAuthority(() => {if (!this.lifetime.current()) this.dispose();});
  }

  getSnapshot = (): ToastMessage | null => this.lifetime.current() ? this.toast : null;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener); return () => {this.listeners.delete(listener);};
  };
  private publish(): void {for (const listener of [...this.listeners]) listener();}
  dismiss = (id: string): void => {
    if (!this.lifetime.current() || this.toast?.id !== id) return;
    this.toast = null; this.publish();
  };

  requestId = async (): Promise<string> => {
    this.lifetime.assert();
    const id = await this.newRequestId();
    this.lifetime.assert();
    return id;
  };
  navigate = (entry: ContentEntry): void => {
    this.lifetime.assert();
    this.owner.navigation.open(titleRoute(entry), this.lifetime.authority);
  };
  reportError = (error: unknown, context: ErrorContext = 'generic'): void => {
    if (!this.lifetime.current()) return;
    const presented = presentError(error, context, {operation: 'action'});
    if (presented.silent) return;
    this.toast = Object.freeze({id: `native-screen-error-${++this.sequence}`, message: presented.body});
    this.publish();
  };
  error = (error: unknown, retry: () => void, context: ErrorContext = 'generic') => {
    this.lifetime.assert();
    const presented = presentError(error, context);
    return {title: presented.title, body: presented.body, tone: 'error',
      ...(presented.action === 'try-again' || presented.action === 'refresh'
        ? {primaryAction: {id: 'retry', label: presented.actionLabel, onPress: () => {if (this.lifetime.current()) retry();}}} : {})} satisfies ReturnType<NativeShellRuntime['error']>;
  };

  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.off(); this.lifetime.dispose();
    this.toast = null; this.publish(); this.listeners.clear();
  };
}
