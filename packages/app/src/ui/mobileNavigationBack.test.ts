import {mobileBackAction} from './mobileNavigationBack';

test('Android Back closes transient Portico UI before route history', () => {
  expect(mobileBackAction(true)).toBe('close-transient');
});

test('Android Back delegates ordinary history to React Navigation', () => {
  expect(mobileBackAction(false)).toBe('navigator');
});
