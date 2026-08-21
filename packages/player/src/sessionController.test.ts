import {createPlayerSessionController, playerLifecycleDecision, type PlayerSessionSnapshot} from './sessionController';

const snapshot = (update: Partial<PlayerSessionSnapshot> = {}): PlayerSessionSnapshot => ({
  active: true,
  isPlaying: true,
  mediaFamily: 'video',
  mediaId: 'media-1',
  platform: 'tv',
  presentation: 'fullscreen',
  title: 'Title',
  ...update,
});

describe('shared player session lifecycle', () => {
  it('pauses video when the application backgrounds', () => {
    expect(playerLifecycleDecision(snapshot(), {type: 'app-background'})).toMatchObject({pause: true, stop: false});
  });

  it('returns TV audio to browse without pausing or stopping', () => {
    expect(playerLifecycleDecision(snapshot({mediaFamily: 'audio'}), {type: 'back'})).toEqual({
      pause: false,
      presentation: 'background',
      restoreInvoker: true,
      stop: false,
      toggle: false,
    });
  });

  it('stops TV video and restores its invoker on Back', () => {
    expect(playerLifecycleDecision(snapshot(), {type: 'back'})).toMatchObject({pause: true, restoreInvoker: true, stop: true});
  });

  it('routes global remote play/pause through the one command authority', () => {
    const controller = createPlayerSessionController();
    const play = jest.fn();
    const pause = jest.fn();
    controller.registerCommands({next: jest.fn(), pause, play, previous: jest.fn(), seekBy: jest.fn(), stop: jest.fn()});
    controller.publish(snapshot({isPlaying: true}));
    controller.handle({type: 'remote-toggle'});
    expect(pause).toHaveBeenCalledTimes(1);
    controller.update({isPlaying: false});
    controller.handle({type: 'remote-toggle'});
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('stops background audio only after profile-switch confirmation', () => {
    const controller = createPlayerSessionController();
    const stop = jest.fn();
    controller.registerCommands({next: jest.fn(), pause: jest.fn(), play: jest.fn(), previous: jest.fn(), seekBy: jest.fn(), stop});
    controller.publish(snapshot({mediaFamily: 'audio', presentation: 'background'}));
    expect(controller.profileSwitchNeedsConfirmation()).toBe(true);
    expect(stop).not.toHaveBeenCalled();
    controller.confirmProfileSwitch();
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
