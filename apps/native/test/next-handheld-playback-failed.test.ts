import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule, hooks} from './helpers/screen-harness.mjs';

const react = hooks().react;
const {NativeHandheldPlaybackFailed} = await screenModule(new URL('../src-next/screens/watch/HandheldPlaybackFailed.tsx', import.meta.url), {
  react, 'react-native': {View: 'View'}, '../../../../../packages/client-core/src/presentation/kit-model/text': {clockText: () => '0:42'},
  '../../../../../packages/i18n/src': {defaultI18n: {t: (key: string) => key}}, '../../kit/states': {StateView: 'StateView'},
});

test('handheld failure offers only the supplied retry and keeps its captured callback', () => {
  let calls = 0; const failure = {fence: {}, positionSeconds: 42};
  const withRetry = NativeHandheldPlaybackFailed({failure, retry: () => {calls++;}});
  const state = withRetry.props.children[1];
  assert.equal(state.props.title, 'next.states.playbackStopped');
  state.props.primaryAction.onPress(); assert.equal(calls, 1);
  const noRetry = NativeHandheldPlaybackFailed({failure});
  assert.equal(noRetry.props.children[1].props.primaryAction, undefined);
});
