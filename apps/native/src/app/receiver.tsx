import React, {useEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import {AppState, View} from 'react-native';
import {ReceiverHost, type ReceiverSnapshot} from '../../../../packages/client-core/src/index';
import {nativeRouteCrypto} from '../bridge/server-connections';
import {profileInstallation} from '../bridge/profile-trust';
import type {PlayerEngine} from '../player/usePlayer';
import {Button, Sheet, Text, useTheme} from '../ui';
import {openEventStream} from '../bridge/event-stream';
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
  const token = useRef('');
  token.current = session?.accessToken ?? '';
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
  const host = useMemo(() => (isTV && enabled && api && viewerKey && device ? new ReceiverHost({
    api,
    device: {...device, displayName: deviceName, platform: devicePlatform},
    player: {
      // The handoff names only the item; the player reads its title as it starts.
      load: (itemId, positionSeconds) => live.current.play(itemId, positionSeconds),
      state: () => { const s = live.current.state; return {itemId: s.itemId ?? '', playbackId: s.session?.id ?? '', playing: s.phase === 'ready' && s.intent === 'playing' && !s.recovering && s.positionSeconds > 0, positionSeconds: s.positionSeconds}; },
    },
    // PERF-16: the idle inbox poll backs off while this stream is connected; a grant or handoff
    // arrives as an event instead of waiting for the next poll. No Last-Event-ID is sent: the
    // receiver hints carry no SSE id and must not move the notification resume cursor.
    events: signal => openEventStream(api, '/v1/notifications/events', {Accept: 'text/event-stream', Authorization: 'Bearer ' + token.current}, signal),
    // A new server (same viewer ids) registers a new receiver.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }) : null), [api, viewerKey, device, isTV, enabled, system?.id, deviceName]);
  useEffect(() => {
    if (!host) return;
    // Only while the app is in front: a television that is not showing Portico cannot play anything.
    // `start` polls once immediately, then resumes the interval.
    const follow = () => (AppState.currentState === 'active' ? host.start() : host.stop());
    follow();
    const listener = AppState.addEventListener('change', follow);
    return () => { listener.remove(); host.dispose(); };
  }, [host]);
  // PERF-16: pause the receiver inbox poll while the player is in the foreground.
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
