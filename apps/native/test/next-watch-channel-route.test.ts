import test from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import {screenModule} from './helpers/screen-harness.mjs';
import {createHookHost} from './hook-driver.ts';
const {NativeWatchChannelRoute} = await screenModule(new URL('../src-next/screens/watch/ChannelRoute.tsx', import.meta.url), {react: {...React, default: React}});

for (const retirement of ['navigation', 'authority', 'unmount'] as const) test(`the real channel route carries its own pending caller lifetime: ${retirement}`, async () => {
  let current = true, revision = 1, request: any, release!: () => void;
  const route = {kind: 'channel', sourceId: 'actual-source', channelId: 'actual-channel'};
  let active: any = route;
  const routeListeners = new Set<() => void>(), authorityListeners = new Set<() => void>();
  const pending = new Promise<void>(resolve => {release = resolve;});
  const context = {current: () => current, navigation: {getSnapshot: () => ({revision, route: active}), subscribe: (listener: () => void) => {routeListeners.add(listener); return () => routeListeners.delete(listener);}},
    subscribeAuthority: (listener: () => void) => {authorityListeners.add(listener); return () => authorityListeners.delete(listener);},
    playback: {runtime: {startChannel: async (value: any) => {request = value; await pending;}}}};
  let output: any;
  const mounted = createHookHost(() => {output = NativeWatchChannelRoute({context, route, title: {renderError: assert.fail}});});
  mounted.mount();
  try {
    assert.equal(output, null); assert.equal(request.sourceId, route.sourceId); assert.equal(request.channelId, route.channelId);
    assert.equal(request.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone);
    assert.equal(request.lifetime.isCurrent(), true); assert.equal(request.lifetime.signal.aborted, false);
    // A newly accepted output is not part of this route/member lifetime.
    mounted.flush(); assert.equal(request.lifetime.isCurrent(), true);
    if (retirement === 'unmount') mounted.unmount();
    else if (retirement === 'authority') {current = false; for (const listener of authorityListeners) listener();}
    else {revision++; active = {kind: 'shell'}; for (const listener of routeListeners) listener();}
    assert.equal(request.lifetime.isCurrent(), false); assert.equal(request.lifetime.signal.aborted, true);
  } finally {release(); await pending; mounted.unmount();}
  assert.equal(routeListeners.size, 0); assert.equal(authorityListeners.size, 0);
});
