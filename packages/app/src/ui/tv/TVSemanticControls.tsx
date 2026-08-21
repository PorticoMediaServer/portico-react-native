import React from 'react';
import {StyleSheet} from 'react-native';
import {PorticoIcon, type PorticoIconId} from '@portico-react-native/icons';
import type {
  TVFocusDirection,
  TVLogicalFocusNode,
} from '@portico-react-native/tv-focus';
import {Focusable} from '../primitives';
import {color} from '../tokens';

export function TVSemanticIcon({
  id,
  selected = false,
  size = 28,
}: {
  id: PorticoIconId;
  selected?: boolean;
  size?: number;
}) {
  return (
    <PorticoIcon
      color={selected ? color.screenBlueStrong : color.softSilver}
      id={id}
      size={size}
      state={selected ? 'selected' : 'default'}
    />
  );
}

export function TVSemanticIconButton({
  id,
  label,
  onPress,
  selected = false,
  tvFocusBoundaryDirections,
  tvFocusNeighbours,
}: {
  id: PorticoIconId;
  label: string;
  onPress(): void;
  selected?: boolean;
  tvFocusBoundaryDirections?: readonly TVFocusDirection[];
  tvFocusNeighbours?: TVLogicalFocusNode['neighbours'];
}) {
  return (
    <Focusable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{selected}}
      onPress={onPress}
      platform="tv"
      style={[styles.button, selected && styles.selected]}
      focusedStyle={styles.focused}
      pressedStyle={styles.pressed}
      tvFocusBoundaryDirections={tvFocusBoundaryDirections}
      tvFocusId={`semantic-action:${id}`}
      tvFocusNeighbours={tvFocusNeighbours}
    >
      <TVSemanticIcon id={id} selected={selected} size={28} />
    </Focusable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    backgroundColor: color.scrim,
    borderColor: color.lineSoft,
    borderRadius: 32,
    borderWidth: 3,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  selected: {backgroundColor: color.brightSlate, borderColor: color.lineStrong},
  focused: {borderColor: color.focus},
  pressed: {backgroundColor: color.brightSlate},
});
