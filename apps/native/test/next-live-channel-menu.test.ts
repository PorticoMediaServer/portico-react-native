import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeChannelMenuEntries} from '../src-next/screens/settings-live/guide-presentation';

const t = (id: string) => id;

test('the guide channel menu offers Favorites to everyone and Hide only to the owner', () => {
  assert.deepEqual(nativeChannelMenuEntries({favorite: false}, false, false, t as never).map(entry => [entry.id, entry.label, entry.icon]),
    [['favorite', 'channels.addFavorite', 'i-star']]);
  assert.deepEqual(nativeChannelMenuEntries({favorite: true}, false, true, t as never).map(entry => [entry.id, entry.label, entry.icon]),
    [['favorite', 'channels.removeFavorite', 'i-star-f'], ['hidden', 'channels.hide', 'i-eyeoff']]);
  // A channel the owner hid (drawn only while hidden channels are shown) is shown again.
  assert.deepEqual(nativeChannelMenuEntries({favorite: false}, true, true, t as never).map(entry => [entry.id, entry.label]),
    [['favorite', 'channels.addFavorite'], ['hidden', 'channels.unhide']]);
});
