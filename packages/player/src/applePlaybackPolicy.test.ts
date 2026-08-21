import {applePlaybackPolicyFor} from './applePlaybackPolicy';

describe('applePlaybackPolicyFor', () => {
  test.each([
    ['video', {backgroundAudio: false, mediaFamily: 'video', pictureInPictureEligible: true}],
    ['live', {backgroundAudio: false, mediaFamily: 'video', pictureInPictureEligible: true}],
    ['music', {backgroundAudio: true, mediaFamily: 'music', pictureInPictureEligible: false}],
    ['audiobook', {backgroundAudio: true, mediaFamily: 'audiobook', pictureInPictureEligible: false}],
    [undefined, {backgroundAudio: false, mediaFamily: 'unknown', pictureInPictureEligible: false}],
  ] as const)('gates canonical iOS mobile %s playback honestly', (contentMode, expected) => {
    expect(applePlaybackPolicyFor({isTV: false, os: 'ios'}, contentMode)).toMatchObject({
      ...expected,
      nowPlaying: true,
      remoteCommands: true,
    });
  });

  test.each([
    ['video', false],
    ['music', true],
  ] as const)('advertises tvOS media commands and only audio background support for %s', (contentMode, backgroundAudio) => {
    expect(applePlaybackPolicyFor({isTV: true, os: 'ios'}, contentMode)).toMatchObject({
      backgroundAudio,
      nowPlaying: true,
      pictureInPictureEligible: false,
      remoteCommands: true,
    });
  });

  test('does not advertise Apple integration on non-iOS mobile', () => {
    expect(applePlaybackPolicyFor({isTV: false, os: 'android'}, 'video')).toMatchObject({
      backgroundAudio: false,
      nowPlaying: false,
      pictureInPictureEligible: false,
      remoteCommands: false,
    });
  });
});
