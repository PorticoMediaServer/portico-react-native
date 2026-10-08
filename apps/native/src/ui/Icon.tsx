import React from 'react';
import Svg, {Circle, Ellipse, Line, Path, Polygon, Rect} from 'react-native-svg';
import {icons, type IconId} from '../../../../packages/design/src/index';
import {useTheme} from './theme';

/**
 * Portico's icons, rendered from the shared registry in `packages/design/src/icons.ts` so web and
 * Apple draw the same glyph for the same meaning. `IconName` is the registry's closed union: an
 * unknown name fails `tsc` instead of rendering nothing (APL-SET-02, X-17).
 */
export type IconName = IconId;

/** Glyphs whose number is drawn by the caller next to the arrow (APL-PLAYER-01), so the arrow only. */
const numberless: Partial<Record<IconId, number>> = {back10: 2, forward10: 2};

/** Memoised: every card and row carries one and its props are primitives. */
export const Icon = React.memo(function Icon({name, size, color, strokeWidth, bare}: {name: IconName; size?: number; color?: string; strokeWidth?: number; /** Arrow only, without the digits some glyphs carry. */ bare?: boolean}) {
  const {colors, metrics} = useTheme();
  const px = size ?? metrics.icon;
  const stroke = color ?? colors.text;
  const def = icons[name];
  if (!def) {
    if (__DEV__) throw new Error(`Unknown icon "${String(name)}"`);
    return null;
  }
  const elements = bare && numberless[name] ? def.elements.slice(0, numberless[name]) : def.elements;
  return (
    <Svg width={px} height={px} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth ?? def.strokeWidth} strokeLinecap="round" strokeLinejoin="round" color={stroke}>
      {elements.map((e, i) => {
        const fill = 'fill' in e && e.fill === 'currentColor' ? stroke : undefined;
        const noStroke = 'stroke' in e && e.stroke === 'none' ? 'none' : undefined;
        switch (e.type) {
          case 'path': return <Path key={i} d={e.d} fill={fill} stroke={noStroke} />;
          case 'circle': return <Circle key={i} cx={e.cx} cy={e.cy} r={e.r} fill={fill} stroke={noStroke} />;
          case 'line': return <Line key={i} x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} />;
          case 'rect': return <Rect key={i} x={e.x} y={e.y} width={e.width} height={e.height} rx={e.rx} fill={fill} stroke={noStroke} />;
          case 'polygon': return <Polygon key={i} points={e.points} fill={fill} stroke={noStroke} />;
          case 'ellipse': return <Ellipse key={i} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} />;
          default: return null;
        }
      })}
    </Svg>
  );
});

export const iconNames = Object.keys(icons) as IconName[];
