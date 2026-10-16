import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Animated, PanResponder, View, type LayoutChangeEvent} from 'react-native';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {manualMoves, movedOrder, moveTarget, type ManualMove} from '../../../../packages/client-core/src/presentation/manual-order';
import {captionFor, iconFor, shapeFor, useArtwork} from '../app/content';
import {useI18n} from '../app/i18n';
import {Divider, Icon, ListRow, Menu, showToast, useTheme, type MenuItem} from '../ui';

export type OrderedEntry = Readonly<{id: string; media: ContentEntry}>;

/**
 * A list that keeps its own order (a personal collection, a library collection), shown for moving
 * its titles on a phone or tablet: drag a row by its handle, or use the row's menu (to the top, up,
 * down or to the bottom), which is also the way for a screen reader. A move is shown at once and
 * sent as the entry and the one it now follows; when the server refuses it, the list goes back to
 * the server's order and says so. `onDragging` tells the page while a row is held, so the page
 * stops scrolling under the finger.
 */
export function ManualOrderRows({entries, whole, onMove, onDragging}: {entries: readonly OrderedEntry[]; whole: boolean; onMove: (from: number, to: number) => Promise<void>; onDragging?: (dragging: boolean) => void}) {
  const i18n = useI18n();
  const {space, metrics, colors} = useTheme();
  const artwork = useArtwork();
  const [shown, setShown] = useState(entries);
  const [menu, setMenu] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // The row held by its handle, and where it would land if let go now.
  const [drag, setDrag] = useState<{from: number; to: number} | null>(null);
  const offset = useRef(new Animated.Value(0)).current;
  const pitch = useRef(0);
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
  // The latest list and move for the handles' gesture callbacks, which are made once per row.
  const live = useRef({shown, busy, move, onDragging});
  live.current = {shown, busy, move, onDragging};
  const handles = useMemo(() => shown.map((_, index) => PanResponder.create({
    onStartShouldSetPanResponder: () => !live.current.busy,
    onMoveShouldSetPanResponder: () => !live.current.busy,
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderGrant: () => { offset.setValue(0); setDrag({from: index, to: index}); live.current.onDragging?.(true); },
    onPanResponderMove: (_, g) => {
      offset.setValue(g.dy);
      const to = Math.max(0, Math.min(live.current.shown.length - 1, index + Math.round(g.dy / Math.max(1, pitch.current))));
      setDrag(d => (d && d.to !== to ? {from: d.from, to} : d));
    },
    onPanResponderRelease: (_, g) => {
      const to = Math.max(0, Math.min(live.current.shown.length - 1, index + Math.round(g.dy / Math.max(1, pitch.current))));
      offset.setValue(0);
      setDrag(null);
      live.current.onDragging?.(false);
      live.current.move(index, to);
    },
    onPanResponderTerminate: () => { offset.setValue(0); setDrag(null); live.current.onDragging?.(false); },
  })), [shown, offset]);
  const measure = (e: LayoutChangeEvent) => { pitch.current = e.nativeEvent.layout.height; };
  // While a row is held the rows it passes step aside by one row, so the gap shows where it lands.
  const shift = (index: number) => {
    if (!drag || index === drag.from) return 0;
    if (drag.to > drag.from && index > drag.from && index <= drag.to) return -pitch.current;
    if (drag.to < drag.from && index >= drag.to && index < drag.from) return pitch.current;
    return 0;
  };
  return (
    <View style={{paddingHorizontal: space.page - space.sm}}>
      {shown.map((e, index) => {
        const m = e.media;
        const held = drag?.from === index;
        return (
          <Animated.View key={e.id} onLayout={index === 0 ? measure : undefined} style={{zIndex: held ? 1 : 0, backgroundColor: held ? colors.raised : undefined, transform: [{translateY: held ? offset : shift(index)}]}}>
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
              trailing={
                // The handle: press and drag up or down. Hidden from screen readers, which use the menu.
                <View {...handles[index]?.panHandlers} accessible={false} importantForAccessibility="no-hide-descendants" hitSlop={{top: 8, bottom: 8, left: 8, right: 8}} style={{paddingHorizontal: space.sm, paddingVertical: space.xs}}>
                  <Icon name="grip" size={metrics.iconSmall} color={colors.textTertiary} />
                </View>
              }
            />
          </Animated.View>
        );
      })}
      {menu !== null && shown[menu] && items(menu).length ? <Menu open onClose={() => setMenu(null)} title={shown[menu]!.media.title} items={items(menu)} onSelect={id => { const from = menu; setMenu(null); move(from, moveTarget(id as ManualMove, from, shown.length)); }} /> : null}
    </View>
  );
}
