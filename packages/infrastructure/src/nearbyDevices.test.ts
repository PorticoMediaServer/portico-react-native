import {
  parseNearbyTVSetup,
  PORTICO_SETUP_PROTOCOL_VERSION,
  PORTICO_SETUP_SERVICE_TYPE,
} from './nearbyDevices';
import {formatTVSetupCode, TV_SETUP_CODE_ALPHABET} from './tvSetupCode';

describe('nearby Portico setup discovery', () => {
  test('formats compact and grouped protocol-v1 codes with the unambiguous alphabet', () => {
    expect(TV_SETUP_CODE_ALPHABET).toBe('ABCDEFGHJKMNPQRSTUVWXYZ23456789');
    expect(formatTVSetupCode('abcd2345')).toBe('ABCD-2345');
    expect(formatTVSetupCode(' efgh-jkmn ')).toBe('EFGH-JKMN');
    expect(formatTVSetupCode('ABCI-2345')).toBeUndefined();
    expect(formatTVSetupCode('ABCD-2305')).toBeUndefined();
    expect(formatTVSetupCode('123456')).toBeUndefined();
  });

  test('accepts only complete, unexpired protocol-v1 setup advertisements', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(parseNearbyTVSetup({
      action: 'found',
      instanceName: 'Living Room TV',
      serviceType: `${PORTICO_SETUP_SERVICE_TYPE}.local.`,
      txt: {txtversion: String(PORTICO_SETUP_PROTOCOL_VERSION), setupid: 'setup-1', code: 'abcd2345', publickey: 'public-key', name: 'Living Room TV', platform: 'tvOS', appversion: '0.1.0', expiresat: expiresAt},
    })).toMatchObject({code: 'ABCD-2345', deviceName: 'Living Room TV', protocolVersion: 1, setupSessionId: 'setup-1'});
  });

  test('rejects legacy, ambiguous, expired, and incomplete records', () => {
    const base = {action: 'found', instanceName: 'TV', serviceType: PORTICO_SETUP_SERVICE_TYPE};
    const txt = {txtversion: String(PORTICO_SETUP_PROTOCOL_VERSION), setupid: 'setup-1', code: 'ABCD-2345', publickey: 'public-key', name: 'TV', platform: 'tvOS', appversion: '0.1.0', expiresat: new Date(Date.now() + 60_000).toISOString()};
    expect(parseNearbyTVSetup({...base, txt: {...txt, txtversion: '2'}})).toBeUndefined();
    expect(parseNearbyTVSetup({...base, txt: {...txt, code: 'ABCI-2345'}})).toBeUndefined();
    expect(parseNearbyTVSetup({...base, txt: {...txt, expiresat: new Date(Date.now() - 1).toISOString()}})).toBeUndefined();
    expect(parseNearbyTVSetup({...base, txt: {...txt, publickey: ''}})).toBeUndefined();
  });
});
