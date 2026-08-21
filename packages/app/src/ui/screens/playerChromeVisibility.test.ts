import {playerChromeMustRemainVisible} from '../playerRuntimeModel';

describe('player chrome visibility policy', () => {
  it.each(['loading', 'paused', 'buffering'] as const)(
    'keeps controls visible while playback is %s',
    state => {
      expect(playerChromeMustRemainVisible({ended: false, hasError: false, panelOpen: false, state})).toBe(true);
    },
  );

  it('allows controls to auto-hide only during unobstructed playback', () => {
    expect(playerChromeMustRemainVisible({ended: false, hasError: false, panelOpen: false, state: 'playing'})).toBe(false);
  });

  it.each([
    {ended: true, hasError: false, panelOpen: false},
    {ended: false, hasError: true, panelOpen: false},
    {ended: false, hasError: false, panelOpen: true},
  ])('keeps controls visible for terminal and interactive exceptions', exception => {
    expect(playerChromeMustRemainVisible({...exception, state: 'playing'})).toBe(true);
  });
});
