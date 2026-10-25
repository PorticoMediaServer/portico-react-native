import React, {useRef, useState} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {Gesture, GestureDetector} from 'react-native-gesture-handler';
import type {QueuePlaybackView} from '../../../../../../packages/client-core/src/queue-controller';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {clockText} from '../../../../../../packages/client-core/src/presentation/kit-model/text';
import {AmbientArt, Artwork} from '../../../kit/artwork';
import {Button} from '../../../kit/controls';
import {Icon} from '../../../kit/Icon';
import {useTheme} from '../../../kit/theme';
import {browseType} from '../../../kit/browse/presentation';
import {commandAllowed, dockCommand, playbackPosition, seekBounds, seekTo} from '../../../kit/dock/model';
import type {DockCommand, DockOccupant} from '../../../kit/dock/types';
import {NowPlayingQueue} from './NowPlayingQueue';

const t = defaultI18n.t;

/** tablet-play9/10: the listening surface for music and audiobooks. The real
 * dock occupant supplies the picture, identity, transport capabilities and seek
 * window; the listening owner supplies the queue. Wide windows put the queue
 * beside the now-playing column at 366 pt (the main column never drops below a
 * usable cover); narrower ones stack it under the column, toggled by Up next. */
export type NowPlayingScreenProps = Readonly<{
  occupant: DockOccupant;
  queue?: QueuePlaybackView;
  width: number;
  height: number;
  topInset?: number;
  bottomInset?: number;
  onAction: (command: DockCommand) => void;
  onQueuePlay?: (queueId: string, entryId: string, revision: string) => void;
  onClose: () => void;
  testID?: string;
}>;

const QUEUE_WIDTH = 366;
const SIDE_BY_SIDE = 700;

