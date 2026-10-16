import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {downloadBytes, type DownloadAction, type DownloadPreparation, type DownloadState} from '../../../../packages/client-core/src/index';
import {useDownloads, useOffline} from '../app/downloads';
import {groupOfflineEntries, offlineDownloads, offlineFailure, offlineWaiting, type OfflineEntry} from '../bridge/offline-downloads';
import {Badge, Button, Divider, ListRow, Menu, Notice, Page, PageHeader, Section, StateView, Surface, Text, showToast, useTheme, type MenuItem} from '../ui';
import {ToggleRow} from './SettingsPages';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {RootHeaderActions} from './Home';
import {usePullToRefresh} from '../app/refresh';
import {usePlayerActions} from '../app/player-actions';
import {useFreshDocument} from '../app/freshness';
import {dependsOn} from '../../../../packages/client-core/src/freshness-hub';

type I18nT = ReturnType<typeof useI18n>;
const stateLabel = (i18n: I18nT, state: DownloadState) => i18n.t('downloads.state', {state});
const actionLabel = (i18n: I18nT, action: DownloadAction) => i18n.t('downloads.action', {action});
const limits = [0, 5, 10, 25, 50, 100].map(gb => ({bytes: gb * 1073741824}));
/** This profile's downloads changed on the server (asked for on another device, finished, failed, let go), or a notice arrived. */
const DOWNLOAD_HINTS = Object.freeze([dependsOn.list('myDownloads'), dependsOn.event('notification.changed')]);

/**
 * What is kept on this device. It needs no server and no sign-in, so it is also what the app
 * offers when the server cannot be reached. Titles, their order and their artwork all come from
 * what was saved with each download: an episode sits under its show, a song under its album.
 */
