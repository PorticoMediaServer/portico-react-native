import React, {createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore} from 'react';
import {AppState, Platform, View} from 'react-native';
import {DownloadsService, downloadBytes, downloadReasonMessage, type DownloadOptionsView, type DownloadQualityChoice, type DownloadTarget, type DownloadsSnapshot, type DownloadRequestKind, type DownloadEpisodes} from '../../../../packages/client-core/src/index';
import {offlineDownloads, type OfflineDisplay, type OfflineSnapshot} from '../bridge/offline-downloads';
import {Button, Divider, ListRow, Notice, Sheet, StateView, Surface, Text, useTheme} from '../ui';
import {useSession} from './session';
import {viewerKey} from './viewer-scope';
import {useI18n} from './i18n';
import {say} from './errors';
import {mpvAvailable} from '../bridge/player-engines';
import {originalMayNotPlay} from './original-opens';
import {usePreferences} from './preferences';

export type ContainerDownloadTarget = {containerId: string; containerKind: DownloadRequestKind};
export type DownloadRequest = {target: DownloadTarget & Partial<ContainerDownloadTarget>; title: string; optionsFor?: string; display?: OfflineDisplay};
type Value = {service: DownloadsService | null; ask: (request: DownloadRequest) => void};
const Ctx = createContext<Value>({service: null, ask: () => {}});

/** One downloads service per signed-in session, bound to what is kept on this device, and one
 * "what quality?" sheet for the whole app. */
export function DownloadsProvider({children, onViewDownloads}: {children: React.ReactNode; onViewDownloads: () => void}) {
  const {api, session} = useSession();
  // One per viewer, not per access token: a renewed sign-in must not tear down the service that
  // is following the server's list and bringing finished downloads to the device.
  const key = viewerKey(session, api);
  const service = useMemo(() => (key && api && offlineDownloads.getSnapshot().supported ? new DownloadsService(api) : null), [api, key]);
  const authority = session?.viewer.authority, accountId = session?.viewer.accountId ?? '', profileId = session?.viewer.profileId, serverId = session?.viewer.serverId;
  useEffect(() => {
    if (!service || !api || !authority || !profileId || !serverId) return;
    offlineDownloads.connect(api, service, {authority, accountId, profileId, serverId});
    // Follow the server's list only while the app is in front: that is when a finished
    // preparation can be brought to the device, and nothing is asked of the server otherwise.
    // Coming to the front is also when a download that stopped by itself is looked at again.
    const follow = () => { if (AppState.currentState === 'active') { service.start(); offlineDownloads.wake(); } else service.stop(); };
    follow();
    const listener = AppState.addEventListener('change', follow);
    return () => { listener.remove(); offlineDownloads.disconnect(); service.dispose(); };
  }, [service, api, authority, accountId, profileId, serverId]);
  // A whole show or season asked for from this device is found again on the server after the
  // app was closed, so the rest of it still arrives.
  const deviceId = (session as {deviceId?: string} | undefined)?.deviceId;
  useEffect(() => { if (deviceId) service?.followDevice(deviceId); }, [service, deviceId]);
  const [request, setRequest] = useState<DownloadRequest | null>(null);
  const ask = useCallback((r: DownloadRequest) => setRequest(r), []);
  const value = useMemo(() => ({service, ask}), [service, ask]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {service ? <DownloadSheet request={request} service={service} onClose={() => setRequest(null)} onView={() => { setRequest(null); onViewDownloads(); }} /> : null}
    </Ctx.Provider>
  );
}

const idle: DownloadsSnapshot = Object.freeze<DownloadsSnapshot>({phase: 'idle', items: [], busy: [], nextCursor: '', loadingMore: false, requests: []});
const noSubscribe = () => () => {};
export function useDownloads() {
  const {service, ask} = useContext(Ctx);
  const state = useSyncExternalStore(service?.subscribe ?? noSubscribe, service?.getSnapshot ?? (() => idle));
  return {service, state, ask};
}
export const useDownloadRequest = () => useContext(Ctx).ask;
export const useOffline = (): OfflineSnapshot => useSyncExternalStore(offlineDownloads.subscribe, offlineDownloads.getSnapshot);

