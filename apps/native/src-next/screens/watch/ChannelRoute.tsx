import React, {useEffect, useState} from 'react';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeWatchModuleBindings} from './module';

/** A genuine navigation request, not a Home selection or a second player.
 * The persistent Watch outlet paints only the runtime's accepted channel. */
export function NativeWatchChannelRoute({context, route, title}: {context: NativeShellBootstrapContext; route: Extract<NativeShellRoute, {kind: 'channel'}>; title: NativeWatchModuleBindings['title']}) {
  const [attempt, setAttempt] = useState(0), [error, setError] = useState<unknown>();
  useEffect(() => {
    const revision = context.navigation.getSnapshot().revision, controller = new AbortController();
    const current = () => {
      const snapshot = context.navigation.getSnapshot(), value = snapshot.route;
      return !controller.signal.aborted && context.current() && snapshot.revision === revision && value.kind === 'channel'
        && value.sourceId === route.sourceId && value.channelId === route.channelId;
    };
    const changed = () => {if (!current()) controller.abort();};
    const offRoute = context.navigation.subscribe(changed), offAuthority = context.subscribeAuthority(changed);
    setError(undefined);
    if (current()) void context.playback.runtime.startChannel({sourceId: route.sourceId, channelId: route.channelId,
      timezone: route.guide?.options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, guide: route.guide,
      expectedFence: route.tune?.fence, expectedSourceGeneration: route.tune?.sourceGeneration,
      lifetime: {signal: controller.signal, isCurrent: current}})
      .catch(failure => {if (current()) setError(failure);});
    return () => {controller.abort(); offRoute(); offAuthority();};
  }, [context, route, attempt]);
  return error ? title.renderError(error, () => setAttempt(value => value + 1)) : null;
}
