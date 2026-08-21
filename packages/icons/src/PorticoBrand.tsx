import React from 'react';
import {SvgXml} from 'react-native-svg';

import {brandArtwork, PorticoBrandId} from './brandGenerated';

export type {PorticoBrandId} from './brandGenerated';

export interface PorticoBrandProps {
  id: PorticoBrandId;
  width: number;
  height?: number;
  accessibilityLabel?: string;
}

export function PorticoBrand({id, width, height, accessibilityLabel}: PorticoBrandProps) {
  const artwork = brandArtwork[id];
  if (!artwork) throw new Error(`Unknown Portico brand asset ID: ${String(id)}`);
  return (
    <SvgXml
      accessibilityElementsHidden={!accessibilityLabel}
      accessibilityLabel={accessibilityLabel}
      aria-hidden={!accessibilityLabel}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      width={width}
      xml={artwork}
    />
  );
}
