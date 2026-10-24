import type {TextStyle} from 'react-native';
import {heroSpec} from '@portico/design';
import {fontFamilies, type Theme} from '../../kit/theme';

/**
 * Phone Home measurements the drawn frame states outside the shared kit.
 *
 * Every value cites the drawing it comes from. TV returns the values this
 * screen already ships, so the TV presentation does not move with the phone
 * lift; the shared-kit replacements are reported to the dispatcher instead.
 *
 * - phone-app.html `.phone .row { margin-top: 28px }` (kit shelf gap is 18)
 * - phone-app.html `.phone .row-head .sub { font-size: 13px }` (rowSubtitle role is 14)
 * - kit.css `.tag { padding: 3px 9px; border-radius: 6px; border: 1px solid rgba(237,245,250,.28) }`
 * - kit.css `.meta strong { font-weight: 700 }`
 */

/** A hex colour with the drawn alpha; `rgba(237,245,250,.28)` is the same paint. */
function withAlpha(color: string, value: number): string {
  const channel = Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0').toUpperCase();
  return `${color}${channel}`;
}

/** The `duration` and `season-count` facts badge drawn as `.tag`. */
export function homeFactTag(theme: Theme) {
  const phone = !theme.isTV;
  return {
    paddingHorizontal: phone ? 9 : 12,
    paddingVertical: 3,
    borderWidth: phone ? 1 : 1.5,
    borderRadius: phone ? theme.baseRadii.tag : 8,
    borderColor: withAlpha(theme.colors.text, phone ? 0.28 : 0.3),
  } as const;
}

/** `.meta strong`: the drawn 700 weight on the phone; TV keeps its shipped family. */
export function homeFactStrong(theme: Theme): string {
  return theme.isTV ? theme.type.bodyStrong.fontFamily ?? '' : fontFamilies[heroSpec.facts.strongWeight];
}

/** One Home row's drawn vertical rhythm. */
export function homeRowSpacing(theme: Theme) {
  return theme.isTV ? {marginBottom: 30} : theme.layoutMode === 'phone' ? {marginTop: 28} : {marginBottom: 18};
}

/** The hero reserves only its own height; the first row's drawn 28 px gap is its own margin. */
export function homeHeroBlock(theme: Theme, heroHeight: number, preview: boolean): number {
  return theme.isTV ? (preview ? 588 : 820) : theme.layoutMode === 'phone' ? heroHeight : heroHeight + theme.spec.shelf.homeOverlap;
}

/** A drawn phone row subtitle is 13 px; the shared role is 14. */
export function homeRowSubtitle(theme: Theme): TextStyle {
  return theme.layoutMode === 'phone' ? theme.type.caption : theme.type.rowSubtitle;
}
