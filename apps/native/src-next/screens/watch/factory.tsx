import React, {useSyncExternalStore} from 'react';
import type {View} from 'react-native';
import type {HttpLocalApi} from '../../../../../packages/client-core/src';
import {DetailService, type DetailProjection, type DetailScope, type PersonalIntent} from '../../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {ManageAction} from '../../../../../packages/client-core/src/presentation/kit-model';
import {PlaybackOptionsClient} from '../../../../../packages/client-core/src/playback-v1/options';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativePlaybackAdapter, NativePlaybackReadLifetime, NativePlaybackStart, NativePlaybackVersionSelection} from '../../platform/playback/types';
import type {PlaybackInfoWords} from '../../../../../packages/client-core/src/playback-info-projection';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import type {NativeShellNavigation} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeWatchOutletPort} from '../../shell/watch-outlet';
import {NativeTitleController} from './title-controller';
import {NativeTitleStarts} from './title-starts';
import {NativeTitleScreen, type NativeTitleScreenProps} from './TitleScreen';
import {NativeFileInfoContent} from './FileInfoContent';
import {readNativeFileInfo, type NativeFileInfo} from './file-info';
import {readNativePlaybackInfo} from './playback-info';
import {nativeWatchTracks} from './track-identity';
import {nativeVersionChoices, nativeVersionNames} from './version-options';
import {NativeVersionChooserController} from './version-destination';
import {NativeWatchControls, type NativeWatchControlContext, type NativeWatchPanel} from './controls';
import {NativeWatchChrome, type NativeWatchChromeProps} from './WatchChrome';
import {NativeWatchPicture, type NativeWatchPictureProps} from './picture-slot';
import {NativeWatchHost, type NativeWatchHostBindings, type NativeWatchHostContext} from './WatchHost';

export type NativeWatchCapture = Readonly<{
  entry: ContentEntry;
  authority: ShellAuthority;
  routeRevision: number;
  expectedFence: PlaybackFence | undefined;
  /** The actual entry owner's lifetime, including removal or a replaced row. */
  current: () => boolean;
}>;
export type NativeVersionStartSelection = NativePlaybackVersionSelection;
/** The real menu producers for the captured entry: one lazy detail read, its
 * personal actions, the server's own playback target and the title route. */
export type NativeWatchMenuEntry = Readonly<{
  current: () => DetailProjection | undefined;
  subscribe: (listener: () => void) => () => void;
  play?: () => Promise<void>;
  mutate: (intent: PersonalIntent) => Promise<void>;
  details?: () => void;
  dispose: () => void;
}>;
export type NativeWatchMenuActions = Readonly<{fileInfo: () => Promise<void>; differentVersion?: () => Promise<void>; entry?: NativeWatchMenuEntry}>;
export type NativeVersionDestination = NativeVersionChooserController;
export type NativeWatchFactoryPorts = Readonly<{
  api: HttpLocalApi;
  scope: DetailScope;
  authority: ShellAuthority;
  current: () => ShellAuthority;
  /** Genuine bootstrap lifetime, separate from the current playback output. */
  isCurrent?: () => boolean;
  subscribeCurrent: (listener: () => void) => () => void;
  navigation: Pick<NativeShellNavigation, 'getSnapshot' | 'subscribe' | 'back'>;
  playback: NativePlaybackAdapter;
  watch: NativeWatchOutletPort;
  /** Bound by the genuine assembly. Optional only for older descriptor fixtures. */
  player?: NativeWatchHostBindings;
  requestId: () => Promise<string>;
  isTV: boolean;
  /** Bound to Android's real fenced runtime command after it lands on MAIN. */
  startVersion?: (input: NativePlaybackStart, selection: NativeVersionStartSelection) => Promise<void>;
  manageFile: (capture: NativeWatchCapture, action: ManageAction['id'], fileId?: string) => void;
  openFileInfo: (capture: NativeWatchCapture, content: React.ReactNode, owner: Readonly<{info: NativeFileInfo; changed: () => Promise<void>}>) => void;
  /** The bound presenter follows the phone sheet / TV panel flow in ruling 21. */
  openVersions?: (capture: NativeWatchCapture, destination: NativeVersionDestination) => void;
  openMenu: (capture: NativeWatchCapture, actions: NativeWatchMenuActions, anchorRef?: React.RefObject<View | null>) => void;
  title: Pick<NativeTitleScreenProps, 'aboutLabel' | 'renderError' | 'reportError' | 'navigate' | 'person'> & Readonly<{
    myList?: (entry: ContentEntry) => NativeTitleScreenProps['myList'];
    download?: NativeTitleScreenProps['download'];
    menu?: NativeTitleScreenProps['menu'];
    selection?: NativeTitleScreenProps['selection'];
  }>;
}>;
const titleKey = (entry: ContentEntry) => JSON.stringify([entry.libraryId, entry.kind, entry.id]);
const sameOptionalFence = (a: PlaybackFence | undefined, b: PlaybackFence | undefined) => b ? sameFence(a, b) : !a;


