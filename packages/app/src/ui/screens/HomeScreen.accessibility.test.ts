import {canonicalMediaKindLabel} from './HomeScreen';

describe('Home media-kind accessibility labels', () => {
  it.each([
    ['show', 'TV Show'],
    ['episode', 'Episode'],
    ['artist', 'Artist'],
    ['book', 'Audiobook'],
    ['live_channel', 'Live channel'],
    ['recording', 'DVR recording'],
    ['future-provider-kind', 'Media'],
  ])('labels %s canonically', (kind, expected) => {
    expect(canonicalMediaKindLabel(kind)).toBe(expected);
  });
});
