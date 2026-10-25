import React, {useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {downloadBytes, downloadReasonMessage, parseDownloadBatch, parseDownloadOptions, type DownloadOptionsView} from '../../../../../packages/client-core/src/downloads';
import type {ReadingClient} from '../../../../../packages/client-core/src/reading';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {nativePublicationReadsAvailable} from '../../../platform/offline-reading';
import {nativeRouteCrypto} from '../../platform/server-connections';
import {Focusable} from '../../kit/controls';
import {BottomSheet} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {Icon} from '../../kit/Icon';
import {useTheme} from '../../kit/theme';
import {createNativeDownloadsDevice} from './device';
import {getNativeDownloadSnapshot, closeNativeDownload, type NativeDownloadRequest} from './request';
import {nativeDestinationLifetime} from '../destinations/lifetime';

type Version = Readonly<{sourceId: string; format: string; size: number; inventoryAvailable: boolean; policy: DownloadOptionsView}>;
type Opening = {current: () => boolean; retire: () => void; dispose: () => void; pending: boolean; lease: ReturnType<typeof createNativeDownloadsDevice>; versions: readonly Version[]; abort: AbortController};
type Family = {retired: boolean; active?: Opening};
type State = Readonly<{opening?: Opening; versions?: readonly Version[]; policy?: DownloadOptionsView; busy?: string; error?: unknown}>;

/** The existing download sheet's original-publication branch. Real source IDs
 * and exact byte sizes come from Reading versions; no media-quality ladder. */
export function NativeReadingDownloadSheet({context, request}: {context: NativeShellBootstrapContext; request: NativeDownloadRequest}) {
  const theme = useTheme(), t = defaultI18n.t;
  const family = useMemo<Family>(() => ({retired: false}), [context, request]);
  const rendered = useRef(family);
  if (rendered.current !== family) {rendered.current.retired = true; rendered.current.active?.retire(); rendered.current = family;}
  const [state, setState] = useState<State>({}), [retry, setRetry] = useState(0), [selected, setSelected] = useState<string>();
  useLayoutEffect(() => {
    const itemId = request.itemId;
    if (!itemId || !nativePublicationReadsAvailable()) return;
    const viewer = context.session()?.viewer; if (!viewer) return;
    const lifetime = nativeDestinationLifetime(context), route = context.navigation.getSnapshot();
    const abort = new AbortController(), lease = createNativeDownloadsDevice(context);
    let alive = true, disposed = false, client: ReadingClient | undefined; let offDevice = () => {};
    const current = () => alive && !family.retired && family.active === opening && rendered.current === family && !abort.signal.aborted && lifetime.current() && getNativeDownloadSnapshot() === request && context.navigation.getSnapshot().revision === route.revision && context.navigation.getSnapshot().route === route.route;
    const stop = () => {if (!current()) abort.abort();};
    const offAuthority = context.subscribeAuthority(stop), offRoute = context.navigation.subscribe(stop);
    const opening: Opening = {current, pending: false, lease, versions: Object.freeze([]), abort,
      retire: () => {if (!alive) return; alive = false; abort.abort();},
      dispose: () => {opening.retire(); if (disposed) return; disposed = true; offAuthority(); offRoute(); offDevice(); client?.dispose(); lease.dispose();}};
    family.active = opening;
    offDevice = lease.device.subscribe(() => {if (current()) setState(value => value.opening === opening ? {...value} : value);});
    const reader = context.api.reading({viewer, isCurrent: current, signal: abort.signal});
    client = reader;
    setState({opening});
    void (async () => {
      const [versions] = await Promise.all([reader.versions(itemId, abort.signal), lease.device.open()]);
      if (!current()) return;
      const supported = versions.versions.filter(value => value.format === 'epub' || value.format === 'pdf' || value.format === 'cbz');
      const rows: Version[] = []; let next = 0;
      await Promise.all(Array.from({length: Math.min(4, supported.length)}, async () => {
        while (next < supported.length) {
          const index = next++, version = supported[index]; if (!version || !current()) return;
          const raw = await context.api.request<unknown>(`/v1/items/${encodeURIComponent(itemId)}/download-options?versionId=${encodeURIComponent(version.sourceId)}`, 'GET', undefined, abort.signal);
          if (!current()) return;
          const policy = parseDownloadOptions(raw, itemId);
          if (policy.source.bytes !== version.size || policy.source.available && policy.source.container !== version.format) throw new Error('reading_source_changed');
          rows[index] = Object.freeze({...version, policy});
        }
      }));
      if (!current()) return;
      opening.versions = Object.freeze(rows); setState({opening, versions: opening.versions, policy: rows[0]?.policy});
    })().catch(error => {if (current()) setState({opening, error});});
    return () => {opening.dispose(); if (family.active === opening) family.active = undefined;};
  }, [context, request, family, retry]);
  const close = (opening: Opening | undefined) => {if (!opening) {if (!family.retired && family.active === undefined && context.current()) closeNativeDownload(request); return;} if (family.active !== opening || !opening.current()) return; opening.retire(); closeNativeDownload(request);};
  const choose = async (opening: Opening, version: Version) => {
    const policy = version.policy;
    if (!opening.current() || opening.pending || !opening.versions.includes(version) || !version.inventoryAvailable || !['epub', 'pdf', 'cbz'].includes(version.format) || !policy.policy.allowDownloads || !policy.source.available || !policy.options.some(value => value.quality === 'original' && value.available) || !Number.isSafeInteger(version.size) || version.size < 1 || version.size > 2 ** 31) return;
    const device = opening.lease.device.getSnapshot();
    if (!device.ready || version.size > device.freeBytes || policy.storage.remainingBytes !== null && policy.storage.remainingBytes !== undefined && version.size > policy.storage.remainingBytes) return;
    opening.pending = true; setState(value => value.opening === opening && opening.current() ? {...value, busy: version.sourceId, error: undefined} : value);
    try {
      const operationId = 'reading_' + Array.from(nativeRouteCrypto.random(16), byte => byte.toString(16).padStart(2, '0')).join('');
      if (!opening.current()) return;
      const raw = await context.api.request<unknown>('/v1/downloads/preparations', 'POST', {operationId, mediaId: request.itemId, versionId: version.sourceId, quality: 'original'}, opening.abort.signal);
      if (!opening.current()) return;
      const result = parseDownloadBatch(raw);
      const preparation = result.items.find(value => value.itemId === request.itemId && value.versionId === version.sourceId && value.quality === 'original');
      if (!preparation) throw new Error(result.rejected[0]?.code ?? 'reading_unavailable');
      await opening.lease.wantPublication(preparation, opening.lease.service);
      if (opening.current()) close(opening);
    } catch (error) {if (opening.current()) setState(value => value.opening === opening && opening.current() ? {...value, error} : value);}
    finally {opening.pending = false; if (opening.current()) setState(value => value.opening === opening && opening.current() ? {...value, busy: undefined} : value);}
  };
  const shown: State = state.opening?.current() ? state : {};
  const blocked = shown.policy && !shown.policy.policy.allowDownloads;
  // tablet-read12b: the same versions and real preparation, chosen before the one
  // primary action. A side panel keeps the book visible on handheld tablets; the
  // phone keeps its sheet. No recommended flag is published, so the first version
  // the server lists as available is selected rather than claiming a recommendation.
  const versions = shown.versions?.filter(value => value.format === 'epub' || value.format === 'pdf' || value.format === 'cbz') ?? [];
  const opened = shown.opening;
  const ready = (version: Version) => {
    // A retained event must retire with its exact opening before touching the
    // borrowed device; a stale opening's lease is already released.
    if (!opened || !opened.current()) return false;
    const policy = version.policy;
    return !!policy && version.inventoryAvailable && policy.policy.allowDownloads && policy.source.available
      && policy.options.some(value => value.quality === 'original' && value.available) && version.size > 0 && !shown.busy
      && version.size <= opened.lease.device.getSnapshot().freeBytes
      && (policy.storage.remainingBytes === undefined || policy.storage.remainingBytes === null || version.size <= policy.storage.remainingBytes);
  };
  // An explicit honest choice stays chosen even if it becomes unavailable; the
  // primary action then disables instead of silently switching the format.
  const selectedVersion = versions.find(value => value.sourceId === selected) ?? versions.find(ready) ?? versions[0];
  const opening = shown.opening, freeBytes = opening?.lease.device.getSnapshot().freeBytes;
  return <BottomSheet open testID="native-reading-download-sheet" title={t('action.download')} description={request.title} fitContent
    width={theme.platform === 'phone' ? undefined : 360}
    onOpenChange={open => {if (!open) close(shown.opening);}}>
    <View style={{gap: 12}}>
      {!shown.versions && shown.error === undefined && nativePublicationReadsAvailable() && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('status.loading')}</Text>}
      {(!nativePublicationReadsAvailable() || shown.versions && !versions.length) && <StateView variant="inline" title={t('next.states.pageFailed')} body={t('next.states.pageFailedBody')}/>}
      {blocked && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{downloadReasonMessage(shown.policy!.policy.reason) || t('downloads.offForProfile')}</Text>}
      {shown.error !== undefined && <StateView variant="inline" title={t('next.states.pageFailed')} body={t('next.states.pageFailedBody')}
        primaryAction={{id: 'retry', label: t('next.states.tryAgain'), onPress: () => {if (shown.opening?.current() && !shown.opening.pending) setRetry(value => value + 1);}}}/>}
      {versions.map(version => {
        const available = ready(version), selectedVersionId = selectedVersion?.sourceId === version.sourceId;
        return <Focusable key={version.sourceId} testID={`reading-download-${version.sourceId}`} accessibilityRole="button" disabled={!available} focusKind="row" focusRadius={12}
          accessibilityState={{selected: selectedVersionId}}
          onPress={() => {if (available) setSelected(version.sourceId);}}
          style={{minHeight: 64, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity: available ? 1 : .5,
            backgroundColor: theme.colors.raised, borderWidth: selectedVersionId ? 1 : 0, borderColor: theme.colors.accent}}>
          <View><Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{version.format.toUpperCase()}</Text><Text style={[theme.type.caption, {color: theme.colors.textSecondary}]}>{downloadBytes(version.size)}</Text></View>
          {selectedVersionId && <Icon name="i-check" size={20} color={theme.colors.text}/>}
        </Focusable>;
      })}
      {freeBytes !== undefined && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t(theme.platform === 'phone' ? 'next.saved.phone.free' : 'downloads.freeOnDevice', {size: downloadBytes(freeBytes)})}</Text>}
      {!!selectedVersion && <Focusable testID="reading-download-primary" accessibilityRole="button" disabled={!ready(selectedVersion) || !!shown.busy}
        onPress={() => {if (opened && ready(selectedVersion)) void choose(opened, selectedVersion);}}
        style={{minHeight: 50, borderRadius: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
          backgroundColor: ready(selectedVersion) && !shown.busy ? theme.colors.text : theme.colors.raisedBright, opacity: ready(selectedVersion) && !shown.busy ? 1 : .55}}>
        <Text style={[theme.type.bodyStrong, {color: theme.colors.ink}]}>{t(shown.busy ? 'downloads.adding' : 'action.download')}</Text>
        <Text style={[theme.type.caption, {color: theme.colors.ink}]}>{downloadBytes(selectedVersion.size)}</Text>
      </Focusable>}
    </View>
  </BottomSheet>;
}
