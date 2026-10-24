import React, {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {NativeModules, Platform, Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {downloadBytes, downloadReasonMessage, type DownloadOptionsView, type DownloadQualityOption} from '../../../../../packages/client-core/src/downloads';
import type {DownloadEpisodes} from '../../../../../packages/client-core/src/download-requests';
import type {ContainerDownloadPolicy, DownloadsService} from '../../../../../packages/client-core/src/downloads-service';
import type {NativeShellBootstrapContext} from '../../shell/bootstrap';
import {Focusable} from '../../kit/controls';
import {useTheme} from '../../kit/theme';
import {BottomSheet} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {createNativeDownloadsDevice} from './device';
import {nativeDeviceSettings} from '../../platform/device-settings';
import type {EngineSetting} from '../../platform/playback/engine-choice';
import {originalMayNotPlay} from './original-opens';
import {closeNativeDownload, getNativeDownloadSnapshot, subscribeNativeDownload, type NativeDownloadRequest} from './request';

type ContainerOptions = Readonly<{quality: string; label: string; available: boolean; estimated: boolean; estimatedBytes: number; unavailableCount: number}>;

/** The phone's drawn download sheet (collections 31a/32a-c): the server's real
 * quality menu, the whole-container episode policy, the sizes it will be, the
 * server's room and this device's, then today's confirmation. */
export function NativeDownloadSheet({context}: {context: NativeShellBootstrapContext}) {
  const request = useSyncExternalStore(subscribeNativeDownload, getNativeDownloadSnapshot);
  return request ? <NativeDownloadSheetBody context={context} request={request} key={`${request.itemId ?? ''}|${request.container?.kind ?? ''}|${request.container?.id ?? ''}|${request.title}`}/> : null;
}

function NativeDownloadSheetBody({context, request}: {context: NativeShellBootstrapContext; request: NativeDownloadRequest}) {
  const theme = useTheme(), t = defaultI18n.t;
  const lease = useRef<ReturnType<typeof createNativeDownloadsDevice> | undefined>(undefined);
  const download = () => (lease.current ??= createNativeDownloadsDevice(context));
  const service = (): DownloadsService => download().service;
  useEffect(() => () => {lease.current?.dispose(); lease.current = undefined;}, []);
  const container = request.container, deviceId = context.session()?.deviceId;
  const [view, setView] = useState<DownloadOptionsView>(), [choices, setChoices] = useState<readonly ContainerOptions[]>(), [policy, setPolicy] = useState<DownloadEpisodes>('all'), [keepNext, setKeepNext] = useState(1);
  const [busy, setBusy] = useState(''), [done, setDone] = useState(''), [error, setError] = useState<unknown>();
  useEffect(() => {
    const abort = new AbortController(); setError(undefined); setDone('');
    if (!container && request.itemId) {
      void service().options(request.itemId, abort.signal).then(next => {if (!abort.signal.aborted) setView(next);}, failure => {if (!abort.signal.aborted) setError(failure);});
    } else if (container && deviceId) {
      const wanted: ContainerDownloadPolicy = policy === 'next' ? {episodes: policy, keepNext} : {episodes: policy};
      void service().containerOptions({kind: container.kind, id: container.id, title: request.title}, deviceId, wanted, abort.signal)
        .then(next => {if (!abort.signal.aborted) setChoices(next.options);}, failure => {if (!abort.signal.aborted) setError(failure);});
    }
    return () => abort.abort();
    // The whole-request size follows the chosen policy, so each change reads it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.itemId, container?.kind, container?.id, deviceId, policy, keepNext]);
  const close = () => closeNativeDownload();
  const choose = async (quality: string) => {
    if (busy) return;
    setBusy(quality); setError(undefined);
    try {
      if (container) {
        if (!deviceId) throw Object.assign(new Error('downloads.noDevice'), {code: 'noDevice'});
        const followed = await service().requestContainer({target: {kind: container.kind, id: container.id, title: request.title}, deviceId, quality,
          policy: policy === 'next' ? {episodes: policy, keepNext} : {episodes: policy}});
        setDone(followed.totalKnown ? t('downloads.addedMany', {count: followed.total}) : t('downloads.requestPreparing'));
        return;
      }
      if (!request.itemId) return;
      const batch = await service().request({mediaId: request.itemId}, quality);
      await download().want(batch.items.map(value => value.itemId), batch.items[0] ? download().display(batch.items[0]) : undefined, service());
      setDone(batch.rejected.length
        ? batch.accepted ? t('downloads.addedMixed', {accepted: batch.accepted, rejected: batch.rejected.length, reason: downloadReasonMessage(batch.rejected[0].code)}) : downloadReasonMessage(batch.rejected[0].code) || t('downloads.nothingAdded')
        : !batch.accepted || batch.duplicate ? batch.items.length ? t('downloads.already') : t('downloads.nothingAdded') : t('downloads.willArrive'));
    } catch (failure) {setError(failure);} finally {setBusy('');}
  };
  const policyRow = (id: DownloadEpisodes, label: string) => <Focusable key={id} testID={`download-policy-${id}`} accessibilityRole="button" accessibilityState={{selected: policy === id}} onPress={() => setPolicy(id)} focusRadius={12}
    style={{minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12}}>
    <Text style={[theme.type.body, {color: theme.colors.text, flex: 1}]}>{label}</Text>
    {policy === id && <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accentStrong}}/>}
  </Focusable>;
  const qualityRow = (option: Readonly<{quality: string; label: string; available: boolean; size?: string; note?: string; meta?: string}>) => <Focusable key={option.quality} testID={`download-quality-${option.quality}`} accessibilityRole="button"
    disabled={!option.available || !!busy} onPress={() => {void choose(option.quality);}} focusRadius={12}
    style={{minHeight: 56, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: option.available ? 1 : .55}}>
    <View style={{flex: 1, minWidth: 0}}>
      <Text style={[theme.type.bodyStrong, {color: theme.colors.text}]}>{option.label}</Text>
      {!!(option.size || option.note) && <Text numberOfLines={3} style={[theme.type.caption, {color: theme.colors.textSecondary, marginTop: 2}]}>{[option.size, option.note].filter(Boolean).join(' · ')}</Text>}
    </View>
    <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{option.meta ?? (option.available ? t('action.download') : '')}</Text>
  </Focusable>;
  const titleOption = (option: DownloadQualityOption) => qualityRow({quality: option.quality, label: option.label, available: option.available,
    size: option.available ? option.estimated ? t('downloads.aboutSize', {size: downloadBytes(option.estimatedBytes)}) : downloadBytes(option.estimatedBytes) : downloadReasonMessage(option.reason ?? ''),
    note: [option.available && option.requiresPreparation ? t('downloads.serverPrepares') : undefined, option.kind === 'source' && cannotOpen ? t('downloads.quality.originalMayNotPlay') : undefined].filter(Boolean).join(' · ') || undefined,
    meta: busy === option.quality ? t('downloads.adding') : undefined});
  const engine = ((): EngineSetting | undefined => {try {const value = nativeDeviceSettings(context).read('playerEngine'); return value === 'native' || value === 'mpv' ? value : 'automatic';} catch {return undefined;}})();
  const cannotOpen = !!view && originalMayNotPlay(view.source.container, {platform: Platform.OS === 'ios' ? 'apple' : 'android',
    mpv: Platform.OS === 'android' && (NativeModules.PorticoMpvPlaybackModule as undefined | {available?: boolean})?.available === true, player: engine ?? 'automatic'});
  const blocked = view && !view.policy.allowDownloads;
  const storage = view?.storage.remainingBytes;
  return <BottomSheet open onOpenChange={open => {if (!open) close();}} testID="native-download-sheet" title={t('action.download')} description={request.title} fitContent
    footer={done ? <View style={{flexDirection: 'row', gap: 12}}><Focusable accessibilityRole="button" onPress={close} focusRadius={12} style={{minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center'}}><Text style={[theme.type.bodyStrong, {color: theme.colors.textSecondary}]}>{t('action.close')}</Text></Focusable>
      <Focusable accessibilityRole="button" onPress={() => {close(); context.navigation.open({kind: 'downloads'}, context.authority());}} focusRadius={12} style={{minHeight: 48, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.text, borderRadius: 12}}><Text style={[theme.type.bodyStrong, {color: theme.colors.ink}]}>{t('downloads.view')}</Text></Focusable></View> : undefined}>
    <View style={{gap: 16}}>
      {error !== undefined && <StateView {...{...downloadError(error), tone: 'error' as const}}/>}
      {done ? <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{done}</Text> : <>
        {blocked && view && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{downloadReasonMessage(view.policy.reason) || t('downloads.offForProfile')}</Text>}
        {container && !deviceId && <Text style={[theme.type.body, {color: theme.colors.textSecondary}]}>{t('downloads.noDevice')}</Text>}
        {container && <View style={{backgroundColor: theme.colors.raised, borderRadius: 14}}>{policyRow('all', t('downloads.policyAll'))}{policyRow('unwatched', t('downloads.policyUnwatched'))}{policyRow('next', t('downloads.policyNext'))}</View>}
        {container && policy === 'next' && <View style={{backgroundColor: theme.colors.raised, borderRadius: 14}}>{[1, 3, 5].map(count => <Focusable key={count} accessibilityRole="button" accessibilityState={{selected: keepNext === count}} onPress={() => setKeepNext(count)} focusRadius={12}
          style={{minHeight: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center'}}><Text style={[theme.type.body, {color: theme.colors.text, flex: 1}]}>{t('downloads.keepNext', {count})}</Text>{keepNext === count && <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accentStrong}}/>}</Focusable>)}</View>}
        {!done && !container && !view && error === undefined && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('downloads.checking')}</Text>}
        {view && !blocked && <View style={{backgroundColor: theme.colors.raised, borderRadius: 14}}>{view.options.map(titleOption)}</View>}
        {container && choices && <View style={{backgroundColor: theme.colors.raised, borderRadius: 14}}>{choices.map(option => qualityRow({quality: option.quality, label: option.label, available: option.available && !!deviceId,
          size: option.estimated ? t('downloads.aboutSize', {size: downloadBytes(option.estimatedBytes)}) : downloadBytes(option.estimatedBytes), meta: busy === option.quality ? t('downloads.adding') : undefined}))}</View>}
        {storage != null && <Text style={[theme.type.caption, {color: theme.colors.textTertiary}]}>{t('downloads.spaceLeft', {size: downloadBytes(storage)})}</Text>}
      </>}
    </View>
  </BottomSheet>;
}

/** A real read failure keeps its catalogue wording; an unknown failure is not
 * dressed as a download refusal. */
function downloadError(error: unknown) {
  const code = (error as {code?: unknown})?.code;
  if (code === 'noDevice') return {title: defaultI18n.t('downloads.noDevice')};
  if (typeof code === 'string' && code) return {title: defaultI18n.t('downloads.error.action'), body: downloadReasonMessage(code) || undefined};
  return {title: defaultI18n.t('downloads.error.action'), body: error instanceof Error ? error.message : undefined};
}
