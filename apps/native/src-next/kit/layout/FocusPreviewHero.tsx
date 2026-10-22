import React from 'react';
import {View} from 'react-native';
import {heroSpec} from '@portico/design';
import {HeroSurface, type HeroProps} from './Hero';
import {useFocusPreviewDebounce} from './PreviewDebounce';
import type {HeroCandidate} from './types';

export type FocusPreviewHeroProps<T extends HeroCandidate> = Omit<HeroProps<T>, 'candidates' | 'activeIndex' | 'onIndexChange' | 'heroFocused' | 'renderActions'> & {
  focusedEntry?: T;
  repeating?: boolean;
  debounceMs?: number;
  onPreviewError?: (error: unknown, entry: T) => void;
  renderHint: (entry: T) => React.ReactNode;
};

/** A bounded focused record supplied by the consumer; no library read or Home composition. */
export function FocusPreviewHero<T extends HeroCandidate>({focusedEntry, repeating = false, debounceMs = 250, height, style, testID, renderHint, onPreviewError, ...props}: FocusPreviewHeroProps<T>) {
  const settled = useFocusPreviewDebounce(focusedEntry, repeating, debounceMs);
  const staged = focusedEntry && settled?.id === focusedEntry.id ? focusedEntry : settled;
  return <View testID={testID} style={[{height: height ?? heroSpec.homeHeight.tv, position: 'relative'}, style]}>
    <HeroSurface {...props} entry={staged} variant="tv" copyTop={props.copyTop ?? 150} renderActions={renderHint} fade="slow" onArtworkError={onPreviewError} />
  </View>;
}
