import React from 'react';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativeScreenError, nativeScreenServices} from '../native-screen-services';
import {NativeWatchPresenters} from './presenters';
import {NativeWatchOverlays} from './WatchOverlays';
import type {NativeWatchModuleBindings} from './module';

/** One real authority-local composition, borrowed by handheld and TV entry.
 * It owns Title/File info overlays; shared feedback is mounted by assembly. */
export function createNativeWatchBindings(context: NativeShellBootstrapContext): NativeWatchModuleBindings {
  const common = nativeScreenServices(context), presenters = new NativeWatchPresenters(context, common);
  return Object.freeze({
    requestId: common.requestId,
    title: {
      aboutLabel: defaultI18n.t('next.browse.native.aboutTitle'), navigate: common.navigate,
      renderError: nativeScreenError(common, 'detail'), reportError: (error: unknown) => common.reportError(error, 'detail'),
      menu: {subscribe: presenters.subscribe, getSnapshot: presenters.getMenuEntry},
    },
    manageFile: presenters.manageFile, openFileInfo: presenters.openFileInfo, openMenu: presenters.openMenu,
    openVersions: presenters.openVersions, startVersion: context.playback.startVersion,
    renderOverlays: runtime => <NativeWatchOverlays presenters={presenters} runtime={runtime} common={common}/>,
    dispose: presenters.dispose,
  });
}
