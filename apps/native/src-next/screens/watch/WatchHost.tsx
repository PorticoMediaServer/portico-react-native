import React, {useCallback, useLayoutEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {Dimensions, View, useWindowDimensions} from 'react-native';
import {sameFence, type PlaybackFence} from '../../../../../packages/player-core/src';
import {resolvePlayerPresentation, playerControlsRevealDeadline, type PlayerPresentation, type PlayerPresentationInput, type PlayerRect} from '../../platform/layout/player-presentation';
import {usePlatformPosture} from '../../platform/platformPosture';
import type {NativePlaybackAdapter, NativePlaybackRuntimeSnapshot} from '../../platform/playback/types';
import {sameAuthority, type ShellAuthority} from '../../shell/model';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeWatchOutletPort} from '../../shell/watch-outlet';
import {NativeWatchChrome, type NativeWatchChromeProps} from './WatchChrome';
import {NativeWatchPicture} from './picture-slot';
import type {NativeWatchControls, NativeWatchControlContext, NativeWatchControlState} from './controls';

export type NativeWatchHostContext = Readonly<{
  source: NativePlaybackRuntimeSnapshot;
  fence: PlaybackFence;
  layout: PlayerPresentation;
  state: NativeWatchControlState;
  runtime: NativeShellRuntime;
  closePanel: () => void;
  rememberPanel: (offset: number) => void;
}>;
/** Genuine producer labels/settings and the owned content/panel renderers. No
 * default track, invented quality, engine, route or copied presentation store. */
export type NativeWatchHostBindings = Readonly<{
  chrome: (source: NativePlaybackRuntimeSnapshot, runtime: NativeShellRuntime) => Omit<NativeWatchChromeProps, 'source' | 'controls' | 'playback' | 'text' | 'width' | 'height' | 'compact' | 'onPanel' | 'edgeInsets'>;
  content?: (context: NativeWatchHostContext) => React.ReactNode;
  details?: (context: NativeWatchHostContext) => React.ReactNode;
  panel: (context: NativeWatchHostContext) => React.ReactNode;
  /** Shell owns status/navigation application; Watch supplies canonical facts. */
  presentation?: (layout: PlayerPresentation | undefined) => void;
  scrubbing?: boolean;
  focusHeld?: boolean;
}>;
type Props = Readonly<{
  authority: ShellAuthority;
  current: () => ShellAuthority;
  playback: NativePlaybackAdapter;
  outlet: NativeWatchOutletPort;
  runtime: NativeShellRuntime;
  controls: NativeWatchControls;
  bindings: NativeWatchHostBindings;
  setPresentation: (context: Omit<NativeWatchControlContext, 'expanded' | 'paused'>) => void;
}>;
const positioned = (pane: PlayerRect) => ({position: 'absolute' as const, left: pane.x, top: pane.y, width: pane.width, height: pane.height});

/** Persistent chrome sibling above Accounts' single Surface. A transparent
 * measured surface pane is the only native-slot producer, including letterbox.
 * Posture changes never navigate, key a player, or recreate title memory. */
export function NativeWatchHost({authority, current, playback, outlet, runtime, controls, bindings, setPresentation}: Props) {
  const source = useSyncExternalStore(playback.subscribe, playback.getSnapshot);
  const state = useSyncExternalStore(controls.subscribe, controls.getSnapshot);
  const window = useWindowDimensions(), posture = usePlatformPosture();
  const local = source.dock.local, fence = source.fence;
  const {scrubbing, focusHeld, presentation} = bindings;
  const expanded = !source.retired && sameAuthority(authority, current()) && sameAuthority(authority, source.authority)
    && !!fence && !!local && sameFence(local.fence, fence) && local.expanded && (local.kind === 'video' || local.kind === 'live');
  const panelOpen = expanded && sameFence(state.fence, fence) && !!state.panel;
  const input = useMemo<PlayerPresentationInput>(() => ({window: {width: window.width, height: window.height}, posture, docked: !expanded, panelOpen}),
    [window.width, window.height, posture, expanded, panelOpen]);
  const layout = useMemo(() => resolvePlayerPresentation(input), [input]);
  const previous = useRef<PlayerPresentationInput | undefined>(undefined), deadline = useRef(0);
  useLayoutEffect(() => {
    // Apply suppression/pinning first. Repeated progress and panel close alone
    // cannot issue another fold reveal or extend its three-second deadline.
    setPresentation({autoHide: layout?.controlsAutoHide ?? false, hiddenByPanel: layout?.controlsHidden ?? false,
      scrubbing: scrubbing === true, focusHeld: focusHeld === true});
    const next = playerControlsRevealDeadline(previous.current, input, Date.now(), deadline.current);
    if (fence && next !== deadline.current && next > 0) controls.revealAfterLayout(fence, next);
    deadline.current = next; previous.current = input;
    presentation?.(layout);
  }, [input, layout, fence, controls, setPresentation, scrubbing, focusHeld, presentation]);
  const measuredCurrent = useCallback(() => ({authority: current(), fence: playback.getSnapshot().fence, window: Dimensions.get('window')}), [current, playback]);
  if (!expanded || !fence || !layout?.surface) return null;
  const context: NativeWatchHostContext = {source, fence, layout, state, runtime,
    closePanel: () => {controls.closePanel(fence);}, rememberPanel: offset => controls.rememberPanel(fence, offset)};
  // Tabletop controls live below the actual top surface. In book mode edge
  // chrome avoids the crease while transport remains centred in its full pane.
  const chromePane = layout.mode === 'tabletop' ? layout.controls : layout.surface;
  return <View testID="watch-host" pointerEvents="box-none" style={{position: 'absolute', inset: 0}}>
    <NativeWatchPicture authority={authority} fence={fence} outlet={outlet} current={measuredCurrent} style={positioned(layout.surface)}/>
    {layout.content && <View testID="watch-content-pane" style={positioned(layout.content)} pointerEvents="box-none">{bindings.content?.(context)}</View>}
    {layout.details && <View testID="watch-details-pane" style={positioned(layout.details)} pointerEvents="box-none">{bindings.details?.(context)}</View>}
    {chromePane && <View testID="watch-controls-pane" pointerEvents="box-none" style={positioned(chromePane)}>
      <NativeWatchChrome {...bindings.chrome(source, runtime)} source={source} controls={controls} playback={playback} text={runtime.text}
        width={chromePane.width} height={chromePane.height} compact={layout.mode === 'watch' || layout.mode === 'book'}
        edgeInsets={layout.mode === 'book' && layout.controls ? {right: layout.surface.width - layout.controls.width} : undefined} onPanel={() => {}}/>
    </View>}
    {panelOpen && <View testID="watch-panel-pane" pointerEvents="box-none" style={layout.panel ? positioned(layout.panel) : {position: 'absolute', inset: 0}}>{bindings.panel(context)}</View>}
  </View>;
}
