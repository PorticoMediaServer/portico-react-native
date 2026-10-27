import React, {useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {presentError} from '../../../../../packages/client-core/src/presentation/errors';
import type {OfflineEntry, OfflineSnapshot} from '../../platform/offline-downloads';
import type {RememberedDownloadsOpening} from '../../shell/remembered-downloads-opening';
import {Button} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import {downloadEntryIdentity} from './presentation';
import type {createRememberedReadingOwner} from '../../shell/remembered-reading-owner';

const empty: Pick<OfflineSnapshot, 'entries'> = Object.freeze({entries: Object.freeze([])});
type Opening = {source: RememberedDownloadsOpening; active: boolean; abort: AbortController; flight?: object};
/** No normal shell/runtime impersonation: this view borrows only the root's
 * exact offline opening and its one native receipt-owned surface. */
export function RememberedDownloadsScreen({source, onBack}: {source: RememberedDownloadsOpening; onBack: () => void}) {
  const theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions(), t = defaultI18n.t;
  const owner = useRef<Opening | undefined>(undefined);
  const [committed, setCommitted] = useState<Opening>(), [busy, setBusy] = useState(false), [failure, setFailure] = useState<unknown>();
  const [reading, setReading] = useState<ReturnType<typeof createRememberedReadingOwner> | undefined>();
  if (owner.current && owner.current.source !== source) {owner.current.active = false; owner.current.abort.abort();}
  useLayoutEffect(() => {
    const opening: Opening = {source, active: true, abort: new AbortController()}; owner.current = opening; setCommitted(opening);
    return () => {opening.active = false; opening.abort.abort(); if (owner.current === opening) owner.current = undefined;};
  }, [source]);
  const subscribe = useCallback((listener: () => void) => {try {return source.current() ? source.device.subscribe(listener) : () => {};} catch {return () => {};}}, [source]);
  const read = useCallback((): Pick<OfflineSnapshot, 'entries'> => {try {return source.current() ? source.device.getSnapshot() : empty;} catch {return empty;}}, [source]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const rendered = committed;
  const current = () => !!rendered?.active && rendered.source === source && owner.current === rendered && !rendered.abort.signal.aborted && source.current();
  const run = (action: (lifetime: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>) => Promise<void>) => {
    if (!current() || !rendered || rendered.flight) return;
    const flight = {}; rendered.flight = flight; setBusy(true); setFailure(undefined);
    const active = () => current() && rendered.flight === flight;
    if (!active()) return;
    void action({signal: rendered.abort.signal, isCurrent: active}).catch(error => {if (active()) setFailure(error);})
      .finally(() => {if (active()) {rendered.flight = undefined; setBusy(false);}});
  };
  const entries = snapshot.entries.filter(entry => {try {const kind = entry.kind ?? entry.info?.kind ?? '';
    return entry.state === 'ready' && ((!!source.player && ['movie', 'episode', 'song', 'audiobook_file'].includes(kind))
      || (['ebook', 'comic'].includes(kind) && !!source.canRead?.(entry))) && source.device.playabilityReason(entry) === null;} catch {return false;}});
  const play = (entry: OfflineEntry) => {const kind = entry.kind ?? entry.info?.kind ?? '';
    if (['ebook', 'comic'].includes(kind)) {if (!current() || !source.reading) return; try {setFailure(undefined); setReading(source.reading(entry));} catch (error) {if (current()) setFailure(error);} return;}
    const player = source.player; if (player) run(lifetime => player.open(entry, lifetime));};
  const back = () => {if (!current() || !rendered) return; rendered.active = false; rendered.abort.abort();
    const fence = source.player?.fence(); if (fence) source.player?.close(fence); onBack();};
  if (reading && source.noticeCopy) {const ReadingScreen = (require('./RememberedReadingScreen') as typeof import('./RememberedReadingScreen')).RememberedReadingScreen;
    return <ReadingScreen reading={reading} noticeCopy={source.noticeCopy} current={current} onBack={() => {if (current()) setReading(undefined);}}/>;}
  return <View testID="remembered-downloads" style={{flex: 1, backgroundColor: theme.colors.ink, paddingTop: insets.top}}>
    <ScrollView contentContainerStyle={{padding: 24, paddingBottom: Math.max(24, insets.bottom), gap: 16}}>
      <Button variant="text" onPress={back}>{t('action.back')}</Button>
      <Text accessibilityRole="header" style={[theme.type.title, {color: theme.colors.text}]}>{t('downloads.title')}</Text>
      {source.player ? <RememberedPlayer player={source.player} width={dimensions.width} busy={busy} current={current} run={run}/> : null}
      {failure && <Text accessibilityRole="alert" style={[theme.type.body, {color: theme.colors.textSecondary}]}>{presentError(failure, 'home').body}</Text>}
      {entries.map(entry => <Button key={downloadEntryIdentity(entry)} variant="glass" disabled={busy} onPress={() => play(entry)}>{entry.title}</Button>)}
      {!entries.length && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('downloads.emptyTitle')}</Text>}
    </ScrollView>
  </View>;
}

type Player = NonNullable<RememberedDownloadsOpening['player']>;
function RememberedPlayer({player, width, busy, current, run}: {player: Player; width: number; busy: boolean; current: () => boolean;
  run: (action: (lifetime: Readonly<{signal: AbortSignal; isCurrent: () => boolean}>) => Promise<void>) => void}) {
  const theme = useTheme(), t = defaultI18n.t;
  const state = useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot), fence = player.fence(), Surface = player.Surface;
  return <>
    <View style={{height: Math.round(width * 9 / 16), backgroundColor: theme.colors.raised}}><Surface/></View>
    {fence && <View style={{flexDirection: 'row', gap: 12}}>
      <Button variant="glass" disabled={busy || !['starting', 'ready', 'ended'].includes(state.phase)} onPress={() => {if (!current()) return;
        if (state.phase === 'ended') run(lifetime => player.replay(fence, lifetime));
        else if (state.intent === 'playing') player.pause(fence); else player.resume(fence);
      }}>{t(state.phase !== 'ended' && state.intent === 'playing' ? 'action.pause' : 'action.play')}</Button>
      <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{Math.floor(state.positionSeconds)} / {Math.floor(state.session?.duration ?? 0)}</Text>
    </View>}
    {state.error && <Text accessibilityRole="alert" style={[theme.type.body, {color: theme.colors.textSecondary}]}>{state.error}</Text>}
  </>;
}

export function RememberedDownloadsShortcut({source}: {source: RememberedDownloadsOpening}) {
  const owner = useRef<{source: RememberedDownloadsOpening; active: boolean} | undefined>(undefined);
  const [opening, setOpening] = useState<{source: RememberedDownloadsOpening; active: boolean}>();
  if (owner.current && owner.current.source !== source) owner.current.active = false;
  useLayoutEffect(() => {const ticket = {source, active: true}; owner.current = ticket; setOpening(ticket);
    return () => {ticket.active = false; if (owner.current === ticket) owner.current = undefined;};}, [source]);
  const snapshot = useSyncExternalStore(source.entry.subscribe, source.entry.getSnapshot, source.entry.getSnapshot);
  if (!snapshot.available || !source.current()) return null;
  return <Button variant="glass" onPress={() => {if (opening?.active && opening.source === source && owner.current === opening && source.current()) source.entry.open();}}>{defaultI18n.t('downloads.title')}</Button>;
}
