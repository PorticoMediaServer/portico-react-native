import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {manualMoves, movedOrder, moveTarget, type ManualMove} from '../../../../packages/client-core/src/presentation/manual-order';
import {captionFor, iconFor, shapeFor, useArtwork} from '../app/content';
import {useI18n} from '../app/i18n';
import {Divider, ListRow, Menu, showToast, useTheme, type MenuItem} from '../ui';

export type OrderedEntry = Readonly<{id: string; media: ContentEntry}>;

/**
 * A list that keeps its own order (a personal collection, a library collection), shown for moving
 * its titles on a phone or tablet: each row's menu moves it to the top, up, down or to the bottom.
 * A move is shown at once and sent as the entry and the one it now follows; when the server
 * refuses it, the list goes back to the server's order and says so.
 */
export function ManualOrderRows({entries, whole, onMove}: {entries: readonly OrderedEntry[]; whole: boolean; onMove: (from: number, to: number) => Promise<void>}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const artwork = useArtwork();
  const [shown, setShown] = useState(entries);
  const [menu, setMenu] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // The server's order wins whenever it arrives.
  useEffect(() => setShown(entries), [entries]);
  const labels: Record<ManualMove, string> = {top: i18n.t('order.moveTop'), up: i18n.t('web.profile.moveUp'), down: i18n.t('web.profile.moveDown'), bottom: i18n.t('order.moveBottom')};
  const move = (from: number, to: number) => {
    if (busy || from === to) return;
    const before = shown, title = shown[from]?.media.title ?? '';
    setShown(movedOrder(shown, from, to));
    setBusy(true);
    onMove(from, to).catch(() => { setShown(before); showToast({message: i18n.t('order.failed', {title}), icon: 'warning'}); }).finally(() => setBusy(false));
  };
  const items = (index: number): MenuItem[] => manualMoves(index, shown.length, whole).map(m => ({id: m, label: labels[m]}));
  return (
    <View style={{paddingHorizontal: space.page - space.sm}}>
      {shown.map((e, index) => {
        const m = e.media;
        return (
          <View key={e.id}>
            {index > 0 ? <Divider inset={space.sm} /> : null}
            <ListRow
              ordinal={index + 1}
              title={m.title}
              subtitle={captionFor(m)}
              source={artwork(m.posterUrl ?? m.backdropUrl)}
              shape={shapeFor(m.kind) === 'square' ? 'square' : 'poster'}
              icon={m.posterUrl || m.backdropUrl ? undefined : iconFor(m.kind)}
              accessory="menu"
              disabled={busy}
              accessibilityHint={i18n.t('order.handle', {title: m.title})}
              onPress={() => setMenu(index)}
            />
          </View>
        );
      })}
      {menu !== null && shown[menu] && items(menu).length ? <Menu open onClose={() => setMenu(null)} title={shown[menu]!.media.title} items={items(menu)} onSelect={id => { const from = menu; setMenu(null); move(from, moveTarget(id as ManualMove, from, shown.length)); }} /> : null}
    </View>
  );
}
