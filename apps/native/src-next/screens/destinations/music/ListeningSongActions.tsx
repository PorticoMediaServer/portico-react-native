import React from 'react';
import {View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls';
import type {NativeListeningSong} from '../../../shell/listening-song-detail';

const t = defaultI18n.t;

/** The current song's own heart. A token is the only source of its state: while it is absent
 * nothing is drawn, and a command never assumes the answer. More waits for a guarded
 * playlist-open seam, so this surface does not borrow the TV picker's press-time opening. */
export function ListeningSongActions({song, pending, favorite, testID = 'now-playing-song'}: {
  song?: NativeListeningSong;
  pending: boolean;
  favorite: (token: NativeListeningSong, value: boolean) => void;
  testID?: string;
}) {
  if (!song) return null;
  if (!song.actions.some(action => action.id === 'favorite' && action.enabled)) return null;
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12}}>
    <Button testID={`${testID}-favorite`} variant={song.favorite ? 'primary' : 'glass'} iconOnly
      icon={song.favorite ? 'i-heart-f' : 'i-heart'} accessibilityLabel={t(song.favorite ? 'entry.removeFromFavorites' : 'entry.addToFavorites')}
      accessibilityState={{checked: song.favorite, disabled: pending}} disabled={pending} onPress={() => favorite(song, !song.favorite)}/>
  </View>;
}
