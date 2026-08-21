import {isFilledSelectedIcon} from './index';
import {semanticToMaster} from './generated';

describe('Portico icon contract', () => {
  it('exposes the complete v1 semantic registry', () => {
    expect(Object.keys(semanticToMaster)).toHaveLength(162);
  });

  it('governs filled selected states without applying a generic fill', () => {
    expect(isFilledSelectedIcon('action.favorite')).toBe(true);
    expect(isFilledSelectedIcon('action.watchlist')).toBe(true);
    expect(isFilledSelectedIcon('library.saved')).toBe(false);
    expect(isFilledSelectedIcon('playback.play')).toBe(false);
  });
});
