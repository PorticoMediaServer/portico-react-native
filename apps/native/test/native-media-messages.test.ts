import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultI18n} from '../../../packages/i18n/src/index.ts';
import {serviceI18n, setServiceI18n} from '../../../packages/client-core/src/presentation/service-text.ts';
import {nativePlaybackMessage, nativeRateError} from '../src-next/platform/playback/native-messages.ts';
import {NativePlaybackSpeed} from '../src/bridge/NativePlaybackSpeed.ts';

test('unknown native diagnostics never become product copy, including object prototype names', () => {
  for (const diagnostic of ['Private decoder text', 'toString', '__proto__', {message: 'Private decoder text'}]) {
    assert.equal(nativePlaybackMessage(diagnostic), defaultI18n.t('queuePlayer.startFailed'));
  }
  assert.equal(nativePlaybackMessage('seek_unavailable'), defaultI18n.t('playback.message.seek_mismatch'));
  assert.equal(nativePlaybackMessage('media_unavailable'), defaultI18n.t('queuePlayer.unsupported'));
});

test('native status presentation uses the active shell catalogue at the time of the event', () => {
  const previous = serviceI18n();
  try {
    setServiceI18n({...defaultI18n, t: id => `catalogue:${id}`});
    assert.equal(nativePlaybackMessage('listening_reconnecting'), 'catalogue:player.reconnecting');
    assert.equal(nativeRateError('rate_unavailable'), 'catalogue:player.opt.speedUnsupported');
  } finally { setServiceI18n(previous); }
});

test('rate observations and native listening reconciliation do not expose engine text', () => {
  const speed = new NativePlaybackSpeed();
  speed.observe({intentId: 1, effectiveRate: 1, rateReady: true, supportedRates: [1], rateError: 'Private decoder text'});
  assert.equal(speed.getSnapshot().error, defaultI18n.t('player.opt.speedUnsupported'));
  speed.reconcileNative({rate: 1, effectiveRate: 1, ready: true, rateError: ''});
  assert.equal(speed.getSnapshot().error, undefined);
  assert.equal(nativeRateError(undefined), undefined);
});
