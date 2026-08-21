import React from 'react';
import {MobileChromeMetricsProvider} from './mobileChromeMetrics';
import {PersistentPlaybackProvider} from './playbackSession';
import {PrototypeUiProvider} from './uiState';
import {TVNavigationApplication} from './tvNavigation';
import type {ApplicationRootPhase} from './applicationRootPhase';

/**
 * TV product navigator entry used by the authenticated application phase.
 * Mobile owns an equivalent provider topology directly in MobileRootGate so
 * each platform has exactly one source entry and one navigation authority.
 */
export function PorticoV4App({
  connected = true,
  connectionSurface,
  phase = 'Product',
  phaseSurface,
}: {
  connected?: boolean;
  connectionSurface?: React.ReactNode;
  phase?: ApplicationRootPhase;
  phaseSurface?: React.ReactNode;
}) {
  return (
    <PrototypeUiProvider platform="tv">
      <MobileChromeMetricsProvider>
        <PersistentPlaybackProvider>
          <TVNavigationApplication
            connected={connected}
            connectionSurface={connectionSurface}
            phase={phase}
            phaseSurface={phaseSurface}
          />
        </PersistentPlaybackProvider>
      </MobileChromeMetricsProvider>
    </PrototypeUiProvider>
  );
}
