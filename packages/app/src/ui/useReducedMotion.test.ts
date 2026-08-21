import {modalAnimationTypeFor} from './useReducedMotion';

describe('modalAnimationTypeFor', () => {
  it('disables native modal motion when Reduce Motion is enabled', () => {
    expect(modalAnimationTypeFor('fade', true)).toBe('none');
    expect(modalAnimationTypeFor('slide', true)).toBe('none');
  });

  it('preserves the designed animation when Reduce Motion is disabled', () => {
    expect(modalAnimationTypeFor('fade', false)).toBe('fade');
    expect(modalAnimationTypeFor('slide', false)).toBe('slide');
  });
});
