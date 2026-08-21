import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import type {PlaybackResponse} from '@portico/client-core';
import {createPlayerSessionController} from '@portico-react-native/player';
import {Focusable} from './primitives';
import {FiveControlTransport} from './playerPresenters';
import {PlayerUtilityDock} from './playerUtilityPresenters';

const sharedPlayerOutcome = (
  require('../../../../scripts/parity/tv-interaction-outcomes.v1.json') as {
    cases: Array<{
      id: string;
      expected: {transportOrder?: string[]; utilityOrder?: string[]};
      initial: {focused?: string};
    }>;
  }
).cases.find(item => item.id === 'player-five-transport-to-utilities')!;

function mountedFocusables(tree: TestRenderer.ReactTestRenderer) {
  return tree.root.findAllByType(Focusable);
}

describe('mounted player presenter contract', () => {
  test('the five TV controls invoke the single controller authority in approved order', async () => {
    const controller = createPlayerSessionController();
    const commands = {
      next: jest.fn(),
      pause: jest.fn(),
      play: jest.fn(),
      previous: jest.fn(),
      seekBy: jest.fn(),
      stop: jest.fn(),
    };
    controller.registerCommands(commands);
    controller.publish({
      active: true,
      canNext: true,
      canPrevious: true,
      canSeek: true,
      isPlaying: true,
      mediaFamily: 'video',
      mediaId: 'episode-b',
      platform: 'tv',
      presentation: 'fullscreen',
      title: 'Episode B',
    });
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <FiveControlTransport
          canNext
          canPlayPause
          canPrevious
          canSeek
          isPlaying
          onNext={() => controller.next()}
          onPlayPause={() => controller.pause()}
          onPrevious={() => controller.previous()}
          onSeekBack={() => controller.seekBy(-10)}
          onSeekForward={() => controller.seekBy(10)}
          platform="tv"
        />,
      );
    });
    const controls = mountedFocusables(tree);
    expect(controls.map(node => node.props.tvFocusId)).toEqual(
      sharedPlayerOutcome.expected.transportOrder?.map(
        id => `player:transport:${id}`,
      ),
    );
    expect(controls.map(node => node.props.tvFocusOrder)).toEqual([0, 1, 2, 3, 4]);
    expect(controls.map(node => node.props.accessibilityLabel)).toEqual([
      'Previous',
      'Seek back',
      'Pause',
      'Seek forward',
      'Next',
    ]);
    expect(controls[2]?.props.hasTVPreferredFocus).toBe(true);
    expect(controls[2]?.props.tvFocusId.replaceAll(':', '.')).toBe(
      sharedPlayerOutcome.initial.focused,
    );
    controls.forEach(node => node.props.onPress());
    expect(commands.previous).toHaveBeenCalledTimes(1);
    expect(commands.seekBy.mock.calls).toEqual([[-10], [10]]);
    expect(commands.pause).toHaveBeenCalledTimes(1);
    expect(commands.next).toHaveBeenCalledTimes(1);
  });

  test('TV utilities mount only approved capabilities and invoke their real panel IDs', async () => {
    const playback = {
      audioStreams: [{id: 'audio-en'}, {id: 'audio-fr'}],
      qualities: [{available: true, id: '720p'}, {available: true, id: '1080p'}],
      repeatMode: 'off',
      streamFormat: 'hls',
      subtitleStreams: [{id: 'sub-en'}],
    } as PlaybackResponse;
    const opened: string[] = [];
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(
        <PlayerUtilityDock
          allowChapterSeeking
          allowPlaybackRate
          allowStreamSelection
          focusContainer={undefined}
          hasLyrics
          onPanelToggle={id => opened.push(id)}
          onPictureInPicture={jest.fn()}
          onRepeat={jest.fn()}
          onShuffle={jest.fn()}
          panel={null}
          playback={playback}
          platform="tv"
          queueCount={2}
          repeatMode="off"
          showMusicQueueControls
          showPictureInPicture
          showSleepTimer
        />,
      );
    });
    const utilities = mountedFocusables(tree);
    expect(utilities.map(node => node.props.tvFocusId)).toEqual(
      sharedPlayerOutcome.expected.utilityOrder?.map(
        id => `player:utility:${id}`,
      ),
    );
    utilities.forEach(node => node.props.onPress());
    expect(opened).toEqual([
      'volume',
      'subtitles',
      'quality',
      'speed',
      'sleep',
      'queue',
    ]);
    expect(utilities.every(node => node.props.tvFocusBoundaryDirections?.includes('down'))).toBe(true);

    await act(async () => {
      tree.update(
        <PlayerUtilityDock
          allowChapterSeeking={false}
          allowPlaybackRate={false}
          allowStreamSelection={false}
          focusContainer={undefined}
          hasLyrics={false}
          onPanelToggle={jest.fn()}
          onPictureInPicture={jest.fn()}
          onRepeat={jest.fn()}
          onShuffle={jest.fn()}
          panel={null}
          playback={{...playback, qualities: [], subtitleStreams: []}}
          platform="tv"
          queueCount={0}
          repeatMode="off"
          showMusicQueueControls={false}
          showPictureInPicture={false}
          showSleepTimer={false}
        />,
      );
    });
    expect(mountedFocusables(tree).map(node => node.props.tvFocusId)).toEqual([
      'player:utility:volume',
    ]);
  });
});
