import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {PlayerActionsContext, PlayerVisibilityContext, PlayingItemContext, type EntryOrigin, type PlayerActions} from '../app/player-actions';
import {useTheme} from '../ui';
import {ConfirmSheet} from '../ui';
import {useI18n} from '../app/i18n';
import {EntryMenu} from './EntryMenu';
import {TogetherProvider} from '../app/together';
import {ReceiverMode} from '../app/receiver';
import {usePreferences} from '../app/preferences';
import {MiniBar, NowPlayingPill} from './MiniPlayer';
import {usePlayerEngine} from './usePlayer';
import {VideoPlayer} from './VideoPlayer';
import {setListeningSkipIntervals} from '../bridge/NativeSystemMedia';
import {useServerPreferences} from '../app/server-preferences';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {ToastHost} from '../ui';
import {CastBar} from './CastBar';
import {offlineDownloads} from '../bridge/offline-downloads';

/**
 * Owns the player engine for the signed-in session and layers the player
 * presentations over the shell: full-screen when expanded, a handheld mini
 * bar or television pill when audio continues in the background.
 */
export function PlayerHost({children, bottom, onOpen, onTogether, intents}: {children: React.ReactNode; bottom?: React.ReactNode; onOpen: (entry: ContentEntry) => void; onTogether: () => void; intents?: React.MutableRefObject<PlayerActions | null>}) {
  const engine = usePlayerEngine();
  const {isTV} = useTheme();
  const i18n = useI18n();
  const [more, setMore] = useState<{entry: ContentEntry; origin?: EntryOrigin} | null>(null);
  const [bars, setBars] = useState(0);
  const insets = useSafeAreaInsets();
  const {preferences} = usePreferences();
  // OS-06: music and audiobooks use the profile's skip amounts on the lock screen and Control Center.
  const serverPrefs = useServerPreferences();
  const skipBack = serverPrefs.value<number>('playback.skipBackSeconds', 10);
  const skipForward = serverPrefs.value<number>('playback.skipForwardSeconds', 30);
  useEffect(() => setListeningSkipIntervals(skipBack, skipForward), [skipBack, skipForward]);
  const playOffline = engine.playOffline;
  const actions = useMemo<PlayerActions>(
    () => ({
      play: engine.play,
      playSequence: engine.playSequence,
      tune: engine.tune,
      more: (entry, origin) => setMore({entry, origin}),
      playLocal: async entry => {
        const media = await offlineDownloads.localMedia(entry);
        await playOffline(media, {title: entry.title, subtitle: entry.subtitle || undefined, artworkUrl: entry.artworkUrl || undefined, kind: entry.kind});
      },
    }),
    [engine.play, engine.playSequence, engine.tune, playOffline],
  );
  if (intents) intents.current = actions;
  const showFull = engine.active && (engine.expanded || (!engine.isAudio && !engine.pipActive));
  const showMini = engine.active && !showFull && engine.isAudio;
  // APP-06: video in Picture in Picture draws nothing here, but the player must
  // stay mounted — it owns the native PiP controller and is the only route for
  // the `stopped` and `restore` events that bring the full player back.
  const holdingPip = engine.active && engine.pipActive && !engine.isAudio;
  return (
    <TogetherProvider engine={engine}>
    <PlayerActionsContext.Provider value={actions}>
      <PlayerVisibilityContext.Provider value={showFull}>
      <PlayingItemContext.Provider value={engine.active ? engine.identity.itemId : undefined}>
      <View style={{flex: 1}}>
        {/* QA (TV): under the full player the rail and pages are hidden, not just covered, so the
            focus engine can never move onto cards the viewer can't see. They stay mounted. */}
        <View style={isTV && showFull ? hiddenUnderPlayer : fill}>{children}</View>
        <View onLayout={e => setBars(e.nativeEvent.layout.height)}>
          <CastBar />
          {showMini && !isTV ? <MiniBar engine={engine} /> : null}
          {bottom}
        </View>
        {showMini && isTV ? <NowPlayingPill engine={engine} /> : null}
        {showFull || holdingPip ? <VideoPlayer engine={engine} /> : null}
        {isTV ? <ReceiverMode engine={engine} enabled={preferences.receiveFromDevices} /> : null}
        {/* One toast host (CON-07), above the tab bar and mini player, and over the player. */}
        <ToastHost bottomOffset={showFull ? 0 : Math.max(0, bars - insets.bottom)} />
        <EntryMenu entry={more?.entry ?? null} origin={more?.origin} engine={engine} onClose={() => setMore(null)} onOpen={onOpen} onTogether={onTogether} />
        <ConfirmSheet open={!!engine.dolbyPending} onDismiss={engine.dismissDolby} title={i18n.t('player.dolbyVisionWarning')} confirmLabel={i18n.t('player.playAnyway')} tone="default" onConfirm={() => engine.confirmDolby()} />
        {/* MU4 COMPAT-01: bitmap subtitles on a 4K/HDR source confirm once per play; dismissing keeps the current track. */}
        <ConfirmSheet open={!!engine.bitmapPending} onDismiss={engine.dismissBitmap} title={i18n.t('player.subtitles.burnWarning')} confirmLabel={i18n.t('action.continue')} tone="default" onConfirm={() => engine.confirmBitmap()} />
      </View>
      </PlayingItemContext.Provider>
      </PlayerVisibilityContext.Provider>
    </PlayerActionsContext.Provider>
    </TogetherProvider>
  );
}

const fill = {flex: 1} as const;
const hiddenUnderPlayer = {flex: 1, display: 'none'} as const;
