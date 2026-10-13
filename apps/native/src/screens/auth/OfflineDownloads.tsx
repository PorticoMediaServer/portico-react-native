import React from 'react';
import {View} from 'react-native';
import {Button, Notice, Page, PageHeader, useTheme} from '../../ui';
import {DeviceDownloads} from '../Downloads';
import {useI18n} from '../../app/i18n';
import {PlayerHost} from '../../player/PlayerHost';

/**
 * APP-03: what this device already holds, reachable before a server is.
 *
 * The shell's downloads route only exists once a session is ready, so a cold
 * launch with no connection used to leave finished downloads unreachable behind
 * the sign-in screen. This is the same `DeviceDownloads` list the shell shows,
 * mounted from the launch flow instead.
 *
 * It grants nothing. The list is already scoped to the saved viewer, and every
 * play still goes through `playable`, which requires a receipt this server
 * signed for that exact viewer and has not expired. A title whose receipt has
 * run out says so and stays unplayable until the server can be reached.
 *
 * A download plays here in Portico's own player, the one the shell uses (`PlayerHost`): the same
 * choice between the device's player and mpv, the subtitle files, chapters and skip markers that
 * came with the download, and the same resume point. Nothing in it asks a server for anything.
 */
export function OfflineDownloadsScreen({onBack}: {onBack: () => void}) {
  const i18n = useI18n();
  const {space} = useTheme();
  return (
    <PlayerHost signedOut onOpen={nothing} onTogether={nothing}>
      <Page>
        <PageHeader title={i18n.t('feature.downloads')} eyebrow={i18n.t('auth.offlineDownloadsTitle')} onBack={onBack} backLabel={i18n.t('action.signIn')} />
        <View style={{paddingHorizontal: space.page, gap: space.lg}}>
          <Notice tone="info" message={i18n.t('auth.offlineDownloadsLede')} />
          <DeviceDownloads />
          <Button variant="ghost" label={i18n.t('action.signIn')} onPress={onBack} />
        </View>
      </Page>
    </PlayerHost>
  );
}

const nothing = () => {};
