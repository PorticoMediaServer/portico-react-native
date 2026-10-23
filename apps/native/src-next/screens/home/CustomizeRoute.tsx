import React, {useEffect, useSyncExternalStore} from 'react';
import {NativeModules, Platform} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {PersonalSavedService} from '../../../../../packages/client-core/src/personal-saved';
import {StateView} from '../../kit/states';
import {HomeCustomize, type NativeHomeCustomizeCopy} from './HomeCustomize';
import {NativeHomeCustomizeController} from './customize-controller';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeRouteRenderer} from '../../shell/route-registry';

type Source = Readonly<{route: NativeShellRoute; key: number; controller: NativeHomeCustomizeController; views: PersonalSavedService}>;

/** Authority-local route factory. Registration belongs to this screen module;
 * the shell only binds its factories to the restored context. */
export function createNativeHomeCustomizeRenderer(context: NativeShellBootstrapContext): NativeRouteRenderer & {dispose: () => void} {
  const t = defaultI18n.t;
  const screen = createNativeHomeCustomization(context, {
    title: t('home.customize.action'), instruction: t(Platform.isTV ? 'next.home.layoutTVInstruction' : 'home.customize.subtitle'),
    alwaysOn: t('home.customize.alwaysOn'), addView: t('home.customize.addView'), reset: t('action.reset'), save: t('action.save'),
    conflictTitle: t('next.home.layoutChangedTitle'), conflictBody: t('next.home.layoutChangedBodyCompact'),
    reload: t('next.home.reloadLayout'), keepEditing: t('next.home.keepEditing'),
    move: t('next.home.layoutMoveAction'), drop: t('next.home.layoutDropAction'), putBack: t('next.home.layoutPutBackAction'),
  });
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

/** The Home service performs the one revision-checked layout write. Saved is
 * read through its canonical service; choosing a view only edits the draft. */
export function createNativeHomeCustomization(context: NativeShellBootstrapContext, copy: NativeHomeCustomizeCopy) {
  let source: Source | undefined, alive = true, sequence = 0;
  const current = () => alive && context.current() && !!source && context.navigation.getSnapshot().route === source.route;
  const requestId = async (): Promise<string> => NativeModules.PorticoRuntime.newRequestId();
  const retire = () => {source?.controller.dispose(); source?.views.dispose(); source = undefined;};
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
    source = {route, controller, views, key: ++sequence};
  };
  return {reconcile, owns: (route: NativeShellRoute) => source?.route === route,
    render: (runtime: NativeShellRuntime) => source && current() ? <Customization key={source.key} source={source} runtime={runtime} copy={copy}
      close={() => {if (current()) context.navigation.back(context.authority());}}/> : null,
    dispose: () => {alive = false; retire();}};
}

function Customization({source, runtime, copy, close}: {source: Source; runtime: NativeShellRuntime; copy: NativeHomeCustomizeCopy; close: () => void}) {
  const state = useSyncExternalStore(source.controller.subscribe, source.controller.getSnapshot), views = useSyncExternalStore(source.views.subscribe, source.views.getSnapshot);
  useEffect(() => {void source.controller.load();}, [source]);
  const retry = () => {void source.views.select({view: 'views'});};
  return state.phase === 'error' ? <StateView variant="centered" {...runtime.error(state.error, () => {void source.controller.load();})}/>
    : <HomeCustomize controller={source.controller} copy={copy} i18n={defaultI18n} onClose={close} onAddView={retry} renderError={(error, again) => <StateView variant="centered" {...runtime.error(error, again)}/>} testID="home-customize"
      views={{items: views.resources, loading: views.loading, error: views.error, retry,
        renderError: (error, again) => <StateView variant="centered" {...runtime.error(error, again)}/>}}/>;
}
