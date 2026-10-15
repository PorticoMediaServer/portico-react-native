import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import type {Receiver} from '../../../../packages/client-core/src/index';
import {playOnDestinations, type NearbyPlayer} from '../../../../packages/client-core/src/presentation/index';
import {noteCastMeta} from '../../../../packages/client-core/src/presentation/index';
import {useCastController} from '../app/cast';
import {useI18n} from '../app/i18n';
import {usePlayOnController} from '../app/play-on';
import {useSession} from '../app/session';
import {AudioRoutePicker} from '../bridge/NativeViews';
import {browseNearby, type NearbyAdvert} from '../bridge/server-connections';
import {hasAirPlay, playOnPlatform} from '../bridge/device-platform';
import {Button, Divider, Icon, ListRow, Notice, Sheet, StateView, Text, rowPaddingX, showToast, useSpecPlatform, useTheme} from '../ui';
import {LinkTVSheet} from '../screens/LinkTV';
import type {PlayerEngine} from './usePlayer';

/**
 * Play on (X-18, Justin's rule): the system AirPlay picker, Google Cast, and signed-in Portico
 * players found **on this network**. Nearby players come only from local discovery
 * (`_portico-player._tcp`), kept only when they belong to this server and to this profile's
 * receiver directory; sending still goes through the server's authorized handoff, and is only
 * final once the other device is really playing.
 */
