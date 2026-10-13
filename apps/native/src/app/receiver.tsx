import React, {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {AppState, View} from 'react-native';
import {ReceiverHost, type ReceiverSnapshot} from '../../../../packages/client-core/src/index';
import {nativeRouteCrypto} from '../bridge/server-connections';
import {profileInstallation} from '../bridge/profile-trust';
import type {PlayerEngine} from '../player/usePlayer';
import {Button, Sheet, Text, useTheme} from '../ui';
import {useDeviceEvents} from './device-events';
import {useSession} from './session';
import {useI18n} from './i18n';
import {advertisePlayer, stopPlayerAdvertisement} from '../bridge/server-connections';
import {deviceIdentity} from '../bridge/setup-codes';
import {deviceModelName, devicePlatform} from '../bridge/device-platform';

const base64url = (bytes: Uint8Array) => { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return globalThis.btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };

/**
 * Receiver mode: while Portico is open on a television, the same profile's phone can send it
 * something to play. The television registers itself, asks its own viewer before it accepts a
 * phone it has not met, and tells the server it has taken over only once it is really playing.
 */
export function ReceiverMode({engine, enabled}: {engine: PlayerEngine; enabled: boolean}) {
  const i18n = useI18n();
  const {api, session, system} = useSession();
  const {space, isTV} = useTheme();
  const live = useRef(engine);
  live.current = engine;
  const [device, setDevice] = React.useState<{deviceId: string; keyFingerprint: string}>();
  // APL-AUTH-06: the TV introduces itself by its own name ("Living Room").
  const [deviceName, setDeviceName] = React.useState(deviceModelName);
  React.useEffect(() => { void deviceIdentity().then(d => setDeviceName(d.deviceName)); }, []);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      const id = await profileInstallation();
      if (!id || !mounted) return;
      // The fingerprint fences a re-installed television from the grants given to the old one.
      const digest = await nativeRouteCrypto.sha256(Uint8Array.from('portico-receiver:' + id, c => c.charCodeAt(0) & 0xff));
      if (mounted) setDevice({deviceId: id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120) || 'tv', keyFingerprint: base64url(digest)});
    })().catch(() => {});
    return () => { mounted = false; };
  }, []);
  const viewerKey = session ? `${session.viewer.serverId}/${session.viewer.accountId}/${session.viewer.profileId}` : '';
  const events = useDeviceEvents();
  const host = useMemo(() => (isTV && enabled && api && viewerKey && device ? new ReceiverHost({
    api,
    device: {...device, displayName: deviceName, platform: devicePlatform},
    player: {
      // The handoff names only the item; the player reads its title as it starts.
      load: (itemId, positionSeconds) => live.current.play(itemId, positionSeconds),
      state: () => { const s = live.current.state; return {itemId: s.itemId ?? '', playbackId: s.session?.id ?? '', playing: s.phase === 'ready' && s.intent === 'playing' && !s.recovering && s.positionSeconds > 0, positionSeconds: s.positionSeconds}; },
    },
    // The idle inbox poll backs off while the device's event feed is connected: a grant or a
    // handoff arrives on it as a hint instead of waiting for the next poll. The receiver opens
    // no stream of its own.
    ...(events ? {events} : {}),
    // A new server (same viewer ids) registers a new receiver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }) : null), [api, viewerKey, device, isTV, enabled, system?.id, deviceName, events]);
  useEffect(() => {
    if (!host) return;
    // Only while the app is in front: a television that is not showing Portico cannot play anything.
    // `start` polls once immediately, then resumes the interval.
    const follow = () => (AppState.currentState === 'active' ? host.start() : host.stop());
    follow();
    const listener = AppState.addEventListener('change', follow);
    return () => { listener.remove(); host.dispose(); };
  }, [host]);
  // The host is told when the player is in front: it slows its heartbeat then, and keeps its inbox
  // live, so something new can still be sent here while a title plays.
  const playerActive = engine.active;
  useEffect(() => {
    host?.setPlayerActive(playerActive);
  }, [host, playerActive]);
  const state = useSyncExternalStore(host?.subscribe ?? noSubscribe, host?.getSnapshot ?? off);
  // Play on (local network only): while this TV is registered and receiving, it says so on the
  // network with its receiver and server ids; controllers still go through the server's handoff.
  const receiverId = state.receiver?.id;
  const serverId = session?.viewer.serverId;
  useEffect(() => {
    if (!receiverId || !serverId) return;
    let live = true;
    void deviceIdentity().then(({deviceName}) => { if (live) advertisePlayer({receiverId, serverId, name: deviceName, kind: 'tv'}); });
    return () => { live = false; stopPlayerAdvertisement(); };
  }, [receiverId, serverId]);
  const asking = state.asking;
  return (
    <Sheet open={!!asking && !!host} onClose={() => { if (asking) void host?.decide(asking, 'decline'); }} title={i18n.t('playOn.receiver.askTitle', {device: asking?.controllerDisplayName ?? ''})}
      footer={<View style={{flexDirection: 'row', gap: space.sm}}><Button variant="ghost" label={i18n.t('playOn.receiver.decline')} onPress={() => { if (asking) void host?.decide(asking, 'decline'); }} /><Button variant="primary" label={i18n.t('playOn.receiver.allow')} hasTVPreferredFocus onPress={() => { if (asking) void host?.decide(asking, 'accept'); }} /></View>}>
      <Text variant="body" tone="secondary">{i18n.t('playOn.receiver.askBody', {device: asking?.controllerDisplayName ?? ''})}</Text>
    </Sheet>
  );
}
const offSnapshot: ReceiverSnapshot = Object.freeze({phase: 'off'});
const off = () => offSnapshot;
const noSubscribe = () => () => {};
