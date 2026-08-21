describe('nearby discovery subscription broker', () => {
  test('keeps server and setup browsing active without one subscriber cancelling the other', async () => {
    jest.resetModules();
    const startBrowsing = jest.fn().mockResolvedValue(undefined);
    const stopBrowsing = jest.fn().mockResolvedValue(undefined);
    let nativeListener: ((event: unknown) => void) | undefined;
    const remove = jest.fn();
    jest.doMock('react-native', () => {
      return {
        NativeModules: {
          PorticoNearbyDevices: {
            addListener: jest.fn(),
            removeListeners: jest.fn(),
            startAdvertisingReceiver: jest.fn().mockResolvedValue(undefined),
            startAdvertisingSetup: jest.fn().mockResolvedValue(undefined),
            startBrowsing,
            stopAdvertisingReceiver: jest.fn().mockResolvedValue(undefined),
            stopAdvertisingSetup: jest.fn().mockResolvedValue(undefined),
            stopBrowsing,
          },
        },
        NativeEventEmitter: class {
          addListener(_name: string, listener: (event: unknown) => void) {
            nativeListener = listener;
            return {remove};
          }
        },
        Platform: {OS: 'ios'},
        TurboModuleRegistry: {getEnforcing: jest.fn()},
      };
    });

    const discovery = require('./nearbyDevices') as typeof import('./nearbyDevices');
    const setupSnapshots: unknown[][] = [];
    const serverSnapshots: unknown[][] = [];
    const stopSetup = discovery.subscribeToNearbyTVSetups(devices => setupSnapshots.push([...devices]));
    const stopServers = discovery.subscribeToNearbyPorticoServers(servers => serverSnapshots.push([...servers]));
    await settleDiscoveryUpdates();

    expect(startBrowsing).toHaveBeenLastCalledWith(['_portico-setup._tcp', '_portico._tcp']);
    expect(stopBrowsing).not.toHaveBeenCalled();

    nativeListener?.({
      action: 'found',
      instanceName: 'Living Room TV',
      serviceType: '_portico-setup._tcp.local.',
      txt: {
        appversion: '0.1.0',
        code: 'ABCD-2345',
        expiresat: new Date(Date.now() + 60_000).toISOString(),
        name: 'Living Room TV',
        platform: 'tvOS',
        publickey: 'public-key',
        setupid: 'setup-1',
        txtversion: '1',
      },
    });
    expect(setupSnapshots.at(-1)).toHaveLength(1);
    expect(serverSnapshots).toHaveLength(0);

    stopSetup();
    await settleDiscoveryUpdates();
    expect(startBrowsing).toHaveBeenLastCalledWith(['_portico._tcp']);
    expect(remove).not.toHaveBeenCalled();

    stopServers();
    await settleDiscoveryUpdates();
    expect(stopBrowsing).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  test('isolates a throwing discovery subscriber from the remaining subscribers', async () => {
    jest.resetModules();
    let nativeListener: ((event: unknown) => void) | undefined;
    jest.doMock('react-native', () => ({
      NativeModules: {
        PorticoNearbyDevices: {
          addListener: jest.fn(),
          removeListeners: jest.fn(),
          startAdvertisingReceiver: jest.fn().mockResolvedValue(undefined),
          startAdvertisingSetup: jest.fn().mockResolvedValue(undefined),
          startBrowsing: jest.fn().mockResolvedValue(undefined),
          stopAdvertisingReceiver: jest.fn().mockResolvedValue(undefined),
          stopAdvertisingSetup: jest.fn().mockResolvedValue(undefined),
          stopBrowsing: jest.fn().mockResolvedValue(undefined),
        },
      },
      NativeEventEmitter: class {
        addListener(_name: string, listener: (event: unknown) => void) {
          nativeListener = listener;
          return {remove: jest.fn()};
        }
      },
      Platform: {OS: 'ios'},
      TurboModuleRegistry: {getEnforcing: jest.fn()},
    }));

    const discovery = require('./nearbyDevices') as typeof import('./nearbyDevices');
    const throwingListener = jest.fn(() => {
      throw new Error('surface failed');
    });
    const receivingListener = jest.fn();
    const stopThrowing = discovery.subscribeToNearbyTVSetups(throwingListener);
    const stopReceiving = discovery.subscribeToNearbyTVSetups(receivingListener);
    await settleDiscoveryUpdates();

    nativeListener?.({
      action: 'found',
      instanceName: 'Living Room TV',
      serviceType: '_portico-setup._tcp.local.',
      txt: {
        appversion: '0.1.0',
        code: 'ABCD-2345',
        expiresat: new Date(Date.now() + 60_000).toISOString(),
        name: 'Living Room TV',
        platform: 'tvOS',
        publickey: 'public-key',
        setupid: 'setup-1',
        txtversion: '1',
      },
    });

    expect(throwingListener).toHaveBeenCalled();
    expect(receivingListener).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({deviceName: 'Living Room TV'})]),
    );
    stopThrowing();
    stopReceiving();
  });
});

async function settleDiscoveryUpdates(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>(resolve => setImmediate(() => resolve()));
}
