import React, {useSyncExternalStore} from 'react';
import type {HttpLocalApi} from '../../../../../packages/client-core/src';
import type {DetailScope} from '../../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {ManageAction} from '../../../../../packages/client-core/src/presentation/kit-model';
import {PlaybackOptionsClient} from '../../../../../packages/client-core/src/playback-v1/options';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import type {PlaybackOptions} from '../../../../../packages/client-core/src/playback-v1/types';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativePlaybackAdapter, NativePlaybackStart} from '../../platform/playback/types';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import type {NativeRouteRenderer} from '../../shell/route-registry';
import type {NativeShellNavigation} from '../../shell/routes';
import {NativeTitleController} from './title-controller';
import {NativeTitleScreen, type NativeTitleScreenProps} from './TitleScreen';
import {NativeFileInfoContent} from './FileInfoContent';
import {readNativeFileInfo} from './file-info';
import {nativeWatchTracks} from './track-identity';
import {NativeVersionChoices} from './VersionChoices';
import {NativeWatchControls, type NativeWatchControlContext, type NativeWatchPanel} from './controls';
import {NativeWatchChrome, type NativeWatchChromeProps} from './WatchChrome';
import {NativeWatchPicture, type NativeWatchPictureOutlet, type NativeWatchPictureProps} from './picture-slot';

export type NativeWatchCapture = Readonly<{
  entry: ContentEntry;
  authority: ShellAuthority;
  routeRevision: number;
  expectedFence: PlaybackFence | undefined;
  /** The actual entry owner's lifetime, including removal or a replaced row. */
  current: () => boolean;
}>;
export type NativeVersionStartSelection = Readonly<{
  authority: ShellAuthority;
  options: PlaybackOptions;
  versionId: string;
  expectedFence: PlaybackFence | undefined;
}>;
export type NativeWatchMenuActions = Readonly<{fileInfo: () => Promise<void>; differentVersion?: () => Promise<void>}>;
export type NativeWatchFactoryPorts = Readonly<{
  api: HttpLocalApi;
  scope: DetailScope;
  authority: ShellAuthority;
  current: () => ShellAuthority;
  subscribeCurrent: (listener: () => void) => () => void;
  navigation: Pick<NativeShellNavigation, 'getSnapshot' | 'subscribe' | 'back'>;
  playback: NativePlaybackAdapter;
  watch: NativeWatchPictureOutlet;
  requestId: () => Promise<string>;
  isTV: boolean;
  /** Bound to Android's real fenced runtime command after it lands on MAIN. */
  startVersion: (input: NativePlaybackStart, selection: NativeVersionStartSelection) => Promise<void>;
  manageFile: (capture: NativeWatchCapture, action: ManageAction['id'], fileId?: string) => void;
  openFileInfo: (capture: NativeWatchCapture, content: React.ReactNode) => void;
  openVersions: (capture: NativeWatchCapture, content: React.ReactNode) => void;
  openMenu: (capture: NativeWatchCapture, actions: NativeWatchMenuActions) => void;
  title: Pick<NativeTitleScreenProps, 'aboutLabel' | 'renderError' | 'reportError' | 'navigate'> & Readonly<{
    myList: (entry: ContentEntry) => NativeTitleScreenProps['myList'];
    download?: NativeTitleScreenProps['download'];
  }>;
}>;
const titleKey = (entry: ContentEntry) => JSON.stringify([entry.libraryId, entry.kind, entry.id]);
const sameOptionalFence = (a: PlaybackFence | undefined, b: PlaybackFence | undefined) => b ? sameFence(a, b) : !a;

