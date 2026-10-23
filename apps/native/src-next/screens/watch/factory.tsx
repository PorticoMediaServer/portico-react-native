import React, {useSyncExternalStore} from 'react';
import type {View} from 'react-native';
import type {HttpLocalApi} from '../../../../../packages/client-core/src';
import type {DetailScope} from '../../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {ManageAction, TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import {PlaybackOptionsClient} from '../../../../../packages/client-core/src/playback-v1/options';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import type {NativePlaybackAdapter, NativePlaybackVersionSelection} from '../../platform/playback/types';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import type {NativeShellNavigation} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeWatchOutletPort} from '../../shell/watch-outlet';
import {NativeTitleController} from './title-controller';
import {NativeTitleScreen, type NativeTitleScreenProps} from './TitleScreen';
import {NativeFileInfoContent} from './FileInfoContent';
import {readNativeFileInfo} from './file-info';
import {nativeWatchTracks} from './track-identity';
import {nativeVersionChoices, type NativeVersionPresentation} from './version-options';
import {NativeWatchControls, type NativeWatchControlContext, type NativeWatchPanel} from './controls';
import {NativeWatchChrome, type NativeWatchChromeProps} from './WatchChrome';
import {NativeWatchPicture, type NativeWatchPictureProps} from './picture-slot';
import {NativeWatchHost, type NativeWatchHostBindings} from './WatchHost';

export type NativeWatchCapture = Readonly<{
  entry: ContentEntry;
  authority: ShellAuthority;
  routeRevision: number;
  expectedFence: PlaybackFence | undefined;
  /** The actual entry owner's lifetime, including removal or a replaced row. */
  current: () => boolean;
}>;
/** Required host lifetime agreed with the command owner. The checked consumer
 * is composed only with the canonical guarded core/runtime MAIN seam. */
export type NativeVersionLifetime = Readonly<{signal: AbortSignal; isCurrent: () => boolean}>;
export type NativeVersionStartSelection = NativePlaybackVersionSelection & Readonly<{lifetime: NativeVersionLifetime}>;
export type NativeWatchMenuActions = Readonly<{fileInfo: () => Promise<void>; differentVersion?: () => Promise<void>}>;
export type NativeVersionDestination = Readonly<{
  title: string;
  subject: string;
  options: PlaybackOptions;
  rows: ReturnType<typeof nativeVersionChoices>;
  selectedVersionId?: string;
  isCurrent: () => boolean;
  subscribe: (listener: () => void) => () => void;
  dispose: () => void;
  choose: (versionId: string) => Promise<boolean>;
}>;
export type NativeWatchFactoryPorts = Readonly<{
  api: HttpLocalApi;
  text: TextEnvironment;
  scope: DetailScope;
  authority: ShellAuthority;
  current: () => ShellAuthority;
  subscribeCurrent: (listener: () => void) => () => void;
  navigation: Pick<NativeShellNavigation, 'getSnapshot' | 'subscribe' | 'back'>;
  playback: NativePlaybackAdapter;
  watch: NativeWatchOutletPort;
  /** Bound by the genuine assembly. Optional only for older descriptor fixtures. */
  player?: NativeWatchHostBindings;
  requestId: () => Promise<string>;
  isTV: boolean;
  manageFile: (capture: NativeWatchCapture, action: ManageAction['id'], fileId?: string) => void;
  openFileInfo: (capture: NativeWatchCapture, content: React.ReactNode) => void;
  /** The bound presenter follows the phone sheet / TV panel flow in ruling 21. */
  openVersions?: (capture: NativeWatchCapture, destination: NativeVersionDestination) => void;
  /** Exact localized ruling-21 copy/facts supplied by the canonical formatter. */
  versionPresentation?: NativeVersionPresentation;
  openMenu: (capture: NativeWatchCapture, actions: NativeWatchMenuActions, anchorRef?: React.RefObject<View | null>) => void;
  title: Pick<NativeTitleScreenProps, 'aboutLabel' | 'renderError' | 'reportError' | 'navigate'> & Readonly<{
    myList: (entry: ContentEntry) => NativeTitleScreenProps['myList'];
    download?: NativeTitleScreenProps['download'];
    menu?: NativeTitleScreenProps['menu'];
    selection?: NativeTitleScreenProps['selection'];
  }>;
}>;
const titleKey = (entry: ContentEntry) => JSON.stringify([entry.libraryId, entry.kind, entry.id]);
const sameOptionalFence = (a: PlaybackFence | undefined, b: PlaybackFence | undefined) => b ? sameFence(a, b) : !a;

