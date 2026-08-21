import React, {createContext, useContext, useMemo, useState} from 'react';

type MobileChromeMetrics = {
  primaryHeaderBottom: number;
  totalChromeHeight: number;
  setPrimaryHeaderBottom(height: number): void;
  setTotalChromeHeight(height: number): void;
};

const MobileChromeMetricsContext = createContext<MobileChromeMetrics>({
  primaryHeaderBottom: 58,
  totalChromeHeight: 58,
  setPrimaryHeaderBottom() {},
  setTotalChromeHeight() {},
});

export function MobileChromeMetricsProvider({children}: {children: React.ReactNode}) {
  const [primaryHeaderBottom, setPrimaryHeaderBottom] = useState(58);
  const [totalChromeHeight, setTotalChromeHeight] = useState(58);
  const value = useMemo(() => ({primaryHeaderBottom, totalChromeHeight, setPrimaryHeaderBottom, setTotalChromeHeight}), [primaryHeaderBottom, totalChromeHeight]);
  return <MobileChromeMetricsContext.Provider value={value}>{children}</MobileChromeMetricsContext.Provider>;
}

export function useMobileChromeMetrics() {
  return useContext(MobileChromeMetricsContext);
}
