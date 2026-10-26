import {useLayoutEffect, useRef} from 'react';
import {useFocusRegistry} from '../../kit/focus';
import type {FocusAddress} from '../../kit/focus/registry';
import type {ShellDestination} from '../../shell/model';
import type {NativeShellRuntime} from '../../shell/runtime';
import {createTVPageBack} from './tv-page-back';

export function useTVPageBack(runtime: NativeShellRuntime, destination: ShellDestination, enabled: boolean,
  page: Readonly<{scope?: string; registerTop?: boolean; current: () => boolean; start: () => FocusAddress | undefined; atTop: () => boolean; scrollTop: () => void}>) {
  const registry = useFocusRegistry(), latest = useRef(page); latest.current = page;
  const key = JSON.stringify(destination), scope = page.scope, registerTop = page.registerTop;
  useLayoutEffect(() => {
    if (!enabled) return;
    const owner = createTVPageBack(registry, {current: () => {
      const now = runtime.getSnapshot();
      return now.contentVisible !== false && !now.mediaExpanded && !now.homeObscured
        && JSON.stringify(now.destination) === key && latest.current.current();
    }, start: () => latest.current.start(),
      atTop: () => latest.current.atTop(), scrollTop: () => latest.current.scrollTop()});
    const remove = runtime.registerTVPageBack?.(owner.back, JSON.parse(key));
    const removeTop = registerTop ? runtime.registerScrollToTop(JSON.parse(key), owner.top) : undefined;
    return () => {removeTop?.(); remove?.(); owner.dispose();};
  }, [enabled, key, registry, runtime, scope, registerTop]);
}