export function DestinationSheet({open, onClose, engine}: {open: boolean; onClose: () => void; engine: PlayerEngine}) {
  const {api, session} = useSession();
  const i18n = useI18n();
  const {space, colors, metrics, isTV} = useTheme();
  const [linking, setLinking] = useState(false);
  // QA: rows and the heading line up with the sheet title (rows carry their own inset).
  const rowX = rowPaddingX(useSpecPlatform());
  const cast = useCastController();
  // The controller outlives this sheet and the player (`app/play-on`): once the other device has
  // taken over, the title is still paused, resumed, started over and stopped from this one.
  const {controller, state, describe} = usePlayOnController();
  // Local discovery, about 3.5 s each time the sheet opens, intersected with this profile's
  // receiver directory (which the handoff needs anyway).
  const [adverts, setAdverts] = useState<readonly NearbyAdvert[]>([]);
  const [looking, setLooking] = useState(false);
  useEffect(() => {
    if (!open || !controller) return;
    void controller.refresh();
    const abort = new AbortController();
    setLooking(true);
    browseNearby('players', abort.signal).then(rows => setAdverts(rows as NearbyAdvert[]), () => setAdverts([])).finally(() => setLooking(false));
    return () => abort.abort();
  }, [open, controller]);
  const serverId = session?.viewer.serverId;
  const receivers = useMemo(() => new Map(state.receivers.filter(r => r.kind === 'portico').map(r => [r.id, r] as const)), [state.receivers]);
  const nearby: NearbyPlayer[] = adverts.filter(a => a.serverId === serverId && receivers.has(a.receiverId)).map(a => ({id: a.receiverId, name: receivers.get(a.receiverId)?.displayName || a.name, kind: a.kind}));
  const playback = engine.state;
  const sendable = !!playback.session?.id && !playback.channel;
  const destinations = playOnDestinations(playOnPlatform, {airplay: hasAirPlay && engine.engineFeatures.airPlayVideo, googleCast: cast.snapshot.available && sendable, nearby: sendable ? nearby : []});
  const send = async (target: Receiver) => {
    const s = engine.service.getSnapshot();
    if (!s.session?.id || !controller) return;
    describe(engine.identity.title || undefined);
    if (await controller.send(target, {playbackId: s.session.id, positionSeconds: s.pendingSeek?.positionSeconds ?? s.positionSeconds})) {
      engine.leave();
      // QA: leaving the player says where playback went.
      showToast({message: i18n.t('playOn.playingOn', {device: target.displayName}), icon: 'check'});
    }
  };
  const startCast = () => {
    const s = engine.service.getSnapshot();
    const itemId = s.itemId ?? engine.identity.itemId;
    if (!itemId) return;
    onClose();
    // MU4 CAST-03: remember the display facts for the controller sheet and bar thumbnail.
    const meta = {title: engine.identity.title, subtitle: engine.identity.subtitle, seriesTitle: engine.identity.seriesTitle, kind: engine.identity.kind};
    noteCastMeta(itemId, {...meta, ...(engine.identity.posterUrl ? {artworkPath: engine.identity.posterUrl} : {})});
    // The subtitle on screen (or Off) goes with the title; the receiver draws text only, so the
    // server burns a styled or image track in for it, as from the web.
    const plan = engine.subtitles.snapshot.plan, shown = engine.subtitles.shownId;
    const subtitleTrackId = plan ? (shown ?? null) : undefined;
    cast.cast(itemId, meta, s.pendingSeek?.positionSeconds ?? s.positionSeconds, () => engine.leave(), subtitleTrackId === undefined ? undefined : {subtitleTrackId});
  };
  // A title already playing on another device (`done`) is controlled from the bar above the tab
  // bar and is not this sheet's business: closing never cancels it, and the sheet shows the list.
  const close = () => { if (state.phase !== 'done') controller?.cancel(); onClose(); };
  const busy = state.phase === 'asking' || state.phase === 'preparing' || state.phase === 'starting';
  if (busy) {
    return (
      <Sheet open={open} onClose={close} title={i18n.t('playOn.sendingTo', {device: state.target?.displayName ?? ''})} footer={<Button variant="ghost" label={i18n.t('action.cancel')} onPress={close} />}>
        <StateView loading title={state.message ?? i18n.t(state.phase === 'starting' ? 'playOn.waitingToStart' : 'playOn.gettingReady')} message={i18n.t('playOn.stillHereUntilTakeover')} />
      </Sheet>
    );
  }
  const players = destinations.rows.filter(r => r.kind === 'porticoDevice');
  return (
    <>
    <Sheet open={open} onClose={close} title={i18n.t('player.playOn')} kind="picker">
      <View style={{gap: space.md}}>
        {state.phase === 'failed' ? <Notice tone="warning" message={state.message || i18n.t('playOn.failedHelp')} /> : null}
        {destinations.rows.some(r => r.kind === 'airplay') ? (
          <View style={{minHeight: metrics.hit, flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: rowX}}>
            <Icon name="airplay" color={colors.textSecondary} />
            <View style={{flex: 1}}>
              <Text variant="bodyStrong">{i18n.t('playOn.airplay')}</Text>
              <Text variant="caption" tone="tertiary">{i18n.t('playOn.airplaySubtitle')}</Text>
            </View>
            {/* The system's own button: it is the only thing allowed to open the AirPlay picker. */}
            <AudioRoutePicker video={!engine.isAudio} style={{width: 44, height: 44}} />
          </View>
        ) : null}
        {destinations.rows.some(r => r.kind === 'googleCast') ? (
          <ListRow icon="googleCast" title={i18n.t('playOn.googleCast')} subtitle={i18n.t('playOn.chooseDevice')} trailingIcon="forward" onPress={startCast} />
        ) : null}
        {players.length ? (
          <View style={{gap: space.xs}}>
            {destinations.nearbyHeading ? <Text variant="label" tone="tertiary" style={{paddingHorizontal: rowX}}>{i18n.t(destinations.nearbyHeading)}</Text> : null}
            {players.map((row, i) => row.kind === 'porticoDevice' ? (
              <View key={row.id}>
                {i ? <Divider inset={rowX} /> : null}
                <ListRow icon={row.icon} title={row.name} trailingIcon="forward" onPress={() => { const target = receivers.get(row.id); if (target) void send(target); }} />
              </View>
            ) : null)}
          </View>
        ) : looking ? (
          <StateView loading title={i18n.t('playOn.lookingNearby')} />
        ) : !destinations.rows.some(r => r.kind !== 'airplay') ? (
          <Text variant="caption" tone="tertiary" style={{paddingHorizontal: rowX}}>{i18n.t('playOn.noneNearby')}</Text>
        ) : null}
        {/* Always here, whether or not anything was found nearby (or looking is not allowed):
            a TV that is not listed can still be signed in with the code it shows. */}
        {isTV ? null : (
          <View>
            <Divider inset={rowX} />
            <ListRow icon="tvDevice" title={i18n.t('settings.linkTV')} subtitle={i18n.t('settings.linkTVHelp')} accessory="navigation" onPress={() => { close(); setLinking(true); }} />
          </View>
        )}
      </View>
    </Sheet>
    <LinkTVSheet open={linking} onClose={() => setLinking(false)} />
    </>
  );
}
