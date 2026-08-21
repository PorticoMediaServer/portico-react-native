import {applicationRootPhaseForState} from './applicationRootPhase';

describe('always-mounted application root phases', () => {
  it.each([
    [{status: 'booting', hasAccount: false, transitionFailure: false}, 'Account'],
    [{status: 'signed-out', hasAccount: false, transitionFailure: false}, 'Account'],
    [{status: 'connecting', hasAccount: false, transitionFailure: false}, 'Account'],
    [{status: 'selecting-profile', hasAccount: true, transitionFailure: false}, 'Profile'],
    [{status: 'authenticated', hasAccount: true, transitionFailure: true}, 'FailClosed'],
    [{status: 'server-unavailable', hasAccount: true, transitionFailure: false}, 'Product'],
    [{status: 'authenticated', hasAccount: true, transitionFailure: false}, 'Product'],
  ] as const)('maps %o to %s', (input, expected) => {
    expect(applicationRootPhaseForState(input)).toBe(expected);
  });
});
