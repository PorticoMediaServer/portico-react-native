export {};
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: string): string;
  resolve(...paths: string[]): string;
};
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const appSource = readFileSync(
  resolve(__dirname, '..', 'PorticoApp.tsx'),
  'utf8',
);
const rootSource = readFileSync(resolve(__dirname, 'PorticoV4App.tsx'), 'utf8');
const shellSource = readFileSync(resolve(__dirname, 'shells.tsx'), 'utf8');
const mobileNavigationSource = readFileSync(
  resolve(__dirname, 'mobileNavigation.tsx'),
  'utf8',
);
const tvNavigationSource = readFileSync(
  resolve(__dirname, 'tvNavigation.tsx'),
  'utf8',
);
const navigationSource = readFileSync(
  resolve(__dirname, 'navigation.tsx'),
  'utf8',
);
const homeSource = readFileSync(
  resolve(__dirname, 'screens', 'HomeScreen.tsx'),
  'utf8',
);

describe('persistent Apple product frame', () => {
  it('has one React Navigation authority and one product entry per platform', () => {
    expect(appSource).toContain(
      "if (platform === 'mobile') return <MobileRootGate />;",
    );
    expect(appSource).toContain('return <TVRootGate />;');
    expect(
      mobileNavigationSource.match(/<NavigationContainer/g) ?? [],
    ).toHaveLength(1);
    expect(
      tvNavigationSource.match(/<NavigationContainer/g) ?? [],
    ).toHaveLength(1);
    expect(mobileNavigationSource).toMatch(
      /<MobileProductTabs\s+connected=\{connected\}\s+connectionSurface=\{connectionSurface\}\s*\/>/,
    );
    expect(tvNavigationSource).toMatch(
      /<TVSectionNavigator\s+connected=\{connected\}\s+connectionSurface=\{connectionSurface\}\s+primary=/,
    );
    expect(rootSource).toContain('<TVNavigationApplication');
    expect(rootSource).not.toContain('MobileNavigationApplication');
  });

  it('keeps established shells while removing superseded route machinery', () => {
    expect(shellSource).toContain('export function MobileShell');
    expect(shellSource).toContain('export function TvSafeContent');
    expect(shellSource).not.toContain('function TvShell');
    expect(shellSource).toContain(
      'const primary = isPrimary(route.name) || !auth.session;',
    );
    expect(navigationSource).toContain(
      'export function PorticoNavigationActionProvider',
    );
    expect(navigationSource).not.toContain(
      'export function PorticoNavigationProvider',
    );
    expect(navigationSource).not.toContain('stack?: PorticoRoute[]');
    expect(navigationSource).not.toContain('usePorticoNavigation():');
    expect(mobileNavigationSource).toContain(
      "navigationRef.preload('Search', undefined)",
    );
  });

  it('does not expose server-backed routes before a verified session exists', () => {
    expect(appSource).toContain(
      'const client = product.connected ? auth.session?.client : undefined;',
    );
    expect(mobileNavigationSource).toMatch(
      /<MobileProductTabs\s+connected=\{connected\}\s+connectionSurface=\{connectionSurface\}/,
    );
    expect(tvNavigationSource).toMatch(
      /<TVSectionNavigator\s+connected=\{connected\}\s+connectionSurface=\{connectionSurface\}/,
    );
  });

  it('keeps pre-terminal TV placeholders inert and non-focusable', () => {
    expect(appSource).toContain('accessible={false}');
    expect(appSource).toContain('pointerEvents="none"');
    expect(appSource).toContain('portico-${platform}-connection-reserved');
  });

  it('resolves advertised Home rows without rendering empty or pending shelves', () => {
    expect(homeSource).toContain('reserveOrderedSurfaceSlots');
    expect(homeSource).toContain(
      'client.homeRow(row.id, {limit: 24}, {signal})',
    );
    expect(homeSource).toContain("slot.resolution === 'ready'");
    expect(homeSource).toContain("slot.resolution === 'failed'");
    expect(homeSource).toContain('return null;');
    expect(homeSource).not.toContain('ReservedHomeRow');
  });

  it('continues horizontal Home rows at the rail edge without a More button', () => {
    expect(homeSource).toContain('onEndReached={() => void loadMore()}');
    expect(homeSource).not.toContain("productText('action.load-more-group'");
  });
});