function DownloadSheet({request, service, onClose, onView}: {request: DownloadRequest | null; service: DownloadsService; onClose: () => void; onView: () => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const {session} = useSession();
  const [view, setView] = useState<DownloadOptionsView>();
  // A download plays from this device with nothing to convert it: an original this device cannot open says so.
  const {preferences} = usePreferences();
  const cannotOpen = !!view && originalMayNotPlay(view.source.container, {platform: Platform.OS === 'ios' ? 'apple' : 'android', mpv: mpvAvailable, player: preferences.playerEngine});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState('');
  // Portico G: whole-container downloads (show, season, album, book, playlist)
  // go through POST /v1/downloads/requests with a policy, not the
  // per-preparation endpoint (which now refuses containers over 100).
  const container = request?.target.containerId && request.target.containerKind
    ? {kind: request.target.containerKind, id: request.target.containerId}
    : undefined;
  const [policy, setPolicy] = useState<DownloadEpisodes>('all');
  const [keepNext, setKeepNext] = useState(1);
  const itemId = request?.optionsFor ?? request?.target.mediaId;
  // With no single title to read a menu for (a whole season), the server says which qualities it
  // can hand over at all. Nothing is assumed here.
  const [choices, setChoices] = useState<readonly DownloadQualityChoice[]>();
  useEffect(() => {
    setView(undefined); setChoices(undefined); setError(''); setBusy(''); setDone('');
    setPolicy('all'); setKeepNext(1);
    if (!request) return;
    const controller = new AbortController();
    const failed = (e: unknown) => { if (!controller.signal.aborted) setError(say(e, 'downloads', 'action')); };
    if (itemId) service.options(itemId, controller.signal).then(setView, failed);
    else service.qualities(controller.signal).then(setChoices, failed);
    return () => controller.abort();
  }, [service, request, itemId]);
  const choose = async (quality: string) => {
    if (!request) return;
    setBusy(quality); setError('');
    try {
      if (container) {
        const deviceId = (session as {deviceId?: string} | undefined)?.deviceId;
        if (!deviceId) { setError(i18n.t('downloads.noDevice')); return; }
        const followed = await service.requestContainer({target: {...container, title: request.title}, deviceId, quality, policy: policy === 'next' ? {episodes: policy, keepNext} : {episodes: policy}});
        setDone(followed.totalKnown ? i18n.t('downloads.addedMany', {count: followed.total}) : i18n.t('downloads.requestPreparing'));
        return;
      }
      const batch = await service.request(request.target, quality);
      // What was asked for from this device comes to this device, under the title and artwork
      // the server sends with it.
      await offlineDownloads.want(batch.items.map(p => p.itemId), request.display, service);
      // Nothing new accepted and nothing refused means it was already there.
      setDone(batch.rejected.length
        ? (batch.accepted ? i18n.t('downloads.addedMixed', {accepted: batch.accepted, rejected: batch.rejected.length, reason: downloadReasonMessage(batch.rejected[0].code)}) : downloadReasonMessage(batch.rejected[0].code) || i18n.t('downloads.nothingAdded'))
        : !batch.accepted || batch.duplicate ? (batch.items.length ? i18n.t('downloads.already') : i18n.t('downloads.nothingAdded')) : i18n.t('downloads.willArrive'));
    } catch (e) { setError(say(e, 'downloads', 'action')); } finally { setBusy(''); }
  };
  if (done) {
    return (
      <Sheet open onClose={onClose} title={i18n.t('downloads.title')} footer={<View style={{flexDirection: 'row', gap: space.sm}}><Button variant="ghost" label={i18n.t('action.close')} onPress={onClose} /><Button variant="primary" label={i18n.t('downloads.view')} onPress={onView} /></View>}>
        <Text variant="body" tone="secondary">{done}</Text>
      </Sheet>
    );
  }
  const blocked = view && !view.policy.allowDownloads;
  return (
    <Sheet open={request !== null} onClose={onClose} title={i18n.t('action.download')} subtitle={request?.title}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        {request && (itemId ? !view : !choices) && !error ? <StateView loading title={i18n.t('downloads.checking')} /> : null}
        {blocked ? <Notice tone="info" message={downloadReasonMessage(view.policy.reason) || i18n.t('downloads.offForProfile')} /> : null}
        {container && !(session as {deviceId?: string} | undefined)?.deviceId ? <Notice tone="info" message={i18n.t('downloads.noDevice')} /> : null}
        {container ? (
          <Surface padded={false}>
            {(['all', 'unwatched', 'next'] as const).map((p, i) => (
              <View key={p}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow title={i18n.t(p === 'all' ? 'downloads.policyAll' : p === 'unwatched' ? 'downloads.policyUnwatched' : 'downloads.policyNext')} trailingIcon={policy === p ? 'check' : undefined} onPress={() => setPolicy(p)} />
              </View>
            ))}
          </Surface>
        ) : null}
        {container && policy === 'next' ? (
          <Surface padded={false}>
            {[1, 3, 5].map((n, i) => (
              <View key={n}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow title={i18n.t('downloads.keepNext', {count: n})} trailingIcon={keepNext === n ? 'check' : undefined} onPress={() => setKeepNext(n)} />
              </View>
            ))}
          </Surface>
        ) : null}
        {view && !blocked ? (
          <Surface padded={false}>
            {view.options.map((o, i) => (
              <View key={o.quality}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow title={o.label} subtitle={o.available ? `${o.estimated ? i18n.t('downloads.aboutSize', {size: downloadBytes(o.estimatedBytes)}) : downloadBytes(o.estimatedBytes)}${o.requiresPreparation ? ` · ${i18n.t('downloads.serverPrepares')}` : ''}${o.kind === 'source' && cannotOpen ? `\n${i18n.t('downloads.quality.originalMayNotPlay')}` : ''}` : downloadReasonMessage(o.reason)} subtitleLines={o.kind === 'source' && cannotOpen ? 4 : undefined} meta={busy === o.quality ? i18n.t('downloads.adding') : undefined} disabled={!o.available || !!busy} onPress={() => void choose(o.quality)} />
              </View>
            ))}
          </Surface>
        ) : null}
        {request && !itemId && choices ? (
          <Surface padded={false}>
            {choices.map((o, i) => (
              <View key={o.quality}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow title={o.kind === 'source' ? i18n.t('downloads.quality.original') : o.label} subtitle={i18n.t(o.kind === 'source' ? 'downloads.quality.originalHelp' : 'downloads.quality.smaller')} meta={busy === o.quality ? i18n.t('downloads.adding') : undefined} disabled={!!busy} onPress={() => void choose(o.quality)} />
              </View>
            ))}
          </Surface>
        ) : null}
        {view?.storage.remainingBytes != null ? <Text variant="caption" tone="tertiary">{i18n.t('downloads.spaceLeft', {size: downloadBytes(view.storage.remainingBytes)})}</Text> : null}
      </View>
    </Sheet>
  );
}