export function DeviceDownloads({hideEmpty = false}: {/** IOS-DL-01: the server doesn't offer downloads, so "Hold a title…" would be wrong. */ hideEmpty?: boolean}) {
  const offline = useOffline();
  const i18n = useI18n();
  const {space} = useTheme();
  const [chosen, setChosen] = useState<OfflineEntry>();
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState('');
  // A device store that can't be read says so, rather than showing an empty list forever.
  useEffect(() => { offlineDownloads.open().catch(() => setError(i18n.t('downloads.openFailed'))); }, [i18n]);
  const attempt = (work: Promise<unknown>) => { setError(''); work.catch(e => setError(say(e, 'downloads', 'action'))); };
  // OS-07: a download plays in Portico's own player, in the shell and from the launch flow alike
  // (both mount it); there is no other offline player.
  const {playLocal} = usePlayerActions();
  const play = (entry: OfflineEntry) => (playLocal ? playLocal(entry) : Promise.reject(new Error(i18n.t('downloads.offline.notPlayableHere'))));
  const press = (entry: OfflineEntry) => {
    if (entry.state === 'ready' && !offlineDownloads.playable(entry)) attempt(play(entry));
    else setChosen(entry);
  };
  const items: MenuItem[] = chosen ? [
    ...(chosen.state === 'ready' ? [{id: 'play', label: i18n.t('action.play'), icon: 'play' as const, disabled: !!offlineDownloads.playable(chosen), detail: offlineDownloads.playable(chosen) || undefined}] : []),
    ...(chosen.state === 'downloading' ? [{id: 'pause', label: i18n.t('action.pause'), icon: 'pause' as const}] : []),
    ...(chosen.state === 'paused' || chosen.state === 'failed' ? [{id: 'resume', label: chosen.state === 'failed' ? i18n.t('action.tryAgain') : i18n.t('action.continue'), icon: 'download' as const}] : []),
    {id: 'remove', label: i18n.t('downloads.removeFromDevice'), icon: 'trash' as const, destructive: true, confirm: {title: i18n.t('confirm.removeDownload.title'), body: chosen.title ? i18n.t('confirm.removeDownload.body', {title: chosen.title}) : i18n.t('confirm.removeDownload.bodyUntitled'), action: i18n.t('action.removeShort')}},
  ] : [];
  const select = (id: string) => {
    if (!chosen) return;
    if (id === 'play') attempt(play(chosen));
    if (id === 'pause') attempt(offlineDownloads.pause(chosen));
    if (id === 'resume') attempt(offlineDownloads.resume(chosen));
    if (id === 'remove') attempt(offlineDownloads.remove(chosen));
  };
  if (!offline.supported) return <StateView icon="download" title={i18n.t('downloads.unavailableOnDevice')} />;
  return (
    <View style={{gap: space.md}}>
      {error ? <Notice tone="warning" message={error} /> : null}
      {offline.ready && !offline.entries.length && !hideEmpty ? <StateView icon="download" title={i18n.t('downloads.emptyTitle')} message={i18n.t('downloads.emptyBody')} /> : null}
      {groupOfflineEntries(offline.entries).map(group => (
        <View key={group.key} style={{gap: space.xs}}>
          {group.title ? <Text variant="label" tone="secondary">{[group.title, i18n.t('downloads.count', {count: group.entries.length})].join(' · ')}</Text> : null}
          <Surface padded={false}>
            {group.entries.map((e, i) => {
              // One line says what stands between the viewer and the title, if anything does; a
              // title that plays and has left the server says so without getting in the way.
              const why = e.state === 'ready' ? offlineDownloads.playable(e) : e.state === 'failed' ? offlineFailure(e.error) : '';
              const moving = e.state === 'downloading' || e.state === 'paused';
              const facts = [e.quality === 'original' ? i18n.t('downloads.quality.original') : e.quality, e.bytes ? downloadBytes(e.bytes) : ''].filter(Boolean).join(' · ');
              const note = e.state === 'ready' ? offlineDownloads.note(e) : '';
              return (
                <View key={e.id}>
                  {i ? <Divider inset={space.md} /> : null}
                  <ListRow
                    source={e.artworkUrl ? {uri: e.artworkUrl} : undefined}
                    icon={e.artworkUrl ? undefined : e.kind === 'song' || e.kind === 'audiobook_file' ? 'music' : 'film'}
                    title={e.title || i18n.t('downloads.title')}
                    subtitle={[group.title ? '' : e.subtitle, why || [facts, note].filter(Boolean).join('\n')].filter(Boolean).join('\n')}
                    meta={e.state === 'downloading' ? (e.waiting ? offlineWaiting(e.waiting) : i18n.t('downloads.percent', {percent: e.bytes ? Math.floor((e.bytesDone / e.bytes) * 100) : 0})) : e.state === 'paused' ? i18n.t('downloads.paused') : e.state === 'failed' ? i18n.t('downloads.stopped') : undefined}
                    progress={moving && e.bytes ? e.bytesDone / e.bytes : 0}
                    trailingIcon={e.state === 'ready' && !why ? 'play' : 'more'}
                    onPress={() => press(e)}
                    onLongPress={() => setChosen(e)}
                  />
                </View>
              );
            })}
          </Surface>
        </View>
      ))}
      {offline.entries.length ? <Text variant="caption" tone="tertiary">{[i18n.t('downloads.used', {size: downloadBytes(offline.usedBytes)}), offline.freeBytes ? i18n.t('downloads.freeOnDevice', {size: downloadBytes(offline.freeBytes)}) : '', offline.pendingProgress ? i18n.t('downloads.progressPending') : ''].filter(Boolean).join(' · ')}</Text> : null}
      {offline.otherBytes > 0 ? <Notice tone="info" message={i18n.t('downloads.othersOnDevice', {size: downloadBytes(offline.otherBytes)})} action={i18n.t('downloads.removeOthers')} onAction={() => setClearing(true)} /> : null}
      <Menu open={clearing} onClose={() => setClearing(false)} title={i18n.t('confirm.removeOthers.title')} subtitle={i18n.t('confirm.removeOthers.body')} items={[{id: 'remove', label: i18n.t('downloads.removeOthers'), icon: 'trash', destructive: true}]} onSelect={() => attempt(offlineDownloads.removeOthers())} />
      <Menu open={!!chosen} onClose={() => setChosen(undefined)} title={chosen?.title} subtitle={chosen?.subtitle || undefined} items={items} onSelect={select} />
    </View>
  );
}

