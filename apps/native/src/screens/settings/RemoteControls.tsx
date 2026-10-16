import React, {useMemo, useState} from 'react';
import {playbackControlsService, type RemotePlaybackControls} from '../../../../../packages/client-core/src/playback-controls';
import {SessionsClient} from '../../../../../packages/client-core/src/playback-v1/sessions';
import {localV1Http} from '../../../../../packages/client-core/src/playback-v1/local-http';
import {idempotencyKey} from '../../../../../packages/client-core/src/playback-v1/http';
import {REMOTE_SKIP_MS, seekTarget, transportOffers, type TransportCommand} from '../../../../../packages/client-core/src/server-admin/now-playing';
import {isStaleAnswer} from '../../../../../packages/client-core/src/freshness-actions';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {operationId, useAction, useRead} from '../../app/server-console';
import {ListRow, Menu, Notice, RowGroup, isTV, type MenuItem} from '../../ui';

const commandIcons: Record<TransportCommand, MenuItem['icon']> = {pause: 'pause', resume: 'play', back: 'back', forward: 'forward', startOver: 'restart'};
const stateWords = {playing: 'remote.state.playing', paused: 'remote.state.paused', starting: 'remote.state.starting'} as const;

/**
 * Settings › This device › Playing on your other devices: what this profile is playing elsewhere
 * (a TV it was sent to with Play on or Cast, a browser, another phone), as on the web. A row's
 * menu pauses, resumes, moves back or forward, starts over or stops it; the server says which of
 * those each one allows, and a title this profile may not see is not named. Nothing is shown
 * while nothing is playing elsewhere.
 */
export function RemoteControlsPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const controls = useMemo(() => playbackControlsService(<T,>(path: string, method?: string, body?: unknown) => api.request<T>(path, method, body)), [api]);
  const sessions = useMemo(() => new SessionsClient(localV1Http(api)), [api]);
  const read = useRead(() => controls.remote(), [controls], {every: 10000});
  const action = useAction();
  const [menu, setMenu] = useState<RemotePlaybackControls>();
  const items = read.data?.items ?? [];
  if (!items.length) return null;
  const send = (x: RemotePlaybackControls, what: TransportCommand | 'stop') => void action.run(async () => {
    if (what === 'stop') { await sessions.stop(x.sessionId); return; }
    const change = (from: {revision: string; positionMs: number}) => sessions.patch(x.sessionId, from.revision, what === 'pause' || what === 'resume' ? {state: what === 'pause' ? 'paused' : 'playing'} : {seek: {positionMs: seekTarget(what, from.positionMs) ?? 0, id: idempotencyKey(operationId)}});
    try { await change(x); }
    catch (e) {
      // The session moved since this list was read (its player reported, or changed something): send it again from where it is now.
      const current = (e as {current?: {revision?: unknown; positionMs?: unknown}} | null)?.current;
      if (!isStaleAnswer(e) || typeof current?.revision !== 'string') throw e;
      await change({revision: current.revision, positionMs: typeof current.positionMs === 'number' ? current.positionMs : x.positionMs});
    }
  }).then(() => read.reload());
  const seconds = REMOTE_SKIP_MS / 1000;
  const words: Record<TransportCommand, string> = {pause: t('action.pause'), resume: t('entry.resume'), back: t('player.skipBackSeconds', {seconds}), forward: t('player.skipForwardSeconds', {seconds}), startOver: t('action.startOver')};
  const menuItems = (x: RemotePlaybackControls): MenuItem[] => [
    ...transportOffers(x, x.actions).map(command => ({id: command, label: words[command], icon: commandIcons[command], disabled: action.busy})),
    ...(x.actions.includes('stop') ? [{id: 'stop', label: t('action.stop'), icon: 'stop', destructive: true, disabled: action.busy} as MenuItem] : []),
  ];
  const device = (x: RemotePlaybackControls) => x.device.name || t('remote.device');
  return (
    <>
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      <RowGroup title={t('remote.title')} footer={t('remote.lede')}>
        {items.map(x => (
          <ListRow key={x.sessionId} icon="tvDevice" title={device(x)} subtitle={x.item?.title ?? t('remote.hiddenTitle')}
            meta={t(stateWords[x.state === 'playing' || x.state === 'paused' ? x.state : 'starting'])}
            accessory={menuItems(x).length ? 'menu' : undefined} onPress={menuItems(x).length ? () => { action.clear(); setMenu(x); } : undefined} readable={isTV && !menuItems(x).length} />
        ))}
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu ? device(menu) : undefined}
        items={menu ? menuItems(menu) : []}
        onSelect={id => { const x = menu; setMenu(undefined); if (x) send(x, id as TransportCommand | 'stop'); }} />
    </>
  );
}
