import React, {useState} from 'react';
import {View} from 'react-native';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {Button} from '../../../kit/controls';
import {Menu, type MenuEntry} from '../../../kit/overlays';
import type {NativeListeningSong} from '../../../shell/listening-song-detail';

const t = defaultI18n.t;

/** The current song's own heart, and the server-offered actions this surface can really present.
 * A token is the only source of the heart's state: while it is absent nothing is drawn, and a
 * command never assumes the answer. Add to playlist is the one Detail action the existing
 * authority-local picker already presents for this song; no other action is invented here. */
export function ListeningSongActions({song, pending, favorite, addToPlaylist, title, testID = 'now-playing-song'}: {
  song?: NativeListeningSong;
  pending: boolean;
  favorite: (token: NativeListeningSong, value: boolean) => void;
  addToPlaylist?: () => void;
  title: string;
  testID?: string;
}) {
  const [more, setMore] = useState(false);
  if (!song) return null;
  const offered = song.actions.filter(action => action.enabled).map(action => action.id);
  const hasFavorite = offered.includes('favorite');
  const items: MenuEntry[] = [];
  if (addToPlaylist && offered.includes('add_to_playlist')) {
    items.push({id: 'add_to_playlist', label: t('entry.addToPlaylist'), icon: 'i-listplus', onSelect: addToPlaylist});
  }
  if (!hasFavorite && !items.length) return null;
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12}}>
    {hasFavorite ? <Button testID={`${testID}-favorite`} variant={song.favorite ? 'primary' : 'glass'} iconOnly
      icon={song.favorite ? 'i-heart-f' : 'i-heart'} accessibilityLabel={t(song.favorite ? 'entry.removeFromFavorites' : 'entry.addToFavorites')}
      accessibilityState={{checked: song.favorite, disabled: pending}} disabled={pending} onPress={() => favorite(song, !song.favorite)}/> : null}
    {items.length ? <Button testID={`${testID}-more`} variant="glass" iconOnly icon="i-more" accessibilityLabel={t('card.more', {title})}
      accessibilityState={{expanded: more}} onPress={() => setMore(true)}/> : null}
    {more && items.length ? <Menu testID={`${testID}-more-menu`} open presentation="sheet" title={title}
      onOpenChange={open => {if (!open) setMore(false);}} items={items}/> : null}
  </View>;
}
