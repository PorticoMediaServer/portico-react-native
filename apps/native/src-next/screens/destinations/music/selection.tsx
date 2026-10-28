import React from 'react';
import type {NativeShellBootstrapContext} from '../../../shell/bootstrap';
import type {NativeTVMusicController} from './model';
import {createNativePageSelection, type NativePageSelection} from '../../search/selection';

/** Top songs and All songs are different Browse queries. Each retains its own
 * opaque revision; beginning a selection in the other list ends the first. */
export function createNativeMusicSelection(context: NativeShellBootstrapContext, controller: NativeTVMusicController,
  routeKey: string, current: () => boolean): NativePageSelection {
  const groups = ['songs', 'all-songs'] as const;
  const ports = groups.map(group => createNativePageSelection(context, {
    subscribe: controller.subscribe, current,
    getSnapshot: () => {
      const own = controller.selectionPage(group), state = controller.getSnapshot(), viewer = context.session()?.viewer;
      return {context: own && viewer && (viewer.authority === 'local' || viewer.authority === 'hosted') ? {
        scope: {serverId: viewer.serverId, authority: viewer.authority, accountId: viewer.accountId, profileId: viewer.profileId,
          viewId: JSON.stringify(['native-music', routeKey, own.generation, group, own.query])}, revision: {pageRevision: own.revision}} : undefined,
        groups: [{id: group, status: 'success' as const, offset: own?.offset ?? 0,
          items: (group === 'songs' ? state.songs : state.allSongs.songs).filter(controller.contains)}]};
    },
  }, {preserveEvicted: true}));
  const listeners = new Set<() => void>(); let revision = 0;
  const stops = ports.map(port => port.subscribe(() => {revision++; for (const listener of [...listeners]) listener();}));
  const clear = () => ports.every(port => port.clear());
  return Object.freeze({
    register: () => () => {}, clear,
    item: (group, entry) => {
      const index = groups.findIndex(value => value === group); if (index < 0) return undefined;
      const item = ports[index]!.item(group, entry), own = controller.selectionPage(groups[index]!);
      if (!item || !own) return undefined;
      const pick = () => {
        const live = controller.selectionPage(groups[index]!);
        if (!current() || !('libraryId' in entry) || !controller.contains(entry) || !live || live.generation !== own.generation || live.query !== own.query || live.revision !== own.revision) return;
        if (ports[1 - index]!.clear()) item.onEnter();
      };
      return {...item, onEnter: pick, onToggle: pick};
    },
    subscribe: listener => {listeners.add(listener); return () => {listeners.delete(listener);};}, getSnapshot: () => revision,
    render: artwork => <>{ports.map((port, index) => <React.Fragment key={groups[index]}>{port.render(artwork)}</React.Fragment>)}</>,
    dispose: () => {stops.forEach(stop => stop()); ports.forEach(port => port.dispose()); listeners.clear();},
  });
}
