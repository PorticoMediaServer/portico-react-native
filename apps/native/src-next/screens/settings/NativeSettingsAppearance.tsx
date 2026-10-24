import React, {useCallback, useEffect, useState, useSyncExternalStore, type ReactNode} from 'react';
import {AccessibilityInfo} from 'react-native';
import type {NativeShellRuntime} from '../../shell/runtime';
import {ThemeProvider, useTheme} from '../../kit/theme';

type Source = Pick<NativeShellRuntime, 'subscribe' | 'reportError'> & Readonly<{appearanceMotion?: 'follow' | 'reduce'}>;

/** Existing theme inputs only: no new native View, layout mode or text scale. */
export function NativeSettingsAppearance({source, children}: {source: Source; children: ReactNode}) {
  const inherited = useTheme();
  const motion = useSyncExternalStore(source.subscribe, useCallback(() => source.appearanceMotion, [source]));
  const [systemReduced, setSystemReduced] = useState<boolean>();
  useEffect(() => {
    if (typeof AccessibilityInfo?.isReduceMotionEnabled !== 'function' || typeof AccessibilityInfo.addEventListener !== 'function') return;
    let live = true, revision = 0;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      revision++; if (live) setSystemReduced(value);
    });
    const failed = (error: unknown) => {if (live) source.reportError(error);};
    try {
      void AccessibilityInfo.isReduceMotionEnabled().then(value => {if (live && revision === 0) setSystemReduced(value);}, failed);
    } catch (error) {failed(error);}
    return () => {live = false; subscription.remove();};
  }, [source]);
  return <ThemeProvider width={inherited.width} textScale={inherited.textScale}
    reduceMotion={inherited.reduceMotion || systemReduced === true || motion === 'reduce'}>{children}</ThemeProvider>;
}
