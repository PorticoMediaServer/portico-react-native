import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {useI18n} from '../app/i18n';
import {usePlayOn} from '../app/play-on';
import {useServerPreferences} from '../app/server-preferences';
import {Timeline} from '../player/Timeline';
import {Button, Ring, Sheet, Text, alpha, useTheme} from '../ui';

/**
 * While a title this device sent with Play on is playing on another device: one compact bar above
 * the tab bar, the same shape as the Cast bar, with what is playing, where, and how far in it is,
 * Play or Pause and Stop; it opens the full controls (the timeline, skipping back and forward,
 * Start over). The position is the other device's own, read from the server; a control the server
 * does not allow this profile is not offered. The other device's own remote keeps working, and
 * what it does shows here a few seconds later. Television never sends, so it never shows this.
 */
export function PlayOnBar() {
  const {controller, remote, watchClosely} = usePlayOn();
  const i18n = useI18n();
  const prefs = useServerPreferences();
  const skipBack = prefs.value<number>('playback.skipBackMs', 10_000) / 1000;
  const skipForward = prefs.value<number>('playback.skipForwardMs', 30_000) / 1000;
  const {space, colors, metrics, isTV} = useTheme();
  const [expanded, setExpanded] = useState(false);
  const showing = !isTV && !!controller && !!remote;
  useEffect(() => { if (!showing) setExpanded(false); }, [showing]);
  // With the full controls open the other device is asked how it is doing more often.
  useEffect(() => { watchClosely(showing && expanded); return () => watchClosely(false); }, [watchClosely, showing, expanded]);
  if (isTV || !controller || !remote) return null;
  const device = remote.device || i18n.t('cast.theTV');
  const where = i18n.t('playOn.playingOn', {device});
  const title = remote.title ?? where;
  const position = remote.positionSeconds;
  const placed = position === undefined ? '' : remote.durationSeconds > 0 ? i18n.t('cast.positionOf', {device, position: i18n.clock(position), duration: i18n.clock(remote.durationSeconds)}) : i18n.t('cast.position', {device, position: i18n.clock(position)});
  const line = remote.message ?? (placed || (remote.title ? where : remote.paused ? i18n.t('web.downloads.state.paused') : ''));
  const toggles = remote.allows(remote.paused ? 'resume' : 'pause');
  const seeks = remote.allows('seek');
  const playPause = toggles ? <Button variant="ghost" round icon={remote.paused ? 'play' : 'pause'} accessibilityLabel={remote.paused ? i18n.t('action.play') : i18n.t('action.pause')} disabled={remote.busy} onPress={remote.paused ? remote.resume : remote.pause} /> : null;
  return (
    <View style={{paddingHorizontal: space.sm, paddingBottom: space.xs}}>
      <View accessibilityRole="summary" accessibilityLabel={[title, line].filter(Boolean).join(', ')} style={{flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: metrics.radius.control, backgroundColor: alpha(colors.material, 0.96), borderWidth: 1, borderColor: alpha(colors.lineStrong, 0.5)}}>
        {remote.busy ? <Ring size={20} thickness={2} /> : null}
        <View style={{flex: 1, minWidth: 0}}>
          <Text variant="captionStrong" lines={1}>{title}</Text>
          {line ? <Text variant="micro" tone={remote.message ? 'danger' : 'tertiary'} lines={1}>{line}</Text> : null}
        </View>
        <Button variant="ghost" round icon="maximize" accessibilityLabel={i18n.t('player.showControls')} onPress={() => setExpanded(true)} />
        {playPause}
        {remote.allows('stop') ? <Button variant="ghost" round icon="stop" accessibilityLabel={i18n.t('action.stop')} disabled={remote.busy} onPress={remote.stop} /> : null}
      </View>
      <Sheet open={expanded} onClose={() => setExpanded(false)} title={device} subtitle={title} kind="picker">
        <View style={{gap: space.md}}>
          {/* The timeline is the other device's own position; without one yet there is nothing true to draw. */}
          {seeks && position !== undefined && remote.durationSeconds > 0 ? <Timeline position={position} duration={remote.durationSeconds} onSeek={remote.seekTo} /> : placed ? <Text variant="caption" tone="tertiary" align="center">{placed}</Text> : null}
          <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md}}>
            {seeks ? <Button variant="ghost" round icon="back10" iconNumber={skipBack} accessibilityLabel={i18n.t('player.skipBackSeconds', {seconds: skipBack})} disabled={remote.busy || position === undefined} onPress={() => remote.skip(-skipBack)} /> : null}
            {toggles ? <Button variant="secondary" round icon={remote.paused ? 'play' : 'pause'} accessibilityLabel={remote.paused ? i18n.t('action.play') : i18n.t('action.pause')} disabled={remote.busy} onPress={remote.paused ? remote.resume : remote.pause} /> : null}
            {seeks ? <Button variant="ghost" round icon="forward10" iconNumber={skipForward} accessibilityLabel={i18n.t('player.skipForwardSeconds', {seconds: skipForward})} disabled={remote.busy || position === undefined} onPress={() => remote.skip(skipForward)} /> : null}
          </View>
          {remote.message ? <Text variant="caption" tone="danger" align="center">{remote.message}</Text> : null}
          {seeks ? <Button variant="ghost" icon="restart" label={i18n.t('action.startOver')} disabled={remote.busy} onPress={() => remote.seekTo(0)} /> : null}
          {remote.allows('stop') ? <Button variant="secondary" icon="stop" label={i18n.t('action.stop')} disabled={remote.busy} onPress={() => { setExpanded(false); remote.stop(); }} /> : null}
        </View>
      </Sheet>
    </View>
  );
}
