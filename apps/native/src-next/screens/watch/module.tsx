import React from 'react';
import {Platform} from 'react-native';
import {sameFence} from '../../../../../packages/player-core/src';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {qualityOptionSelected} from '../../../../../packages/client-core/src/playback-v1/quality';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import {createNativeWatchScreens, type NativeWatchFactoryPorts} from './factory';
import {NativeWatchPanels, type NativeWatchPanelsProps} from './WatchPanels';
import {NativeWatchPanelOptions} from './panel-options';
import type {NativeWatchHostBindings} from './WatchHost';
import type {NativeWatchPanelNames} from './panel-model';
import {nativeWatchTracks} from './track-identity';
import {NativeWatchChannelRoute} from './ChannelRoute';
import {createNativeWatchPanelNames} from './panel-names';

export type NativeWatchModuleBindings = Pick<NativeWatchFactoryPorts,
  'requestId' | 'title' | 'manageFile' | 'openFileInfo' | 'openMenu' | 'openVersions' | 'startVersion'> & Readonly<{
  /** Canonical localized names/copy and real error UI; no selection enters here. */
  names?: NativeWatchPanelNames;
  copy?: NativeWatchPanelsProps['copy'];
  playbackInfo?: NativeWatchPanelsProps['playbackInfo'];
  episodes?: NativeWatchPanelsProps['episodes'];
  presentation?: NativeWatchHostBindings['presentation'];
  onPictureInPicture?: ReturnType<NativeWatchHostBindings['chrome']>['onPictureInPicture'];
  onFullWindow?: ReturnType<NativeWatchHostBindings['chrome']>['onFullWindow'];
  renderOverlays?: (runtime: NativeShellRuntime) => React.ReactNode;
  dispose?: () => void;
}>;

/** Current session identities only. An offered default/ceiling is never a
 * current track or decoded picture observation. Missing producer facts stay absent. */
export function nativeWatchChromeFacts(source: NativePlaybackRuntimeSnapshot, names: NativeWatchPanelNames) {
  const tracks = nativeWatchTracks(source), fence = source.fence;
  if (!tracks.version || !fence || !source.session || !source.options || !sameFence(source.dock.local?.fence, fence)) return {quality: ''};
  const quality = source.options.qualities.find(option => qualityOptionSelected(option, source.session!.presentation.quality));
  return {
    quality: quality ? names.quality(quality, source).primary : '',
    audio: tracks.audio ? names.audio(tracks.audio, source).primary : undefined,
    subtitle: tracks.resource || tracks.subtitle ? names.subtitle((tracks.resource ?? tracks.subtitle)!, source).primary : tracks.subtitlesOff ? defaultI18n.t('player.opt.off') : undefined,
  };
}

/** Authority-local domain composition. The shared route registry owns its
 * lifetime. This binds the SAME bootstrap adapter/outlet and never mounts Surface. */
export function createNativeWatchModule(context: NativeShellBootstrapContext, bindings: NativeWatchModuleBindings) {
  if (!context.current() || !context.session()) throw new Error('native_watch_authority_required');
  const authority = context.authority(), viewer = context.session()!.viewer;
  const options = new NativeWatchPanelOptions(context.api, context.playback);
  const copy = bindings.copy ?? {sessionLead: defaultI18n.t('player.opt.temporaryChanges'), sessionDefaults: defaultI18n.t('player.opt.defaultsUnchanged'), audioContinues: defaultI18n.t('player.opt.hearingContinues')};
  let disposed = false;
  const current = () => !disposed && context.current();
  const skipSeconds = (key: 'playback.skipBackMs' | 'playback.skipForwardMs') => {
    const value = context.preferences().effective[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid_playback_preference');
    return value / 1000;
  };
  const player: NativeWatchHostBindings = {
    chrome: (source, runtime) => ({...nativeWatchChromeFacts(source, bindings.names ?? createNativeWatchPanelNames(runtime.text)), skipBackSeconds: skipSeconds('playback.skipBackMs'),
      skipForwardSeconds: skipSeconds('playback.skipForwardMs'), reportError: runtime.reportError,
      onMinimize: fence => {if (current()) {const transition = context.playback.dock.collapse(fence); if (transition) void context.playback.onTransition(transition).catch(runtime.reportError);}},
      ...(context.playback.cast ? {onCast: fence => {if (current()) void context.playback.cast?.(fence).catch(runtime.reportError);}} : {}),
      ...(bindings.onPictureInPicture ? {onPictureInPicture: bindings.onPictureInPicture} : {}),
      ...(bindings.onFullWindow ? {onFullWindow: bindings.onFullWindow} : {}),
    }),
    panel: host => <NativeWatchPanels context={host} options={options} playback={context.playback} names={bindings.names ?? createNativeWatchPanelNames(host.runtime.text)} copy={copy}
      reportError={host.runtime.reportError} renderError={bindings.title.renderError} playbackInfo={bindings.playbackInfo} episodes={bindings.episodes}/>,
    content: host => screens.watch.body(host),
    presentation: bindings.presentation,
  };
  const screens = createNativeWatchScreens({...bindings, api: context.api,
    scope: {serverId: viewer.serverId, viewerId: JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId])},
    authority, current: context.authority, isCurrent: current, subscribeCurrent: context.subscribeAuthority,
    navigation: context.navigation, playback: context.playback, watch: context.watch, isTV: Platform.isTV, player});
  return Object.freeze({
    render: (runtime: NativeShellRuntime) => current() ? screens.watch.render(runtime) : null,
    title: screens.title,
    channel: {render: (route: import('../../shell/routes').NativeShellRoute) => current() && route.kind === 'channel'
      ? <NativeWatchChannelRoute key={JSON.stringify([route.sourceId, route.channelId])} context={context} route={route} title={bindings.title}/> : null},
    renderOverlays: (runtime: NativeShellRuntime) => current() ? bindings.renderOverlays?.(runtime) : null,
    back: () => current() && screens.watch.back(),
    screens,
    dispose: () => {if (disposed) return; disposed = true; options.dispose(); screens.dispose(); bindings.presentation?.(undefined); bindings.dispose?.();},
  });
}