/** Explicit descriptors and disposal for the genuine assembly; importing never registers a route. */
export function createNativeWatchScreens(ports: NativeWatchFactoryPorts) {
  const controllers = new Map<string, NativeTitleController>(), controllerSubscriptions = new Map<string, () => void>(), requests = new Map<AbortController, () => boolean>();
  const options = new PlaybackOptionsClient(localV1Http(ports.api)), controls = new NativeWatchControls(ports.isTV);
  const destinations = new Set<NativeVersionChooserController>();
  let disposed = false;
  let context: Omit<NativeWatchControlContext, 'expanded' | 'paused'> = {autoHide: true, hiddenByPanel: false, scrubbing: false, focusHeld: false};
  const alive = () => !disposed && ports.isCurrent?.() !== false && sameAuthority(ports.authority, ports.current());
  const starts = new NativeTitleStarts({current: () => alive() && sameAuthority(ports.navigation.getSnapshot().authority, ports.authority),
    revision: () => ports.navigation.getSnapshot().revision, start: ports.playback.start});
  const update = () => {
    starts.invalidate();
    for (const destination of destinations) if (!destination.isCurrent()) {destination.dispose(); destinations.delete(destination);}
    for (const [request, valid] of requests) if (!valid()) request.abort();
    const source = ports.playback.getSnapshot();
    controls.source(alive() && sameAuthority(source.authority, ports.authority) && !source.retired ? source.fence : undefined,
      {...context, expanded: source.dock.local?.expanded === true, paused: source.playback.intent === 'paused'});
  };
  const hostCurrent = (capture: NativeWatchCapture) => {
    const route = ports.navigation.getSnapshot();
    return alive() && sameAuthority(capture.authority, ports.current()) && sameAuthority(route.authority, capture.authority)
      && route.revision === capture.routeRevision && capture.current();
  };
  const current = (capture: NativeWatchCapture) => hostCurrent(capture) && sameOptionalFence(ports.playback.getSnapshot().fence, capture.expectedFence);
  const capture = (entry: ContentEntry, entryCurrent: () => boolean): NativeWatchCapture | undefined => {
    const value = Object.freeze({entry, current: entryCurrent, authority: ports.authority, routeRevision: ports.navigation.getSnapshot().revision, expectedFence: ports.playback.getSnapshot().fence});
    return current(value) ? value : undefined;
  };
  const request = async <T,>(captured: NativeWatchCapture | (() => boolean), run: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T | undefined> => {
    const valid = typeof captured === 'function' ? captured : () => current(captured);
    if (signal?.aborted || !valid()) return;
    const controller = new AbortController(), abort = () => controller.abort(); requests.set(controller, valid);
    signal?.addEventListener('abort', abort, {once: true});
    try {const result = await run(controller.signal); return !controller.signal.aborted && valid() ? result : undefined;}
    finally {requests.delete(controller); signal?.removeEventListener('abort', abort);}
  };
  const readPlaybackInfo = (fence: PlaybackFence, words: PlaybackInfoWords, lifetime: NativePlaybackReadLifetime) => {
    const revision = ports.navigation.getSnapshot().revision;
    const valid = () => alive() && !lifetime.signal.aborted && lifetime.isCurrent()
      && sameAuthority(ports.navigation.getSnapshot().authority, ports.authority) && ports.navigation.getSnapshot().revision === revision;
    return request(valid, signal => readNativePlaybackInfo(ports.playback, fence, words, {signal, isCurrent: valid}), lifetime.signal);
  };
  const createTitleController = (key: string, entry: ContentEntry, body = false): NativeTitleController => {
    let owner: NativeTitleController;
    const memberCurrent = (member: ContentEntry) => {
      const state = owner.getSnapshot();
      return controllers.get(key) === owner && !state.retired && (titleKey(state.entry) === titleKey(member) || state.episodes.some(value => titleKey(value) === titleKey(member))
        || state.detail?.data?.related?.rows.some(row => row.entries.some(value => titleKey(value) === titleKey(member))) === true);
    };
    owner = new NativeTitleController({...ports, entry, playback: {start: async input => {
      const route = ports.navigation.getSnapshot().route, source = ports.playback.getSnapshot();
      const visible = body ? source.dock.local?.expanded === true && !!source.entry && titleKey(source.entry) === titleKey(entry)
        : route.kind === 'title' && titleKey(route.entry) === titleKey(entry);
      if (visible) await starts.start(input, () => memberCurrent(input.entry));
    }}});
    controllers.set(key, owner); controllerSubscriptions.set(key, owner.subscribe(starts.invalidate));
    return owner;
  };
  const fileInfo = async (captured: NativeWatchCapture): Promise<void> => {
    if (!captured.entry.libraryId) return;
    const info = await request(captured, async signal => {
      const offered = await options.options(captured.entry.id, {}, signal);
      return readNativeFileInfo(ports.api, ports.scope, {libraryId: captured.entry.libraryId!, itemId: captured.entry.id}, offered, {t: defaultI18n.t}, ports.isTV, signal);
    });
    if (!info || !current(captured)) return;
    ports.openFileInfo(captured, <NativeFileInfoContent model={info.model} locations={info.locations} onManage={(action, id) => {if (current(captured)) ports.manageFile(captured, action, id);}}/>, {info,
      changed: async () => {if (current(captured)) await Promise.all([...controllers.values()].filter(controller => titleKey(controller.entry) === titleKey(captured.entry)).map(async controller => {
        const state = controller.getSnapshot();
        if (state.detail?.data) await controller.detail.refresh();
        if (state.workspace?.data) await controller.workspace.retry();
      }));}});
  };
  const publishVersions = (captured: NativeWatchCapture, offered: PlaybackOptions, failedVersionId?: string) => {
    const startVersion = ports.startVersion;
    if (!ports.openVersions || !startVersion || !current(captured) || offered.itemId !== captured.entry.id || (failedVersionId === undefined ? offered.versions.length < 2 : !offered.versions.length) || new Set(offered.versions.map(version => version.id)).size !== offered.versions.length) return;
    const source = ports.playback.getSnapshot();
    const selectedVersionId = source.session?.itemId === captured.entry.id ? nativeWatchTracks(source).version?.id : undefined;
    const destination = new NativeVersionChooserController({capture: captured, options: offered,
      rows: nativeVersionChoices(offered, captured.entry.id, nativeVersionNames(defaultI18n.t, defaultI18n.locale), failedVersionId), selectedVersionId,
      hostCurrent: () => hostCurrent(captured), sourceCurrent: () => current(captured), start: startVersion, onDispose: () => {destinations.delete(destination);}});
    if (!destination.rows.length) {destination.dispose(); return;}
    destinations.add(destination); ports.openVersions(captured, destination);
  };
  const versions = async (captured: NativeWatchCapture, failedVersionId?: string): Promise<void> => {
    if (!ports.openVersions || !ports.startVersion || captured.entry.playback?.itemId !== captured.entry.id) return;
    if (failedVersionId !== undefined) {
      const source = ports.playback.getSnapshot();
      if (!current(captured) || source.playback.phase !== 'error' || source.session?.itemId !== captured.entry.id || source.session.versionId !== failedVersionId) return;
    }
    const fresh = await request(captured, signal => options.options(captured.entry.id, {}, signal));
    if (fresh) publishVersions(captured, fresh, failedVersionId);
  };

  const menu = async (entry: ContentEntry, entryCurrent: () => boolean, anchorRef?: React.RefObject<View | null>): Promise<void> => {
    const captured = capture(entry, entryCurrent);
    if (!captured) return;
    // A failed options read must not replace the independent real File info action.
    const offered = entry.playback?.itemId === entry.id ? await request(captured, signal => options.options(entry.id, {}, signal)).catch(error => {if (current(captured)) ports.title.reportError(error); return undefined;}) : undefined;
    if (!current(captured)) return;
    const hasVersions = !!ports.openVersions && !!ports.startVersion && !!offered && offered.itemId === entry.id && offered.versions.length >= 2 && new Set(offered.versions.map(version => version.id)).size === offered.versions.length;
    // The entry's own live detail owns the personal rows, Play/Resume target and
    // Details route. An unreadable detail keeps the independent File info menu.
    let detail: DetailService | undefined;
    if (entry.libraryId) {
      const candidate = new DetailService({api: ports.api, scope: ports.scope, requestId: ports.requestId});
      try {await candidate.select({libraryId: entry.libraryId, itemId: entry.id});}
      catch {candidate.dispose();}
      if (!current(captured)) {candidate.dispose(); return;}
      if (!candidate.getSnapshot().data) candidate.dispose(); else detail = candidate;
    }
    const projection = detail?.getSnapshot().data;
    const primary = projection?.actions.find(action => action.enabled && action.playback && action.id !== 'start_over')?.playback ?? entry.playback;
    const route = ports.navigation.getSnapshot().route, onTitle = route.kind === 'title' && titleKey(route.entry) === titleKey(entry);
    const menuEntry: NativeWatchMenuEntry | undefined = detail ? Object.freeze({
      current: () => detail!.getSnapshot().data ?? undefined,
      subscribe: listener => detail!.subscribe(listener),
      ...(primary ? {play: async () => {
        const operation = new AbortController();
        await ports.playback.start({entry, target: primary, lifetime: {signal: operation.signal, isCurrent: () => current(captured)}});
      }} : {}),
      mutate: async (intent: PersonalIntent) => {await detail!.mutate(intent);},
      ...(onTitle ? {} : {details: () => {if (current(captured)) ports.title.navigate(entry);}}),
      dispose: () => {detail?.dispose(); detail = undefined;},
    }) : undefined;
    if (detail && !current(captured)) {detail.dispose(); return;}
    ports.openMenu(captured, {fileInfo: () => fileInfo(captured), ...(hasVersions ? {differentVersion: () => versions(captured)} : {}), ...(menuEntry ? {entry: menuEntry} : {})}, anchorRef);
  };
  const title: NativeRouteRenderer = {
    render: (route, runtime) => {
      if (!alive() || route.kind !== 'title') return null;
      const key = titleKey(route.entry);
      let controller = controllers.get(key);
      if (!controller) {
        controller = createTitleController(key, route.entry);
      }
      return <NativeTitleScreen {...ports.title} key={key} controller={controller} text={runtime.text} artwork={runtime.artwork} ambient={runtime.ambient}
        back={() => {ports.navigation.back(ports.authority);}} more={(entry, anchorRef) => {
          const owner = controller!;
          void menu(entry, () => {
            const state = owner.getSnapshot();
            return controllers.get(key) === owner && !state.retired && (titleKey(state.entry) === titleKey(entry)
              || state.episodes.some(item => titleKey(item) === titleKey(entry))
              || state.detail?.data?.related?.rows.some(row => row.entries.some(item => titleKey(item) === titleKey(entry))) === true);
          }, anchorRef).catch(ports.title.reportError);
        }}
        myList={ports.title.myList?.(route.entry)} download={ports.title.download}/>;
    },
  };
  const offPlayback = ports.playback.subscribe(update), offAuthority = ports.subscribeCurrent(update), offRoute = ports.navigation.subscribe(update);
  update();
  const setPresentation = (value: typeof context) => {context = value; update();};
  return Object.freeze({
    title,
    watch: Object.freeze({render: (runtime: NativeShellRuntime) => alive() && ports.player
      ? <NativeWatchHost authority={ports.authority} current={ports.current} playback={ports.playback} outlet={ports.watch} runtime={runtime}
          controls={controls} bindings={ports.player} setPresentation={setPresentation} isTV={ports.isTV}/> : null,
      /** Phone-player4 reuses a real retained title body. Its controller is
       * separate from the underlying route's memory and survives geometry. */
      body: (host: NativeWatchHostContext) => {
        const source = host.source, entry = source.entry, pane = host.layout.content;
        if (!alive() || ports.isTV || host.layout.mode !== 'watch' || !pane || !entry?.libraryId || source.retired || host.fence.kind !== 'queue'
          || !sameFence(ports.playback.getSnapshot().fence, host.fence) || entry.id !== host.fence.itemId) return null;
        const key = `watch:${titleKey(entry)}`;
        let controller = controllers.get(key);
        if (!controller) controller = createTitleController(key, entry, true);
        const owner = controller;
        return <NativeTitleScreen {...ports.title} key={key} controller={owner} text={host.runtime.text} artwork={host.runtime.artwork} ambient={host.runtime.ambient}
          watch={{source, playback: ports.playback, width: pane.width}} back={() => {ports.navigation.back(ports.authority);}}
          myList={ports.title.myList?.(entry)} download={ports.title.download} more={(member, anchorRef) => {
            void menu(member, () => {
              const state = owner.getSnapshot(), active = ports.playback.getSnapshot();
              return !state.retired && !active.retired && active.dock.local?.expanded === true && !!active.entry && titleKey(active.entry) === titleKey(entry)
                && (titleKey(state.entry) === titleKey(member) || state.episodes.some(value => titleKey(value) === titleKey(member))
                || state.detail?.data?.related?.rows.some(row => row.entries.some(value => titleKey(value) === titleKey(member))) === true);
            }, anchorRef).catch(ports.title.reportError);
          }}/>;
      },
      /** Assembly calls this before its existing player/destination Back handling. */
      back: () => {const fence = ports.playback.getSnapshot().fence; if (!alive() || !fence) return false; const result = controls.back(fence); return result === 'panel' || result === 'controls';}}),
    controls,
    menu,
    fileInfo,
    readPlaybackInfo,
    versions,
    capture,
    isCurrent: current,
    setPresentation,
    renderWatch: (props: Omit<NativeWatchChromeProps, 'controls' | 'playback' | 'source'>) => alive() ? <Watch {...props}/> : null,
    renderPictureSlot: (props: Omit<NativeWatchPictureProps, 'outlet' | 'authority'>) => alive() ? <NativeWatchPicture {...props} authority={ports.authority} outlet={ports.watch}/> : null,
    releaseTitle: (entry: ContentEntry) => {const key = titleKey(entry); controllerSubscriptions.get(key)?.(); controllerSubscriptions.delete(key); controllers.get(key)?.dispose(); controllers.delete(key); starts.invalidate();},
    /** Actual playback lifetime end only; never a dock/fold/full-window change. */
    releaseWatchBody: (entry: ContentEntry) => {const key = `watch:${titleKey(entry)}`; controllerSubscriptions.get(key)?.(); controllerSubscriptions.delete(key); controllers.get(key)?.dispose(); controllers.delete(key); starts.invalidate();},
    dispose: () => {if (disposed) return; disposed = true; for (const destination of destinations) destination.dispose(); destinations.clear(); starts.dispose(); for (const off of controllerSubscriptions.values()) off(); controllerSubscriptions.clear(); offPlayback(); offAuthority(); offRoute(); for (const request of requests.keys()) request.abort(); requests.clear(); for (const controller of controllers.values()) controller.dispose(); controllers.clear(); controls.dispose();},
  });
  function Watch(props: Omit<NativeWatchChromeProps, 'controls' | 'playback' | 'source'>) {
    const source = useSyncExternalStore(ports.playback.subscribe, ports.playback.getSnapshot);
    return alive() ? <NativeWatchChrome {...props} source={source} playback={ports.playback} controls={controls}/> : null;
  }
}
