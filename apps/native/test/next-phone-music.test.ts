import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';

const stubs = {
  react: {default: {createElement() {}, useRef() { return {current: null}; }, useSyncExternalStore() {}}},
  'react-native': {ScrollView: 'ScrollView', Text: 'Text', View: 'View'},
  'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0})},
  '../../../../../../packages/i18n/src': {defaultI18n: {t: () => '', number: () => ''}},
  '../../../../../../packages/client-core/src/presentation/kit-model': {cardText: () => ({detail: []})},
  '../../../kit/artwork': {AmbientArt() {}, Artwork() {}, ArtistCircle() {}},
  '../../../kit/controls': {Button: 'Button', Focusable: 'Focusable'},
  '../../../kit/cards': {SquareCard: 'SquareCard'},
  '../../../kit/Icon': {Icon: 'Icon'},
  '../../../kit/states': {StateView: 'StateView'},
  '../../../kit/browse/presentation': {alpha: () => '', browseType: () => ({})},
  '../../../kit/theme': {useTheme: () => ({})},
};

test('the phone album and artist pages keep the drawn frame values', async () => {
  const {phoneMusicGeometry} = await screenModule(new URL('../src-next/screens/destinations/music/PhoneMusicScreens.tsx', import.meta.url), stubs);
  assert.deepEqual(phoneMusicGeometry, {
    albumTop: 104, albumCover: 232, albumCoverRadius: 12, albumTitle: 30, albumArtist: 16,
    meta: 13, actionHeight: 46, actionRadius: 10, actionGap: 10,
    trackHeight: 54, trackPaddingLeft: 20, trackPaddingRight: 12, trackGap: 14, trackNumberWidth: 18,
    trackTitle: 15.5, trackNumber: 14, trackDuration: 13.5, trackMoreWidth: 34,
    artistTop: 98, artistCircle: 164, artistTitle: 30, sectionLabel: 13.5, albumCard: 132,
  });
});