/** Explicit descriptors and disposal for the genuine assembly; importing never registers a route. */
export function createNativeWatchScreens(ports: NativeWatchFactoryPorts) {
  const controllers = new Map<string, NativeTitleController>(), requests = new Map<AbortController, NativeWatchCapture>();
  const options = new PlaybackOptionsClient(localV1Http(ports.api)), controls = new NativeWatchControls(ports.isTV);
  let disposed = false;
  let context: Omit<NativeWatchControlContext, 'expanded' | 'paused'> = {autoHide: true, hiddenByPanel: false, scrubbing: false, focusHeld: false};
  const alive = () => !disposed && sameAuthority(ports.authority, ports.current());
  const update = () => {
    for (const [request, captured] of requests) if (!current(captured)) request.abort();
    const source = ports.playback.getSnapshot();
    controls.source(alive() && sameAuthority(source.authority, ports.authority) && !source.retired ? source.fence : undefined,
      {...context, expanded: source.dock.local?.expanded === true, paused: source.playback.intent === 'paused'});
  };
  const current = (capture: NativeWatchCapture) => {
    const route = ports.navigation.getSnapshot();
    return alive() && sameAuthority(capture.authority, ports.current()) && sameAuthority(route.authority, capture.authority)
      && route.revision === capture.routeRevision && capture.current()
      && sameOptionalFence(ports.playback.getSnapshot().fence, capture.expectedFence);
  };
  const capture = (entry: ContentEntry, entryCurrent: () => boolean): NativeWatchCapture | undefined => {
    const value = Object.freeze({entry, current: entryCurrent, authority: ports.authority, routeRevision: ports.navigation.getSnapshot().revision, expectedFence: ports.playback.getSnapshot().fence});
    return current(value) ? value : undefined;
  };
  const request = async <T,>(captured: NativeWatchCapture, run: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    if (!current(captured)) return;
    const controller = new AbortController(); requests.set(controller, captured);
    try {const result = await run(controller.signal); return !controller.signal.aborted && current(captured) ? result : undefined;}
    finally {requests.delete(controller);}
  };
  const fileInfo = async (captured: NativeWatchCapture): Promise<void> => {
    if (!captured.entry.libraryId) return;
    const info = await request(captured, async signal => {
      const offered = await options.options(captured.entry.id, {}, signal);
      return readNativeFileInfo(ports.api, ports.scope, {libraryId: captured.entry.libraryId!, itemId: captured.entry.id}, offered, {t: defaultI18n.t}, ports.isTV, signal);
    });
    if (!info || !current(captured)) return;
    ports.openFileInfo(captured, <NativeFileInfoContent model={info.model} locations={info.locations} onManage={(action, id) => {if (current(captured)) ports.manageFile(captured, action, id);}}/>);
  };
  const publishVersions = (captured: NativeWatchCapture, offered: PlaybackOptions) => {
    if (!current(captured) || offered.itemId !== captured.entry.id || offered.versions.length < 2 || new Set(offered.versions.map(version => version.id)).size !== offered.versions.length) return;
    const source = ports.playback.getSnapshot();
    const selectedVersionId = source.session?.itemId === captured.entry.id ? nativeWatchTracks(source).version?.id : undefined;
    ports.openVersions(captured, <NativeVersionChoices options={offered} itemId={captured.entry.id} text={{t: defaultI18n.t}} selectedVersionId={selectedVersionId}
      onChoose={versionId => {
        if (!current(captured) || !offered.versions.some(version => version.id === versionId)) return;
        const target = captured.entry.playback;
        if (!target || target.itemId !== captured.entry.id) return;
        void ports.startVersion({entry: captured.entry, target}, {authority: captured.authority, options: offered, versionId, expectedFence: captured.expectedFence}).catch(ports.title.reportError);
      }}/>);
  };
  const versions = async (captured: NativeWatchCapture): Promise<void> => {
    if (captured.entry.playback?.itemId !== captured.entry.id) return;
    const fresh = await request(captured, signal => options.options(captured.entry.id, {}, signal));
    if (fresh) publishVersions(captured, fresh);
  };
  const menu = async (entry: ContentEntry, entryCurrent: () => boolean): Promise<void> => {
    const captured = capture(entry, entryCurrent);
    if (!captured) return;
    // A failed options read must not replace the independent real File info action.
    const offered = entry.playback?.itemId === entry.id ? await request(captured, signal => options.options(entry.id, {}, signal)).catch(error => {if (current(captured)) ports.title.reportError(error); return undefined;}) : undefined;
    if (!current(captured)) return;
    const hasVersions = !!offered && offered.itemId === entry.id && offered.versions.length >= 2 && new Set(offered.versions.map(version => version.id)).size === offered.versions.length;
    ports.openMenu(captured, {fileInfo: () => fileInfo(captured), ...(hasVersions ? {differentVersion: () => versions(captured)} : {})});
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
        back={() => {ports.navigation.back(ports.authority);}} more={entry => {
          const owner = controller!;
          void menu(entry, () => {
            const state = owner.getSnapshot();
            return !state.retired && (titleKey(state.entry) === titleKey(entry)
              || state.workspace?.data?.episodes.sections.some(section => section.entries.some(item => titleKey(item) === titleKey(entry))) === true
              || state.detail?.data?.related?.rows.some(row => row.entries.some(item => titleKey(item) === titleKey(entry))) === true);
          }).catch(ports.title.reportError);
        }}
        myList={ports.title.myList(route.entry)} download={ports.title.download}/>;
    },
  };
  const offPlayback = ports.playback.subscribe(update), offAuthority = ports.subscribeCurrent(update), offRoute = ports.navigation.subscribe(update);
  update();
  return Object.freeze({
    title,
    controls,
    menu,
    fileInfo,
    versions,
    capture,
    isCurrent: current,
    setPresentation: (value: typeof context) => {context = value; update();},
    renderWatch: (props: Omit<NativeWatchChromeProps, 'controls' | 'playback' | 'source'>) => alive() ? <Watch {...props}/> : null,
    renderPictureSlot: (props: Omit<NativeWatchPictureProps, 'outlet' | 'authority'>) => alive() ? <NativeWatchPicture {...props} authority={ports.authority} outlet={ports.watch}/> : null,
    releaseTitle: (entry: ContentEntry) => {const key = titleKey(entry); controllers.get(key)?.dispose(); controllers.delete(key);},
    dispose: () => {if (disposed) return; disposed = true; offPlayback(); offAuthority(); offRoute(); for (const request of requests.keys()) request.abort(); requests.clear(); for (const controller of controllers.values()) controller.dispose(); controllers.clear(); controls.dispose();},
  });
  function Watch(props: Omit<NativeWatchChromeProps, 'controls' | 'playback' | 'source'>) {
    const source = useSyncExternalStore(ports.playback.subscribe, ports.playback.getSnapshot);
    return alive() ? <NativeWatchChrome {...props} source={source} playback={ports.playback} controls={controls}/> : null;
  }
}
