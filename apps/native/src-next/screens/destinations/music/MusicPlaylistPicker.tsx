import React, {useSyncExternalStore} from 'react';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {PlaylistCard} from '../../../../../../packages/client-core/src/saved';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import type {NativeShellRuntime} from '../../../shell/runtime';
import {Menu, type MenuEntry} from '../../../kit/overlays';
import {nativeDestinationLifetime} from '../lifetime';
import {nativeScreenServices} from '../../native-screen-services';
import {MusicPlaylistPort, type MusicPlaylistSnapshot} from './playlist-port';

const t = defaultI18n.t;
const emptyPlaylists: MusicPlaylistSnapshot = Object.freeze({phase: 'idle', playlists: [], busy: false});
type Lifetime = Readonly<{signal: AbortSignal; isCurrent: () => boolean}>;
type Added = (playlist: Readonly<{id: string; name: string}>) => void;

type OpenState = Readonly<{open: boolean; itemId?: string; port?: MusicPlaylistPort; lifetime?: Lifetime; onAdded?: Added}>;

/** The one playlist picker. A screen (or the shared TV entry sheet) opens it with
 * the item and the page lifetime; the host renders the returned surface once. */
export class MusicPlaylistPickerController {
  private context: NativeShellBootstrapContext;
  private scope: ReturnType<typeof nativeDestinationLifetime>['scope'];
  private requestId: () => Promise<string>;
  private state: OpenState = Object.freeze({open: false});
  private listeners = new Set<() => void>();
  private disposed = false;
  constructor(context: NativeShellBootstrapContext) {
    this.context = context;
    this.scope = nativeDestinationLifetime(context).scope;
    this.requestId = nativeScreenServices(context).requestId;
  }
  getSnapshot = (): OpenState => this.state;
  subscribe = (listener: () => void): (() => void) => {if (this.disposed) return () => {}; this.listeners.add(listener); return () => {this.listeners.delete(listener);};};
  private emit(): void {for (const listener of [...this.listeners]) listener();}
  private current(lifetime: Lifetime): boolean {return !this.disposed && this.context.current() && !lifetime.signal.aborted && lifetime.isCurrent();}
  open = (itemId: string, lifetime: Lifetime, onAdded?: Added): void => {
    if (this.disposed || !this.context.current() || !itemId || !this.current(lifetime)) return;
    this.close();
    const port = new MusicPlaylistPort({api: this.context.api, scope: this.scope, current: () => this.current(lifetime), requestId: this.requestId});
    this.state = Object.freeze({open: true, itemId, port, lifetime, onAdded});
    this.emit();
    void port.load();
    const abort = () => {if (this.state.port === port) this.close();};
    lifetime.signal.addEventListener('abort', abort, {once: true});
  };
  add = async (playlist: PlaylistCard): Promise<void> => {
    const state = this.state, port = state.port;
    if (!state.open || !port || !state.itemId || !state.lifetime || !this.current(state.lifetime)) return;
    try {
      await port.add(playlist.id, state.itemId);
      if (!this.disposed && state.lifetime && this.current(state.lifetime)) {
        state.onAdded?.({id: playlist.id, name: playlist.title});
        this.close();
      }
    } catch (error) {
      if (!this.disposed && state.lifetime && this.current(state.lifetime)) throw error;
    }
  };
  retry = (): void => {if (this.state.port && this.state.open) void this.state.port.load();};
  close = (): void => {
    if (!this.state.open) return;
    this.state.port?.dispose();
    this.state = Object.freeze({open: false});
    this.emit();
  };
  dispose = (): void => {
    if (this.disposed) return;
    this.disposed = true; this.close(); this.listeners.clear();
  };
}

function PickerSurface({controller, runtime}: {controller: MusicPlaylistPickerController; runtime: NativeShellRuntime}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const port = state.port;
  const snapshot: MusicPlaylistSnapshot = useSyncExternalStore(port?.subscribe ?? (() => () => {}), port?.getSnapshot ?? (() => emptyPlaylists));
  if (!state.open || !port) return null;
  const items: MenuEntry[] = snapshot.phase === 'loading' || !snapshot.playlists.length && snapshot.phase !== 'error'
    ? snapshot.phase === 'loading' ? [{id: 'loading', label: t('saved.loading'), disabled: true, onSelect: () => {}}] : [{id: 'empty', label: t('web.saved.empty.playlists'), disabled: true, onSelect: () => {}}]
    : snapshot.phase === 'error' ? [{id: 'retry', label: t('saved.retry'), onSelect: () => controller.retry()}]
      : snapshot.playlists.map(playlist => ({id: playlist.id, label: playlist.title, trailing: playlist.count === undefined ? undefined : defaultI18n.number(playlist.count),
        disabled: snapshot.busy, onSelect: () => {void controller.add(playlist).catch(error => runtime.reportError(error));}}));
  return <Menu testID="music-playlist-picker" open onOpenChange={open => {if (!open) controller.close();}}
    title={t('entry.addToPlaylist')} items={items}/>;
}

export type MusicPlaylistPickerHandle = Readonly<{
  open: (itemId: string, lifetime: Lifetime, onAdded?: Added) => void;
  render: (runtime: NativeShellRuntime) => React.ReactNode;
  dispose: () => void;
}>;

/** Create one picker per authority-local screen module and render its surface once. */
export function createMusicPlaylistPicker(context: NativeShellBootstrapContext): MusicPlaylistPickerHandle {
  const controller = new MusicPlaylistPickerController(context);
  return Object.freeze({open: controller.open, render: runtime => <PickerSurface controller={controller} runtime={runtime}/>, dispose: controller.dispose});
}
