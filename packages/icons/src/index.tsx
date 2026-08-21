import React from 'react';
import {
  Circle,
  Ellipse,
  G,
  Line,
  Path,
  Polygon,
  Polyline,
  Rect,
  Svg,
  SvgProps,
} from 'react-native-svg';

import {iconNodes, PorticoIconId, semanticToMaster} from './generated';

export type {PorticoIconId} from './generated';
export {ICON_REGISTRY_VERSION} from './generated';
export {PorticoBrand, type PorticoBrandId, type PorticoBrandProps} from './PorticoBrand';

const nodeComponents = {circle: Circle, ellipse: Ellipse, g: G, line: Line, path: Path, polygon: Polygon, polyline: Polyline, rect: Rect};
const filledSelectedIds: ReadonlySet<PorticoIconId> = new Set(['action.favorite', 'action.watchlist']);

export type PorticoIconState = 'default' | 'focused' | 'selected' | 'disabled' | 'destructive';

export interface PorticoIconProps extends Omit<SvgProps, 'color' | 'height' | 'width'> {
  id: PorticoIconId;
  size?: number;
  color?: string;
  state?: PorticoIconState;
  strokeWidth?: number;
}

export function PorticoIcon({
  id,
  size = 24,
  color = 'currentColor',
  state = 'default',
  strokeWidth = 2,
  ...svgProps
}: PorticoIconProps) {
  const master = semanticToMaster[id];
  if (!master) throw new Error(`Unknown Portico semantic icon ID: ${String(id)}`);
  const nodes = iconNodes[master];
  if (!nodes) throw new Error(`Missing generated Portico icon master: ${master}`);
  const fill = state === 'selected' && filledSelectedIds.has(id) ? color : 'none';

  return (
    <Svg
      accessibilityElementsHidden
      aria-hidden
      color={color}
      fill={fill}
      height={size}
      pointerEvents="none"
      stroke={color}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      viewBox="0 0 24 24"
      width={size}
      {...svgProps}>
      {nodes.map(([tag, attributes], index) => {
        const Component = nodeComponents[tag as keyof typeof nodeComponents];
        if (!Component) throw new Error(`Unsupported SVG element '${tag}' in ${master}.`);
        return <Component key={`${master}-${index}`} {...attributes} />;
      })}
    </Svg>
  );
}

export function isFilledSelectedIcon(id: PorticoIconId): boolean {
  return filledSelectedIds.has(id);
}
