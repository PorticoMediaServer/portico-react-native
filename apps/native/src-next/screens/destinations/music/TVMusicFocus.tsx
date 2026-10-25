import React, {useLayoutEffect, useRef, useState} from 'react';
import {BackHandler, findNodeHandle, View, useTVEventHandler} from 'react-native';
import type {DockCommand, DockOccupant} from '../../../kit/dock/types';
import {playbackPosition, seekBounds, seekTo} from '../../../kit/dock/model';
import {Focusable} from '../../../kit/controls';
import {FocusRegion, type FocusRegionProps} from '../../../kit/focus';
import {useTheme} from '../../../kit/theme';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {useDestinationEntryFocus} from '../../destinations/useEntryFocus';

/** These regions only compose the TV screen. Touch keeps its existing views. */
export function MusicFocusRegion({children, ...props}: FocusRegionProps) {
  const theme = useTheme();
  return theme.isTV ? <FocusRegion {...props}>{children}</FocusRegion> : <View style={props.style}>{children}</View>;
}

function Entry({region, visible, child}: {region: string; visible: boolean; child: string}) {
  useDestinationEntryFocus({visible, intent: 'enter', revision: 0}, {regionId: region, childId: child});
  return null;
}

/** F-MUSIC-1: opening starts on Pause. Track changes never request focus again.
 * Back folds this occupant; its parent retains the original playback fence. */
export function TVMusicFocus({id, visible, entry, onClose, children}: {id: string; visible: boolean; entry: string; onClose: () => void; children: React.ReactNode}) {
  const theme = useTheme(), latest = useRef({visible, onClose}); latest.current = {visible, onClose};
  useLayoutEffect(() => {
    if (!theme.isTV) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!latest.current.visible) return false;
      latest.current.onClose(); return true;
    });
    return () => back.remove();
  }, [theme.isTV]);
  if (!theme.isTV) return <>{children}</>;
  return <FocusRegion id={id} hold style={{position: 'absolute', inset: 0}}>
    <Entry region={`${id}.transport`} child={entry} visible={visible}/>{children}
  </FocusRegion>;
}

/** F-MUSIC-15/16: the actual seek window is a D-pad stop between Pause and
 * Signal path. The adapter still validates every command's captured fence. */
export function TVMusicSeek({occupant, onAction, enabled, testID}: {occupant: DockOccupant; onAction: (command: DockCommand) => void; enabled: boolean; testID: string}) {
  const theme = useTheme(), node = useRef<View>(null), live = useRef(false), focused = useRef(false);
  const [host, setHost] = useState<number>(), latest = useRef({occupant, onAction, enabled}); latest.current = {occupant, onAction, enabled};
  useLayoutEffect(() => {live.current = true; setHost(findNodeHandle(node.current) ?? undefined); return () => {live.current = false; focused.current = false;};}, []);
  const adjust = (direction: -1 | 1) => {
    const current = latest.current;
    if (!live.current || !current.enabled) return;
    const step = direction < 0 ? current.occupant.presentation.skipBackSeconds : current.occupant.presentation.skipForwardSeconds ?? current.occupant.presentation.skipBackSeconds;
    if (!(step > 0) || !Number.isFinite(step)) return;
    const command = seekTo(current.occupant, playbackPosition(current.occupant) + direction * step);
    if (command) current.onAction(command);
  };
  useTVEventHandler(event => {
    if (!focused.current || event.eventKeyAction === 1) return;
    if (event.eventType === 'left' || event.eventType === 'longLeft') adjust(-1);
    else if (event.eventType === 'right' || event.eventType === 'longRight') adjust(1);
  });
  const bounds = seekBounds(occupant), position = playbackPosition(occupant), span = bounds ? bounds.end - bounds.start : 0;
  const fraction = bounds && span > 0 ? Math.max(0, Math.min(1, (position - bounds.start) / span)) : 0;
  return <Focusable ref={node} focusId="seek" testID={testID} focusRadius={8} accessibilityRole="adjustable" accessibilityLabel={defaultI18n.t('player.position')}
    disabled={!enabled || !occupant.presentation.capabilities.seek || !(span > 0)}
    accessibilityValue={{min: bounds?.start ?? 0, max: bounds?.end ?? 0, now: bounds ? Math.max(bounds.start, Math.min(bounds.end, position)) : 0}}
    accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]} onAccessibilityAction={event => {if (event.nativeEvent.actionName === 'increment') adjust(1); else if (event.nativeEvent.actionName === 'decrement') adjust(-1);}}
    {...(host ? {nextFocusLeft: host, nextFocusRight: host} : {})} onFocus={() => {focused.current = true;}} onBlur={() => {focused.current = false;}}
    style={{height: 28, justifyContent: 'center'}}>
    <View style={{height: 8, borderRadius: 4, backgroundColor: 'rgba(237,245,250,.18)'}}><View style={{width: `${fraction * 100}%`, height: 8, borderRadius: 4, backgroundColor: theme.colors.accentStrong}}/></View>
  </Focusable>;
}
