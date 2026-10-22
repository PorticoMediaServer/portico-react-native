import React, {useCallback, useMemo, useState} from 'react';
import {View} from 'react-native';
import Animated from 'react-native-reanimated';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useTheme} from '../theme';
import {MediaBar} from './MediaBar';
import {NowPlayingCard} from './NowPlayingCard';
import {DockNotice} from './DockNotice';
import {commandAllowed, commandIsCurrent, currentOccupant} from './model';
import {alpha, dockStyles} from './visual';
import {useDockPresence} from './useDockPresence';
import type {DockCommand, DockHostProps} from './types';

/** The accepted core picks one occupant. This host neither owns an engine nor fabricates effects. */
export function DockHost({dock, snapshot, presentation, onAction, bottomInset, visible = true, tvExpanded, onTVExpandedChange, returnFocusRef, onVideoSlot, morph, notice, onNoticeDismiss, style}: DockHostProps) {
  const theme = useTheme(), safe = useSafeAreaInsets();
  const [expanded, setExpanded] = useState(false), [menu, setMenu] = useState(false);
  const occupant = useMemo(() => currentOccupant(dock, snapshot, presentation), [dock, snapshot, presentation]);
  const wanted = visible && (!theme.isTV || occupant?.mode === 'music' || occupant?.mode === 'audiobook') ? occupant : null;
  const presence = useDockPresence(wanted, theme.isTV);
  const action = useCallback((command: DockCommand) => {
    const latest = currentOccupant(dock, dock.getSnapshot(), presentation);
    const restoring = command.type === 'restore-audio' || command.type === 'restore-video';
    if (commandIsCurrent(dock, command) && (restoring || (latest && commandAllowed(latest, command.type)))) onAction(command);
  }, [dock, presentation, onAction]);
  const setTVExpanded = useCallback((value: boolean) => {setExpanded(value); onTVExpandedChange?.(value);}, [onTVExpandedChange]);
  const shown = presence.shown;
  if (!shown) return null;
  const tvOpen = tvExpanded ?? expanded;
  return <View pointerEvents="box-none" style={[dockStyles.fill, {zIndex: theme.layers.player}, style]}>
    {(theme.isTV ? tvOpen : menu) && <View pointerEvents="none" style={[dockStyles.fill, {backgroundColor: alpha(theme.colors.ink, .5)}]}/>}
    <Animated.View pointerEvents={wanted ? 'box-none' : 'none'} style={[dockStyles.fill, presence.style]}>{theme.isTV ? <NowPlayingCard occupant={shown} onAction={action} expanded={!!wanted && tvOpen} onExpandedChange={setTVExpanded} returnFocusRef={returnFocusRef}
      style={{position: 'absolute', top: 44, right: theme.layout.gutter.tvRight}}/> :
      <MediaBar occupant={shown} onAction={action} visible={visible} onMenuOpenChange={setMenu} onVideoSlot={onVideoSlot} morph={morph}
        style={{position: 'absolute', left: 8, right: 8, bottom: bottomInset ?? Math.max(84, safe.bottom) + 8}}/>}</Animated.View>
    {!theme.isTV && notice && onNoticeDismiss && <DockNotice notice={notice} onAction={action} onDismiss={onNoticeDismiss} bottomOffset={(bottomInset ?? 92) + 62 + 10}/>}
  </View>;
}
