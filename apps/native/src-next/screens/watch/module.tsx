import {groupPort, subscribeGroupPort} from '../settings-live/group-port';
import {nativeDeviceSettings} from '../../platform/device-settings';
import React from 'react';
import {audiobookPreferences} from '../../../../../packages/client-core/src/audiobook-preferences';
import {Platform, type View} from 'react-native';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {sameFence, type SkipMode} from '../../../../../packages/player-core/src';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {qualityOptionSelected} from '../../../../../packages/client-core/src/playback-v1/quality';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import {createNativeWatchScreens, type NativeWatchFactoryPorts} from './factory';
import type {MusicPlaylistPickerHandle} from '../destinations/music/MusicPlaylistPicker';
import {NativePlaybackInfoPanel, playbackInfoWords} from './PlaybackInfoPanel';
import {NativeWatchPanels, type NativeWatchPanelsProps, type NativeWatchStylePort} from './WatchPanels';
import {NativeWatchPanelOptions} from './panel-options';
import type {NativeWatchHostBindings} from './WatchHost';
import {sameAuthority} from '../../shell/model';
import type {NativePlaybackFailure} from './PlaybackFailed';
import type {NativeWatchPanelNames} from './panel-model';
import {nativeWatchTracks} from './track-identity';
import {NativeWatchChannelRoute} from './ChannelRoute';
import {NativeTVLiveGuide} from './live-guide';
import {NativeTVLiveActions} from './live-actions';
import {NativeLiveActionPanels} from './LiveActionPanels';
import {NativePlaybackFailed} from './PlaybackFailed';
import {NativeWatchPostPlay} from './PostPlayScreen';
import {isTablet} from '../../../src/bridge/device-platform';
import {createNativeWatchPanelNames} from './panel-names';
import {nativeServerPreferences} from '../../platform/server-preferences';
import {browseValueLabel} from '../../../../../packages/client-core/src/presentation/browse-toolbar';

export type NativeWatchEntryMenu = Readonly<{
  open: (entry: ContentEntry, entryCurrent: () => boolean, anchorRef?: React.RefObject<View | null>, select?: () => void) => Promise<void>;
  isOpen: (entry: ContentEntry) => boolean;
  subscribe: (listener: () => void) => () => void;
}>;