/** Explicit descriptors and disposal for the genuine assembly; importing never registers a route. */
export function createNativeWatchScreens(ports: NativeWatchFactoryPorts) {
  const controllers = new Map<string, NativeTitleController>(), requests = new Map<AbortController, NativeWatchCapture>(), lifetimes = new Map<AbortController, NativeWatchCapture>();
  const options = new PlaybackOptionsClient(localV1Http(ports.api)), controls = new NativeWatchControls(ports.isTV);
  let disposed = false;
  let context: Omit<NativeWatchControlContext, 'expanded' | 'paused'> = {autoHide: true, hiddenByPanel: false, scrubbing: false, focusHeld: false};
  const alive = () => !disposed && sameAuthority(ports.authority, ports.current());
  const update = () => {
    for (const [request, captured] of requests) if (!current(captured)) request.abort();
    for (const [lifetime, captured] of lifetimes) if (!hostCurrent(captured)) lifetime.abort();
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
  const request = async <T,>(captured: NativeWatchCapture, run: (signal: AbortSignal) => Promise<T>, parentSignal?: AbortSignal): Promise<T | undefined> => {
    if (!current(captured) || parentSignal?.aborted) return;
    const controller = new AbortController(); requests.set(controller, captured);
    const abort = () => controller.abort(); parentSignal?.addEventListener('abort', abort);
    try {const result = await run(controller.signal); return !controller.signal.aborted && current(captured) ? result : undefined;}
    finally {parentSignal?.removeEventListener('abort', abort); requests.delete(controller);}
  };
  const fileInfo = async (captured: NativeWatchCapture): Promise<void> => {
    if (!captured.entry.libraryId) return;
    const info = await request(captured, async signal => {
      const offered = await options.options(captured.entry.id, {}, signal);
      return readNativeFileInfo(ports.api, ports.scope, {libraryId: captured.entry.libraryId!, itemId: captured.entry.id}, offered, ports.text, ports.isTV, signal);
    });
    if (!info || !current(captured)) return;
    ports.openFileInfo(captured, <NativeFileInfoContent model={info.model} locations={info.locations} onManage={(action, id) => {if (current(captured)) ports.manageFile(captured, action, id);}}/>);
  };
  const publishVersions = (captured: NativeWatchCapture, offered: PlaybackOptions, excludeVersionId?: string, minimum = 2) => {
    if (!ports.openVersions || !ports.versionPresentation || !current(captured)) return;
    const rows = nativeVersionChoices(offered, captured.entry.id, ports.text, ports.versionPresentation, excludeVersionId, minimum);
    if (!rows.length) return;
    const lifetime = new AbortController(); lifetimes.set(lifetime, captured);
    lifetime.signal.addEventListener('abort', () => {lifetimes.delete(lifetime);}, {once: true});
    const hostLifetime: NativeVersionLifetime = Object.freeze({signal: lifetime.signal, isCurrent: () => !lifetime.signal.aborted && hostCurrent(captured)});
    const destinationCurrent = () => hostLifetime.isCurrent() && current(captured);
    const source = ports.playback.getSnapshot();
    const selectedVersionId = source.session?.itemId === captured.entry.id ? nativeWatchTracks(source).version?.id : undefined;
    ports.openVersions(captured, Object.freeze({title: ports.versionPresentation.title, subject: captured.entry.displayTitle ?? captured.entry.title, options: offered, rows, selectedVersionId,
      subscribe: (listener: () => void) => {const off = [ports.subscribeCurrent(listener), ports.navigation.subscribe(listener), ports.playback.subscribe(listener)]; lifetime.signal.addEventListener('abort', listener); return () => {lifetime.signal.removeEventListener('abort', listener); for (const dispose of off) dispose();};},
      dispose: () => lifetime.abort(),
      isCurrent: destinationCurrent, choose: async (versionId: string) => {
        if (!destinationCurrent() || !rows.some(version => version.id === versionId)) return false;
        const target = captured.entry.playback;
        if (!target || target.itemId !== captured.entry.id) return false;
        const fresh = await request(captured, signal => options.options(captured.entry.id, {}, signal), lifetime.signal);
        if (!fresh || fresh.itemId !== captured.entry.id || new Set(fresh.versions.map(version => version.id)).size !== fresh.versions.length
          || !fresh.versions.some(version => version.id === versionId) || versionId === excludeVersionId) return false;
        const resumeMs = fresh.resume?.positionMs ?? 0;
        if (!Number.isFinite(resumeMs) || resumeMs < 0) return false;
        const selection: NativeVersionStartSelection = {authority: captured.authority, options: fresh, versionId, expectedFence: captured.expectedFence, lifetime: hostLifetime};
        await ports.playback.startVersion({entry: captured.entry, target: {...target, startSeconds: resumeMs / 1000}}, selection);
        return hostLifetime.isCurrent();
      }}));
  };
  const versions = async (captured: NativeWatchCapture): Promise<void> => {
    if (!ports.openVersions || captured.entry.playback?.itemId !== captured.entry.id) return;
    const fresh = await request(captured, signal => options.options(captured.entry.id, {}, signal));
    if (fresh) publishVersions(captured, fresh);
  };
  const versionsAfterFailure = async (captured: NativeWatchCapture, failed: Readonly<{fence: PlaybackFence; versionId: string}>): Promise<void> => {
    if (!ports.openVersions || !ports.versionPresentation || !current(captured) || failed.fence.kind !== 'queue' || !sameFence(captured.expectedFence, failed.fence)) return;
    const source = ports.playback.getSnapshot(), session = source.session;
    if (source.retired || !sameFence(source.fence, failed.fence) || !session || session.itemId !== captured.entry.id
      || session.itemId !== failed.fence.itemId || session.id !== failed.fence.sessionId || session.versionId !== failed.versionId
      || session.versionId !== failed.fence.sourceId || session.presentation.generation !== failed.fence.generation || session.queue?.entryId !== failed.fence.entryId) return;
    const fresh = await request(captured, signal => options.options(captured.entry.id, {}, signal));
    if (fresh) publishVersions(captured, fresh, failed.versionId, 1);
  };
  const menu = async (entry: ContentEntry, entryCurrent: () => boolean, anchorRef?: React.RefObject<View | null>): Promise<void> => {
    const captured = capture(entry, entryCurrent);
    if (!captured) return;
    // A failed options read must not replace the independent real File info action.
    const offered = entry.playback?.itemId === entry.id ? await request(captured, signal => options.options(entry.id, {}, signal)).catch(error => {if (current(captured)) ports.title.reportError(error); return undefined;}) : undefined;
    if (!current(captured)) return;
    const hasVersions = !!ports.openVersions && !!ports.versionPresentation && !!offered && offered.itemId === entry.id && offered.versions.length >= 2 && new Set(offered.versions.map(version => version.id)).size === offered.versions.length;
    ports.openMenu(captured, {fileInfo: () => fileInfo(captured), ...(hasVersions ? {differentVersion: () => versions(captured)} : {})}, anchorRef);
  };
  const title: NativeRouteRenderer = {
    render: (route, runtime) => {
      if (!alive() || route.kind !== 'title') return null;
      const key = titleKey(route.entry);
      let controller = controllers.get(key);
      if (!controller) {
        controller = new NativeTitleController({...ports, entry: route.entry}); controllers.set(key, controller);
      }
      return <NativeTitleScreen {...ports.title} key={key} controller={controller} text={runtime.text} artwork={runtime.artwork} ambient={runtime.ambient}
        back={() => {ports.navigation.back(ports.authority);}} more={(entry, anchorRef) => {
          const owner = controller!;
          void menu(entry, () => {
            const state = owner.getSnapshot();
            return !state.retired && (titleKey(state.entry) === titleKey(entry)
              || state.episodes.some(item => titleKey(item) === titleKey(entry))
              || state.detail?.data?.related?.rows.some(row => row.entries.some(item => titleKey(item) === titleKey(entry))) === true);
          }, anchorRef).catch(ports.title.reportError);
        }}
        myList={ports.title.myList(route.entry)} download={ports.title.download}/>;
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
      /** Assembly calls this before its existing player/destination Back handling. */
      back: () => {const fence = ports.playback.getSnapshot().fence; if (!alive() || !fence) return false; const result = controls.back(fence); return result === 'panel' || result === 'controls';}}),
    controls,
    menu,
    fileInfo,
    versions,
    versionsAfterFailure,
    capture,
    isCurrent: current,
    setPresentation,
    renderWatch: (props: Omit<NativeWatchChromeProps, 'controls' | 'playback' | 'source'>) => alive() ? <Watch {...props}/> : null,
    renderPictureSlot: (props: Omit<NativeWatchPictureProps, 'outlet' | 'authority'>) => alive() ? <NativeWatchPicture {...props} authority={ports.authority} outlet={ports.watch}/> : null,
    releaseTitle: (entry: ContentEntry) => {const key = titleKey(entry); controllers.get(key)?.dispose(); controllers.delete(key);},
    dispose: () => {if (disposed) return; disposed = true; offPlayback(); offAuthority(); offRoute(); for (const request of requests.keys()) request.abort(); requests.clear(); for (const lifetime of lifetimes.keys()) lifetime.abort(); lifetimes.clear(); for (const controller of controllers.values()) controller.dispose(); controllers.clear(); controls.dispose();},
  });
  function Watch(props: Omit<NativeWatchChromeProps, 'controls' | 'playback' | 'source'>) {
    const source = useSyncExternalStore(ports.playback.subscribe, ports.playback.getSnapshot);
    return alive() ? <NativeWatchChrome {...props} source={source} playback={ports.playback} controls={controls}/> : null;
  }
}
