import React from 'react';
import {View} from 'react-native';
import {useI18n} from '../app/i18n';
import {usePlayOn} from '../app/play-on';
import {Button, Ring, Text, alpha, useTheme} from '../ui';

/**
 * While a title this device sent with Play on is playing on another device: one compact bar above
 * the tab bar, the same shape as the Cast bar, with what is playing and where, Play or Pause,
 * Start over and Stop. The other device's own remote keeps working; what it does shows here a
 * few seconds later. Television never sends, so it never shows this.
 */
export function PlayOnBar() {
  const {controller, remote} = usePlayOn();
  const i18n = useI18n();
  const {space, colors, metrics, isTV} = useTheme();
  if (isTV || !controller || !remote) return null;
  const where = i18n.t('playOn.playingOn', {device: remote.device || i18n.t('cast.theTV')});
  const title = remote.title ?? where;
  const line = remote.message ?? (remote.title ? where : remote.paused ? i18n.t('web.downloads.state.paused') : '');
  return (
    <View style={{paddingHorizontal: space.sm, paddingBottom: space.xs}}>
      <View accessibilityRole="summary" accessibilityLabel={[title, line].filter(Boolean).join(', ')} style={{flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm, borderRadius: metrics.radius.control, backgroundColor: alpha(colors.material, 0.96), borderWidth: 1, borderColor: alpha(colors.lineStrong, 0.5)}}>
        {remote.busy ? <Ring size={20} thickness={2} /> : null}
        <View style={{flex: 1, minWidth: 0}}>
          <Text variant="captionStrong" lines={1}>{title}</Text>
          {line ? <Text variant="micro" tone={remote.message ? 'danger' : 'tertiary'} lines={1}>{line}</Text> : null}
        </View>
        <Button variant="ghost" round icon="restart" accessibilityLabel={i18n.t('action.startOver')} disabled={remote.busy} onPress={() => void controller.seek(0)} />
        <Button variant="ghost" round icon={remote.paused ? 'play' : 'pause'} accessibilityLabel={remote.paused ? i18n.t('action.play') : i18n.t('action.pause')} disabled={remote.busy} onPress={() => void (remote.paused ? controller.play() : controller.pause())} />
        <Button variant="ghost" round icon="stop" accessibilityLabel={i18n.t('action.stop')} disabled={remote.busy} onPress={() => void controller.stop()} />
      </View>
    </View>
  );
}
