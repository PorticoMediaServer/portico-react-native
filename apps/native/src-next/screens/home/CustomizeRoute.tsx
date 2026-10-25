import React, {useEffect, useSyncExternalStore} from 'react';
import {NativeModules, Platform} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {PersonalSavedService} from '../../../../../packages/client-core/src/personal-saved';
import {StateView} from '../../kit/states';
import {HomeCustomize, type NativeHomeCustomizeCopy} from './HomeCustomize';
import {NativeHomeCustomizeController} from './customize-controller';
import {NativeHomeSavedViewSummaries} from './saved-view-summaries';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeShellRoute} from '../../shell/routes';
import {nativeShellRoutes, type NativeRouteRenderer} from '../../shell/route-registry';

type Source = Readonly<{route: NativeShellRoute; key: number; controller: NativeHomeCustomizeController; views: PersonalSavedService; summaries: NativeHomeSavedViewSummaries}>;

/** Authority-local route factory. Registration belongs to this screen module;
 * the shell only binds its factories to the restored context. */
export function createNativeHomeCustomizeRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer & {dispose: () => void} {
  const screen = createNativeHomeCustomization(context);
  const unsubscribe = context.navigation.subscribe(screen.reconcile);
  screen.reconcile();
  return {
    render: (route, runtime) => {
      if (!context.current() || route.kind !== 'home-customize' || context.navigation.getSnapshot().route !== route) throw new Error('native_home_customize_route_mismatch');
      screen.reconcile(); return screen.render(runtime);
    },
    dispose: () => {unsubscribe(); screen.dispose();},
  };
}

/** The drawn customize copy in the translator the runtime currently shows. */
function customizeCopy(text: NativeShellRuntime['text']): NativeHomeCustomizeCopy {
  return {
    title: text.t('home.customize.action'), instruction: text.t(Platform.isTV ? 'next.home.layoutTVInstruction' : 'home.customize.subtitle'),
    alwaysOn: text.t('home.customize.alwaysOn'), addView: text.t('home.customize.addView'), reset: text.t('action.reset'), save: text.t('action.save'),
    conflictTitle: text.t('next.home.layoutChangedTitle'), conflictBody: text.t('next.home.layoutChangedBodyCompact'),
    reload: text.t('next.home.reloadLayout'), keepEditing: text.t('next.home.keepEditing'),
    move: text.t('next.home.layoutMoveAction'), drop: text.t('next.home.layoutDropAction'), putBack: text.t('next.home.layoutPutBackAction'),
  };
}

/** The Home service performs the one revision-checked layout write. Saved is
 * read through its canonical service; choosing a view only edits the draft. */
export function createNativeHomeCustomization(context: NativeShellBootstrapContext) {
  let source: Source | undefined, alive = true, sequence = 0;
  const current = () => alive && context.current() && !!source && context.navigation.getSnapshot().route === source.route;
  const requestId = async (): Promise<string> => NativeModules.PorticoRuntime.newRequestId();
  const retire = () => {source?.controller.dispose(); source?.views.dispose(); source?.summaries.dispose(); source = undefined;};
  const reconcile = () => {
    if (!alive || !context.current()) {retire(); return;}
    const route = context.navigation.getSnapshot().route;
    if (route === source?.route) return;
    retire();
    if (route.kind !== 'home-customize') return;
    const session = context.session();
    if (!session) return;
    const views = new PersonalSavedService(context.api, {serverId: context.authority().serverId,
      viewerId: JSON.stringify([session.viewer.authority, session.viewer.accountId, session.viewer.profileId])}, requestId);
    const controller = new NativeHomeCustomizeController({home: context.home, current, requestId,
      savedViews: {serverId: context.authority().serverId, isCurrent: view => current() && views.getSnapshot().resources.includes(view)
        && !!view.definition && context.libraries().some(library => library.id === view.definition!.libraryId)}});
    const summaries = new NativeHomeSavedViewSummaries({api: context.api, serverId: context.authority().serverId, current, libraryIds: () => context.libraries().map(library => library.id)});
    source = {route, controller, views, summaries, key: ++sequence};
  };
  return {reconcile, owns: (route: NativeShellRoute) => source?.route === route,
    render: (runtime: NativeShellRuntime) => source && current() ? <Customization key={source.key} source={source} runtime={runtime}
      close={() => {if (current()) context.navigation.back(context.authority());}}/> : null,
    dispose: () => {alive = false; retire();}};
}

function Customization({source, runtime, close}: {source: Source; runtime: NativeShellRuntime; close: () => void}) {
  const state = useSyncExternalStore(source.controller.subscribe, source.controller.getSnapshot), views = useSyncExternalStore(source.views.subscribe, source.views.getSnapshot);
  useSyncExternalStore(source.summaries.subscribe, source.summaries.getSnapshot);
  useEffect(() => {void source.controller.load();}, [source]);
  useEffect(() => {void source.summaries.load(views.resources);}, [source, views.resources]);
  const retry = () => {void source.views.select({view: 'views'});};
  const labels = {t: runtime.text.t, has: defaultI18n.has, locale: runtime.text.region?.uiLocale ?? defaultI18n.locale}, copy = customizeCopy(runtime.text);
  return state.phase === 'error' ? <StateView variant="centered" {...runtime.error(state.error, () => {void source.controller.load();})}/>
    : <HomeCustomize summary={view => source.summaries.line(view, labels)} controller={source.controller} copy={copy} i18n={labels} onClose={close} onAddView={retry} renderError={(error, again) => <StateView variant="centered" {...runtime.error(error, again)}/>} testID="home-customize"
      views={{items: views.resources, loading: views.loading, error: views.error, retry, hasMore: !!views.nextCursor,
        loadMore: () => {void source.views.next().catch(runtime.reportError);},
        renderError: (error, again) => <StateView variant="centered" {...runtime.error(error, again)}/>}}/>;
}

nativeShellRoutes.registerRoute('home-customize', createNativeHomeCustomizeRenderer);