/** Downloads: what is on this device, what the server is still preparing, and the rules. */
export function DownloadsScreen() {
  const navigation = useNavigation();
  const {service, state} = useDownloads();
  const offline = useOffline();
  const {space} = useTheme();
  const [chosen, setChosen] = useState<DownloadPreparation>();
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const i18n = useI18n();
  useEffect(() => { void service?.refresh(); }, [service]);
  // APL-SYS-07: pull to refresh what the server is preparing (the device's own files need none).
  const pull = usePullToRefresh(() => service?.refresh(), {auto: true});
  // What the server is preparing is read again, quietly, when it says this profile's downloads changed.
  useFreshDocument(DOWNLOAD_HINTS, async () => { await service?.revalidate(); }, () => state.phase === 'ready' && !state.unavailable);
  // Anything already on (or coming to) the device is shown there, not twice.
  const pending = state.items.filter(p => !offline.entries.some(e => e.id === p.id));
  const saveSetting = (change: Parameters<typeof offlineDownloads.setSettings>[0]) => { offlineDownloads.setSettings(change).catch(() => showToast({message: i18n.t('downloads.settingFailed'), icon: 'warning'})); };
  const fetch = (p: DownloadPreparation) => { setError(''); offlineDownloads.fetch(p).catch(e => setError(say(e, 'downloads', 'action'))); };
  const items: MenuItem[] = chosen ? [
    ...(chosen.state === 'ready' ? [{id: 'fetch', label: i18n.t('downloads.downloadToDevice'), icon: 'download' as const, disabled: !!offlineDownloads.blocked(chosen), detail: offlineDownloads.blocked(chosen) || undefined}] : []),
    ...chosen.actions.map(a => ({id: a, label: actionLabel(i18n, a), icon: (a === 'remove' || a === 'cancel' ? 'trash' : a === 'pause' ? 'pause' : 'refresh') as MenuItem['icon'], destructive: a === 'remove' || a === 'cancel', ...(a === 'remove' || a === 'cancel' ? {confirm: a === 'cancel' ? {title: i18n.t('confirm.stopPreparing.title'), body: i18n.t('confirm.stopPreparing.body'), action: i18n.t('action.stop')} : {title: i18n.t('confirm.removePrepared.title'), body: i18n.t('confirm.removePrepared.body'), action: i18n.t('action.removeShort')}} : {})})),
  ] : [];
  return (
    <View style={{flex: 1}}>
      <Page refreshControl={pull}>
         <PageHeader title={i18n.t('downloads.title')} eyebrow={i18n.t('downloads.eyebrow')} onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} actions={navigation.canGoBack() ? undefined : <RootHeaderActions />} />
        <View style={{paddingHorizontal: space.page, gap: space.lg}}>
          {error ? <Notice tone="warning" message={error} /> : null}
          {offline.error ? <Notice tone="warning" message={offline.error} /> : null}
          {/* IOS-DL-01: one honest state when the server doesn't offer downloads; what's already here stays. */}
          {state.unavailable ? <Notice tone="info" message={i18n.t('downloads.notOffered')} /> : null}
          <DeviceDownloads hideEmpty={!!state.unavailable} />
        </View>
        {offline.supported && (pending.length || state.requests.length || state.error) ? (
          <Section title={i18n.t('downloads.onServer')}>
            <View style={{gap: space.md}}>
              {/* The service keeps only the transport's text; the viewer gets catalogue copy (never raw server text). */}
              {state.error ? <Notice tone="warning" message={i18n.t('downloads.serverListFailed')} action={i18n.t('action.tryAgain')} onAction={() => void service?.refresh()} /> : null}
              {state.requests.length ? (
                <Surface padded={false}>
                  {state.requests.map((tracked, i) => {
                    const r = tracked.request;
                    const label = r.totalKnown ? i18n.t('downloads.requestProgress', {ready: r.ready, total: r.total}) : i18n.t('downloads.requestPreparing');
                    return (
                      <View key={r.requestId}>
                        {i ? <Divider inset={space.md} /> : null}
                        <ListRow
                          icon="download"
                          title={tracked.title || i18n.t('downloads.requestsTitle')}
                          subtitle={[label, r.failed ? i18n.t('downloads.requestFailed', {failed: r.failed}) : ''].filter(Boolean).join('\n')}
                          trailing={<Badge label={label} tone={r.state === 'complete' ? 'accent' : r.state === 'failed' ? 'amber' : 'neutral'} />}
                          progress={r.totalKnown && r.total ? r.ready / r.total : 0}
                        />
                      </View>
                    );
                  })}
                </Surface>
              ) : null}
              {pending.length ? (
                <Surface padded={false}>
                  {pending.map((p, i) => {
                    const reason = service?.reason(p) || (p.state === 'ready' ? offlineDownloads.blocked(p) : '');
                    return (
                      <View key={p.id}>
                        {i ? <Divider inset={space.md} /> : null}
                        <ListRow
                          icon="download"
                          title={offlineDownloads.display(p).title || i18n.t('downloads.title')}
                          subtitle={[offlineDownloads.display(p).subtitle, [p.quality === 'original' ? i18n.t('downloads.quality.original') : p.quality, p.artifact.bytes ? (p.artifact.estimated ? i18n.t('downloads.aboutSize', {size: downloadBytes(p.artifact.bytes)}) : downloadBytes(p.artifact.bytes)) : ''].filter(Boolean).join(' · '), reason].filter(Boolean).join('\n')}
                          trailing={<Badge label={p.state === 'running' ? i18n.t('downloads.percent', {percent: Math.floor(p.progress.percent)}) : stateLabel(i18n, p.state)} tone={p.state === 'ready' ? 'accent' : p.state === 'failed' ? 'amber' : 'neutral'} />}
                          progress={p.state === 'running' || p.state === 'paused' ? p.progress.percent / 100 : 0}
                          disabled={state.busy.includes(p.id)}
                          onPress={() => (p.state === 'ready' && !offlineDownloads.blocked(p) ? fetch(p) : setChosen(p))}
                          onLongPress={() => setChosen(p)}
                        />
                      </View>
                    );
                  })}
                </Surface>
              ) : null}
              {state.nextCursor ? <Button variant="secondary" label={i18n.t('action.showMore')} loading={state.loadingMore} onPress={() => void service?.loadMore()} /> : null}
            </View>
          </Section>
        ) : null}
        {offline.supported && !state.unavailable ? (
          <Section title={i18n.t('downloads.rules')}>
            <Surface padded={false}>
              <ToggleRow title={i18n.t('downloads.wifiOnly')} subtitle={i18n.t('downloads.wifiOnlyHelp')} value={offline.settings.wifiOnly} onChange={wifiOnly => saveSetting({wifiOnly})} />
              <Divider inset={space.md} />
              <ToggleRow title={i18n.t('downloads.removeAfterWatching')} subtitle={i18n.t('downloads.removeAfterWatchingHelp')} value={offline.settings.deleteWatched} onChange={deleteWatched => saveSetting({deleteWatched})} />
              <Divider inset={space.md} />
              <ToggleRow title={i18n.t('downloads.nextEpisode')} subtitle={i18n.t('downloads.nextEpisodeHelp')} value={offline.settings.autoNext} onChange={autoNext => saveSetting({autoNext})} />
              <Divider inset={space.md} />
              <ListRow title={i18n.t('downloads.storageLimit')} subtitle={i18n.t('downloads.storageLimitHelp')} meta={offline.settings.limitBytes ? i18n.bytes(offline.settings.limitBytes) : i18n.t('downloads.noLimit')} trailingIcon="forward" onPress={() => setPicking(true)} />
            </Surface>
          </Section>
        ) : null}
      </Page>
      <Menu open={!!chosen} onClose={() => setChosen(undefined)} title={chosen ? offlineDownloads.display(chosen).title || i18n.t('downloads.title') : undefined} subtitle={chosen ? stateLabel(i18n, chosen.state) : undefined} items={items}
        onSelect={id => { if (!chosen) return; if (id === 'fetch') fetch(chosen); else void service?.act(chosen, id as DownloadAction); }} />
      <Menu open={picking} onClose={() => setPicking(false)} title={i18n.t('downloads.storageLimit')} items={limits.map(l => ({id: String(l.bytes), label: l.bytes ? i18n.bytes(l.bytes) : i18n.t('downloads.noLimit'), selected: l.bytes === offline.settings.limitBytes}))} onSelect={id => saveSetting({limitBytes: Number(id)})} />
    </View>
  );
}