export function NowPlayingScreen({occupant, queue, width, height, topInset = 0, bottomInset = 0, onAction, onQueuePlay, onClose, testID = 'now-playing'}: NowPlayingScreenProps) {
  const theme = useTheme(), {presentation: p, playback} = occupant;
  const [queueOpen, setQueueOpen] = useState(false), track = useRef(0);
  const wide = width >= SIDE_BY_SIDE, side = wide && !!queue, position = playbackPosition(occupant), bounds = seekBounds(occupant);
  const span = bounds ? Math.max(0, bounds.end - bounds.start) : 0;
  const fraction = bounds && span > 0 ? Math.min(1, Math.max(0, (position - bounds.start) / span)) : 0;
  const act = (type: Parameters<typeof dockCommand>[1]) => {if (commandAllowed(occupant, type)) onAction(dockCommand(occupant, type));};
  const to = (x: number) => {
    if (!bounds || !track.current || !Number.isFinite(x)) return;
    const command = seekTo(occupant, bounds.start + Math.min(1, Math.max(0, x / track.current)) * span);
    if (command) onAction(command);
  };
  const scrub = Gesture.Pan().enabled(!!bounds && p.capabilities.seek && span > 0).runOnJS(true).minDistance(0)
    .onBegin(event => to(event.x)).onUpdate(event => to(event.x));
  const facts = p.identity.subtitle.map(part => part.text).filter(Boolean).join(' · ');
  const album = (p.album ?? []).map(part => part.text).filter(Boolean).join(' · ');
  const cover = Math.max(160, Math.min(410, wide ? width - QUEUE_WIDTH - 120 : width - 96));
  const column = <View testID={`${testID}-column`} style={{flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 28, paddingTop: wide ? 36 : 20}}>
    {p.artwork ? <Artwork source={p.artwork} width={cover} height={cover} radius={14}/> : null}
    <Text numberOfLines={2} accessibilityRole="header" style={[browseType(theme, wide ? 34 : 26, 800, -0.03), {marginTop: 26, textAlign: 'center', color: theme.colors.text}]}>{p.identity.title}</Text>
    {facts ? <Text numberOfLines={1} style={[browseType(theme, 15, 500), {marginTop: 8, textAlign: 'center', color: theme.colors.textSecondary}]}>{facts}</Text> : null}
    {album ? <Text numberOfLines={1} style={[browseType(theme, 13, 500), {marginTop: 4, textAlign: 'center', color: theme.colors.textTertiary}]}>{album}</Text> : null}
    <View style={{width: '100%', maxWidth: 520, marginTop: 24}}>
      <GestureDetector gesture={scrub}><View testID={`${testID}-scrubber`} accessibilityRole="adjustable" accessibilityLabel={t('player.queue')}
        accessibilityValue={{min: 0, max: Math.round(span), now: Math.round(Math.max(0, Math.min(span, position - (bounds?.start ?? 0))))}}
        onLayout={event => {track.current = event.nativeEvent.layout.width;}}
        style={{height: 28, justifyContent: 'center'}}>
        <View style={{height: 4, borderRadius: 2, backgroundColor: 'rgba(237,245,250,.18)'}}>
          <View style={{width: `${fraction * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/>
        </View>
      </View></GestureDetector>
      <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 2}}>
        <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{clockText(Math.max(0, position - (bounds?.start ?? 0)))}</Text>
        <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{clockText(span || p.durationSeconds)}</Text>
      </View>
    </View>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 28, marginTop: 20}}>
      <Button testID={`${testID}-previous`} variant="glass" iconOnly icon="i-prev" accessibilityLabel={t('player.previous')}
        disabled={!p.capabilities.previous} onPress={() => act('previous')}/>
      <Button testID={`${testID}-toggle`} variant="primary" iconOnly icon={playback.playing ? 'i-pause' : 'i-play'}
        accessibilityLabel={t(playback.playing ? 'action.pause' : 'action.play')}
        disabled={playback.playing ? !p.capabilities.pause : !p.capabilities.play} onPress={() => act(playback.playing ? 'pause' : 'play')}/>
      <Button testID={`${testID}-next`} variant="glass" iconOnly icon="i-next" accessibilityLabel={t('player.next')}
        disabled={!p.capabilities.next} onPress={() => act('next')}/>
    </View>
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 26, marginBottom: 24}}>
      {!side && queue ? <Button testID={`${testID}-queue-toggle`} variant={queueOpen ? 'primary' : 'glass'} size="small" icon="i-queue"
        accessibilityState={{expanded: queueOpen}} onPress={() => setQueueOpen(open => !open)}>{t('player.queue')}</Button> : null}
      <Button testID={`${testID}-close`} variant="glass" size="small" icon="i-down" accessibilityLabel={t('player.minimize')} onPress={onClose}>{t('action.close')}</Button>
    </View>
    {!side && queue && queueOpen ? <View style={{width: '100%', maxWidth: 560, height: Math.max(280, Math.round(height * .42)), borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(237,245,250,.06)'}}>
      <NowPlayingQueue testID={`${testID}-queue`} view={queue} onPlay={onQueuePlay}/>
    </View> : null}
  </View>;
  return <View testID={testID} style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}>
    {p.ambient ? <View pointerEvents="none" style={{position: 'absolute', top: 0, left: 0, right: 0, height: Math.min(height, 720), overflow: 'hidden'}}>
      <AmbientArt source={p.ambient} treatment="title" style={{position: 'absolute', inset: 0}}/>
      <View style={{position: 'absolute', inset: 0, backgroundColor: 'rgba(7,16,24,.5)'}}/>
    </View> : null}
    <View style={{flex: 1, paddingTop: topInset, paddingBottom: bottomInset}}>
      {side ? <View style={{flex: 1, flexDirection: 'row'}}>
        <ScrollView contentContainerStyle={{flexGrow: 1, justifyContent: 'center'}} style={{flex: 1, minWidth: 0}} showsVerticalScrollIndicator={false}>{column}</ScrollView>
        <View style={{width: QUEUE_WIDTH, borderLeftWidth: 1, borderLeftColor: theme.colors.line, backgroundColor: 'rgba(9,19,27,.66)'}}>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingTop: 24, paddingBottom: 4}}>
            <Icon name="i-queue" size={20} color={theme.colors.textSecondary}/>
            <Text style={[browseType(theme, 20, 800, -0.02), {color: theme.colors.text}]}>{t('player.queue')}</Text>
          </View>
          <NowPlayingQueue testID={`${testID}-queue`} view={queue} onPlay={onQueuePlay}/>
        </View>
      </View> : <ScrollView contentContainerStyle={{flexGrow: 1}} showsVerticalScrollIndicator={false}>{column}</ScrollView>}
    </View>
  </View>;
}
