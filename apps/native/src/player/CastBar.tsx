import React, {useState} from 'react';
import {View} from 'react-native';
import {castMeta} from '../../../../packages/client-core/src/presentation/index';
import {useCastController} from '../app/cast';
import {useArtwork} from '../app/content';
import {useI18n} from '../app/i18n';
import {useServerPreferences} from '../app/server-preferences';
import {Artwork, Button, ListRow, Ring, Sheet, Text, alpha, useTheme} from '../ui';
import {Timeline} from './Timeline';

/**
 * While something plays on a Chromecast: one compact bar above the tab bar with the thumbnail,
 * the device, the position, Play/Pause and Stop, opening the expanded controller sheet. It also
 * carries pairing progress, the TV's takeover question and errors, so none of them needs a
 * screen of its own. No volume: the v1 receiver has no volume command (MU4 Questions).
 */
export function CastBar() {
  const {controller, snapshot} = useCastController();
  const i18n = useI18n();
  const artwork = useArtwork();
  const prefs = useServerPreferences();
  const skipBack = prefs.value<number>('playback.skipBackSeconds', 10);
  const skipForward = prefs.value<number>('playback.skipForwardSeconds', 30);
  const {space, colors, metrics, isTV} = useTheme();
  const [expanded, setExpanded] = useState(false);
  React.useEffect(() => { if (snapshot.phase !== 'casting') setExpanded(false); }, [snapshot.phase]);
  if (isTV || !controller || snapshot.phase === 'off') return null;
  const device = snapshot.deviceName ?? i18n.t('cast.theTV');
  // The title's display facts, remembered where the cast started (no request per open).
  const meta = castMeta(snapshot.itemId);
  const title = snapshot.title ?? meta?.title ?? i18n.t('cast.region');
  const line =
    snapshot.phase === 'connecting' ? i18n.t('playOn.chooseDevice')
    : snapshot.phase === 'pairing' ? i18n.t('playOn.connectingTo', {device})
    : snapshot.phase === 'waiting' ? i18n.t('cast.waitingForAllow')
    : snapshot.phase === 'replaced' ? i18n.t('cast.replaced')
    : snapshot.phase === 'error' ? snapshot.error ?? i18n.t('cast.error.unreachable')
    : snapshot.durationSeconds > 0 ? i18n.t('cast.positionOf', {device, position: i18n.clock(snapshot.positionSeconds), duration: i18n.clock(snapshot.durationSeconds)})
    : i18n.t('cast.position', {device, position: i18n.clock(snapshot.positionSeconds)});
  const busy = snapshot.phase === 'connecting' || snapshot.phase === 'pairing' || snapshot.phase === 'waiting';
  const casting = snapshot.phase === 'casting';
  return (
    <View style={{paddingHorizontal: space.sm, paddingBottom: space.xs}}>
      <View accessibilityRole="summary" accessibilityLabel={`${i18n.t('cast.region')}: ${title}, ${line}`} style={{flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: metrics.radius.control, backgroundColor: alpha(colors.material, 0.96), borderWidth: 1, borderColor: alpha(colors.lineStrong, 0.5)}}>
        {busy ? <Ring size={20} thickness={2} /> : null}
        {casting && meta?.artworkPath ? <Artwork source={artwork(meta.artworkPath)} shape="square" width={40} height={40} title={title} /> : null}
        <View style={{flex: 1, minWidth: 0}}>
          <Text variant="captionStrong" lines={1}>{title}</Text>
          <Text variant="micro" tone={snapshot.phase === 'error' ? 'danger' : 'tertiary'} lines={1}>{line}</Text>
        </View>
        {casting ? <Button variant="ghost" round icon="maximize" accessibilityLabel={i18n.t('cast.openControls')} onPress={() => setExpanded(true)} /> : null}
        {casting ? <Button variant="ghost" round icon={snapshot.paused ? 'play' : 'pause'} accessibilityLabel={snapshot.paused ? i18n.t('action.play') : i18n.t('action.pause')} onPress={() => controller.toggle()} /> : null}
        {casting || busy ? <Button variant="ghost" round icon="stop" accessibilityLabel={i18n.t('action.stop')} onPress={() => (busy ? controller.cancelConnecting() : controller.stop())} /> : null}
        {snapshot.phase === 'error' || snapshot.phase === 'replaced' ? <Button variant="ghost" round icon="close" accessibilityLabel={i18n.t('action.close')} onPress={() => controller.dismiss()} /> : null}
      </View>
      {casting ? (
        <Sheet open={expanded} onClose={() => setExpanded(false)} title={device} subtitle={title} kind="picker">
          <View style={{gap: space.md}}>
            {meta?.artworkPath ? (
              <View style={{alignItems: 'center'}}>
                <Artwork source={artwork(meta.artworkPath)} shape="poster" width={120} title={title} />
                {meta?.subtitle ? <Text variant="caption" tone="tertiary" lines={1}>{meta.subtitle}</Text> : null}
              </View>
            ) : null}
            {snapshot.durationSeconds > 0 ? <Timeline position={snapshot.positionSeconds} duration={snapshot.durationSeconds} onSeek={s => controller.seek(s)} /> : null}
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md}}>
              <Button variant="ghost" round icon="back10" iconNumber={skipBack} accessibilityLabel={i18n.t('player.skipBackSeconds', {seconds: skipBack})} onPress={() => controller.seek(snapshot.positionSeconds - skipBack)} />
              <Button variant="secondary" round icon={snapshot.paused ? 'play' : 'pause'} accessibilityLabel={snapshot.paused ? i18n.t('action.play') : i18n.t('action.pause')} onPress={() => controller.toggle()} />
              <Button variant="ghost" round icon="forward10" iconNumber={skipForward} accessibilityLabel={i18n.t('player.skipForwardSeconds', {seconds: skipForward})} onPress={() => controller.seek(snapshot.positionSeconds + skipForward)} />
            </View>
            {snapshot.textTracks.length ? (
              <View style={{gap: space.xs}}>
                <Text variant="label" tone="tertiary">{i18n.t('web.cast.subtitles')}</Text>
                <ListRow title={i18n.t('web.cast.subtitlesOff')} onPress={() => controller.setSubtitleTrack(null)} />
                {snapshot.textTracks.map(t => (
                  <ListRow key={t.id} title={t.name || t.language || i18n.t('web.cast.track')} subtitle={t.language || undefined} onPress={() => controller.setSubtitleTrack(t.id)} />
                ))}
              </View>
            ) : null}
            {snapshot.audioTracks.length > 1 ? (
              <View style={{gap: space.xs}}>
                <Text variant="label" tone="tertiary">{i18n.t('web.cast.audio')}</Text>
                {snapshot.audioTracks.map(t => (
                  <ListRow key={t.id} title={t.name || t.language || i18n.t('web.cast.track')} subtitle={t.language || undefined} onPress={() => controller.setAudioTrack(t.id)} />
                ))}
              </View>
            ) : null}
            <Button variant="secondary" icon="stop" label={i18n.t('action.stop')} onPress={() => { setExpanded(false); controller.stop(); }} />
          </View>
        </Sheet>
      ) : null}
      <Sheet open={!!snapshot.takeover} onClose={() => controller.answerTakeover(false)} title={i18n.t('cast.takeover.title')} kind="form"
        cancelLabel={null} leading={{label: i18n.t('cast.takeover.deny'), onPress: () => controller.answerTakeover(false)}} primary={{label: i18n.t('action.accept'), onPress: () => controller.answerTakeover(true)}}>
        <Text variant="body" tone="secondary" style={{paddingHorizontal: space.sm}}>{i18n.t('cast.takeover.body', {requester: snapshot.takeover?.requester ?? i18n.t('cast.someone')})}</Text>
      </Sheet>
    </View>
  );
}
