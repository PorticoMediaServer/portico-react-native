import {nativeType} from '../theme';
import type {TypeStyle} from '@portico/design';

/** CSS normal remains the font's native line metrics; never turn it into a numeric line height. */
export const shellType = (size: number, weight: TypeStyle['weight'] = 600, lineHeight: TypeStyle['lineHeight'] = 'normal', tracking = 0, textScale = 1) => nativeType({size, weight, lineHeight, tracking}, textScale);
export function alpha(color: string, opacity: number) {
  const byte = Math.round(Math.max(0, Math.min(1, opacity)) * 255).toString(16).padStart(2, '0');
  return `${color.slice(0, 7)}${byte}`;
}