export type NativeWatchModuleBindings = Pick<NativeWatchFactoryPorts,
  'requestId' | 'title' | 'manageFile' | 'openFileInfo' | 'openMenu' | 'openVersions' | 'startVersion'> & Readonly<{
  /** Canonical localized names/copy and real error UI; no selection enters here. */
  names?: NativeWatchPanelNames;
  /** One playlist picker per authority-local module, rendered by its overlay outlet. */
  playlistPicker?: MusicPlaylistPickerHandle;
  copy?: NativeWatchPanelsProps['copy'];
  playbackInfo?: NativeWatchPanelsProps['playbackInfo'];
  episodes?: NativeWatchPanelsProps['episodes'];
  presentation?: NativeWatchHostBindings['presentation'];
  onPictureInPicture?: ReturnType<NativeWatchHostBindings['chrome']>['onPictureInPicture'];
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
  const detailScope = {serverId: viewer.serverId, viewerId: JSON.stringify([viewer.authority, viewer.accountId, viewer.profileId])};
  const options = new NativeWatchPanelOptions(context.api, context.playback);
  const copy = bindings.copy ?? {sessionLead: defaultI18n.t('player.opt.temporaryChanges'), sessionDefaults: defaultI18n.t('player.opt.defaultsUnchanged'), audioContinues: defaultI18n.t('player.opt.hearingContinues')};
  let disposed = false;
  const current = () => !disposed && context.current();
  const liveGuide = Platform.isTV ? new NativeTVLiveGuide(context) : undefined;
  const liveActions = liveGuide ? new NativeTVLiveActions(context, liveGuide) : undefined;
  // Media's retry changes the failed phase and source itself, so these controllers
  // belong to the module and its route, never to the error surface. They abort on a
  // route/authority replacement, a collapsed watch or disposal — not on phase,
  // source or session changes — and the core fences unrelated intents itself.
  const retries = new Set<{controller: AbortController; route: Readonly<{authority: ReturnType<typeof context.authority>; revision: number}>}>();
  const expanded = () => context.playback.getSnapshot().dock.local?.expanded === true
    && (!Platform.isTV || groupPort()?.playerVisible?.() !== false);
  const abortAll = () => {for (const operation of retries) operation.controller.abort(); retries.clear();};
  // A pending retry belongs to the route it was started under. Collapsing the watch,
  // replacing the route or authority, or disposing the module aborts it; the retry's
  // own phase, source and session changes never do.
  const stopPlayback = context.playback.subscribe(() => {if (!expanded()) abortAll();});
  // Returning to a Together room hides Watch without stopping its local output.
  // Its presentation lease still retires the retry that the hidden Watch owned.
  const stopGroup = Platform.isTV ? subscribeGroupPort(() => {if (!expanded()) abortAll();}) : () => {};
  const stopNavigation = context.navigation.subscribe(() => {
    const route = {authority: context.authority(), revision: context.navigation.getSnapshot().revision};
    for (const operation of [...retries]) {
      if (sameAuthority(operation.route.authority, route.authority) && operation.route.revision === route.revision) continue;
      operation.controller.abort();
      retries.delete(operation);
    }
  });
  // Only an operation whose captured authority is no longer current is aborted; an
  // unrelated authority notification leaves the rest alone.
  const stopAuthority = context.subscribeAuthority(() => {
    const live = context.authority(), retired = !context.current();
    for (const operation of [...retries]) {
      if (!retired && sameAuthority(operation.route.authority, live)) continue;
      operation.controller.abort();
      retries.delete(operation);
    }
  });
  /** Dispatch one failure the viewer actually saw, under the route it was drawn on.
   * The captured route travels with the operation; nothing reads a later route. */
  const retryFailed = (failure: NativePlaybackFailure, route: Readonly<{authority: ReturnType<typeof context.authority>; revision: number}>,
    report: (error: unknown) => void) => {
    const live = context.playback.getSnapshot();
    if (!current() || !sameAuthority(context.authority(), route.authority)) return;
    if (context.navigation.getSnapshot().revision !== route.revision) return;
    if (live.capabilities.retry !== true || !live.fence || !sameFence(live.fence, failure.fence) || !expanded()) return;
    const retry = context.playback.retry;
    if (!retry) return;
    const controller = new AbortController(), operation = {controller, route};
    retries.add(operation);
    const isCurrent = () => !disposed && !controller.signal.aborted && current() && expanded()
      && sameAuthority(context.authority(), route.authority) && context.navigation.getSnapshot().revision === route.revision;
    void retry(failure.fence, {signal: controller.signal, isCurrent})
      .catch(error => {if (isCurrent()) report(error);})
      .finally(() => retries.delete(operation));
  };
  const skipSeconds = (source: NativePlaybackRuntimeSnapshot, key: 'playback.skipBackMs' | 'playback.skipForwardMs') => {
    if (source.dock?.local?.kind === 'audiobook') {
      const selected = audiobookPreferences(context.preferences());
      return (key === 'playback.skipBackMs' ? selected.skipBackMs : selected.skipForwardMs) / 1000;
    }
    const value = context.preferences().effective[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error('invalid_playback_preference');
    return value / 1000;
  };
  // The same Settings keys the runtime's automatic skip reads; an unreadable value
  // behaves as the player's own default, which asks.
  const skipModes = (): Readonly<Record<'intro' | 'recap' | 'credits', SkipMode>> => {
    const values = context.preferences().effective;
    const read = (key: string): SkipMode => values[key] === 'auto' ? 'auto' : values[key] === 'off' ? 'off' : 'ask';
    return {intro: read('playback.introSkip'), recap: read('playback.recapSkip'), credits: read('playback.creditsSkip')};
  };
  // The viewer's subtitle style, read from the registry the server publishes and
  // written to the scope that registry allows; the panel renders only fields the
  // server actually publishes.
  const stylePort = (): NativeWatchStylePort | undefined => {
    const snapshot = context.preferences(), keys = ['playback.subtitleSize', 'playback.subtitleColor', 'playback.subtitleBackground', 'playback.subtitlePosition', 'playback.subtitleFont'];
    const fields = keys.flatMap(key => {
      const field = snapshot.registry.fields.find(entry => entry.key === key);
      if (!field?.allowedValues?.length) return [];
      return [{key, label: defaultI18n.t(field.labelKey as Parameters<typeof defaultI18n.t>[0]), current: String(snapshot.effective[key] ?? ''),
        values: field.allowedValues.map(value => ({value: String(value), label: browseValueLabel(String(value))}))}];
    });
    if (!fields.length) return undefined;
    return {fields, apply: async (key: string, value: string) => {
      const current = context.preferences(), field = current.registry.fields.find(entry => entry.key === key);
      const scope = (['profile-device', 'profile-device-class', 'profile-server'] as const).find(candidate => field?.scopes.includes(candidate));
      const document = scope ? current.documents.find(entry => entry.scope === scope) : undefined;
      if (!scope || !document) throw new Error('native_preferences_scope_missing');
      await nativeServerPreferences(context).applyPreferences(scope, current.deviceClass, document.revision, {[key]: value});
    }};
  };
  const sleepPort = (): NonNullable<NativeWatchPanelsProps['sleep']> => {
    const at = context.playback.getSnapshot().playback.listeningDeadlines?.sleepAtMs ?? null;
    return {minutes: at === null ? null : Math.max(0, Math.round((at - Date.now()) / 60_000)),
      set: async (fence, minutes) => {await context.playback.setSleepTimer?.(fence, minutes);}};
  };
  const noticePreferences = {
    subscribe: context.subscribePreferences,
    getSnapshot: () => {
      if (!current()) return false;
      try {return nativeDeviceSettings(context).read('lossNotices') === true;} catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'unsupported') return true;
        throw error;
      }
    },
  };
  const player: NativeWatchHostBindings = {
    noticePreferences,
    chrome: (source, runtime) => ({...nativeWatchChromeFacts(source, bindings.names ?? createNativeWatchPanelNames(runtime.text)), skipBackSeconds: skipSeconds(source, 'playback.skipBackMs'),
      skipForwardSeconds: skipSeconds(source, 'playback.skipForwardMs'), reportError: runtime.reportError, skipModes: skipModes(), artwork: runtime.artwork,
      onMinimize: fence => {if (current()) {const transition = context.playback.dock.collapse(fence); if (transition) void context.playback.onTransition(transition).catch(runtime.reportError);}},
      ...(context.playback.cast ? {onCast: fence => {if (current()) void context.playback.cast?.(fence).catch(runtime.reportError);}} : {}),
      ...(context.playback.goLive ? {goLive: fence => {if (current()) void context.playback.goLive!(fence).catch(runtime.reportError);}} : {}),
      // tablet-play8 / tv-player: the guide opens from the live player on a television
      // and on a tablet, where the mini guide docks beside the picture; a phone has none.
      ...(liveGuide ? {liveGuide} : {}),
      ...(liveActions ? {liveActions} : {}),
      ...(liveGuide ? {onGuide: liveGuide.guideAction()} : isTablet ? {onGuide: () => {if (current()) context.navigation.open({kind: 'shell', destination: {kind: 'live'}}, context.authority());}} : {}),
      ...(bindings.onPictureInPicture ? {onPictureInPicture: bindings.onPictureInPicture} : {}),
    }),
    panel: host => <NativeWatchPanels context={host} options={options} playback={context.playback} names={bindings.names ?? createNativeWatchPanelNames(host.runtime.text)} copy={copy}
      subtitleControls={fence => context.playback.subtitleControls?.(fence)} sleep={context.playback.setSleepTimer ? sleepPort() : undefined} style={stylePort()}
      reportError={host.runtime.reportError} renderError={bindings.title.renderError} playbackInfo={bindings.playbackInfo ?? (value => <NativePlaybackInfoPanel context={value} read={screens.readPlaybackInfo} renderError={bindings.title.renderError}/>)} episodes={bindings.episodes ?? screens.watch.episodes}/>,
    notice: (fence, lifetime) => screens.readPlaybackInfo(fence, playbackInfoWords(), lifetime).then(info => info?.notice),
    content: host => screens.watch.body(host),
    details: host => screens.watch.details(host),
    episodes: host => screens.watch.upNext(host),
    failed: (host, failure, chromeVisible) => {
      const route = {authority: context.authority(), revision: context.navigation.getSnapshot().revision};
      const live = context.playback.getSnapshot();
      const canRetry = live.capabilities.retry === true && !!context.playback.retry && !!live.fence && sameFence(live.fence, failure.fence);
      return <NativePlaybackFailed context={host} failure={failure} chromeVisible={chromeVisible}
        {...(canRetry ? {retry: () => {retryFailed(failure, route, host.runtime.reportError);}} : {})}/>;
    },
    postPlay: host => host.source.entry ? <NativeWatchPostPlay entry={host.source.entry} api={context.api} scope={detailScope} requestId={bindings.requestId} compact={!Platform.isTV}
      current={current} artwork={host.runtime.artwork} onReplay={() => {if (current()) void context.playback.replay(host.fence).catch(host.runtime.reportError);}}
      onClose={() => {if (current()) void context.playback.stop(host.fence).catch(host.runtime.reportError);}} onOpen={entry => {if (current()) bindings.title.navigate(entry);}}
      reportError={host.runtime.reportError}/> : null,
    presentation: bindings.presentation,
  };
  const screens = createNativeWatchScreens({...bindings, api: context.api,
    scope: detailScope,
    authority, current: context.authority, isCurrent: current, subscribeCurrent: context.subscribeAuthority,
    navigation: context.navigation, playback: context.playback, watch: context.watch, isTV: Platform.isTV, player});
  const entryMenu: NativeWatchEntryMenu = Object.freeze({
    open: (entry, entryCurrent, anchorRef, select) => current() ? screens.menu(entry, entryCurrent, anchorRef, select) : Promise.resolve(),
    isOpen: entry => {
      if (!current()) return false;
      const actual = bindings.title.menu?.getSnapshot();
      return !!actual && actual.id === entry.id && actual.kind === entry.kind && actual.libraryId === entry.libraryId;
    },
    subscribe: listener => current() && bindings.title.menu ? bindings.title.menu.subscribe(listener) : () => {},
  });
  return Object.freeze({
    entryMenu,
    render: (runtime: NativeShellRuntime) => current() ? screens.watch.render(runtime) : null,
    title: screens.title,
    channel: {render: (route: import('../../shell/routes').NativeShellRoute) => current() && route.kind === 'channel'
      ? <NativeWatchChannelRoute key={JSON.stringify([route.sourceId, route.channelId])} context={context} route={route} title={bindings.title}/> : null},
    renderOverlays: (runtime: NativeShellRuntime) => current() ? <>{bindings.renderOverlays?.(runtime)}{liveActions && <NativeLiveActionPanels actions={liveActions} context={context} runtime={runtime}/>}</> : null,
    back: () => {
      if (!current()) return false;
      if (liveActions?.close()) return true;
      if (liveGuide?.close()) return true;
      const group = Platform.isTV ? groupPort() : undefined;
      if (group?.playerVisible?.() === false) return context.navigation.back(context.authority());
      return screens.watch.back() || group?.closePlayer?.() === true;
    },
    screens,
    dispose: () => {if (disposed) return; disposed = true; liveActions?.dispose(); liveGuide?.dispose(); abortAll(); stopPlayback(); stopGroup(); stopNavigation(); stopAuthority(); options.dispose(); screens.dispose(); bindings.presentation?.(undefined); bindings.dispose?.();},
  });
}
