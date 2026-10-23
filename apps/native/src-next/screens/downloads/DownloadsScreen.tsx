import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n, type MessageId} from '../../../../../packages/i18n/src';
import {Artwork} from '../../kit/artwork';
import {Button, Focusable, Switch} from '../../kit/controls';
import {Menu, type MenuEntry} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {Icon} from '../../kit/Icon';
import {browseType, alpha} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import {groupOfflineEntries, type NativeOfflineDownloadsAdapter, type OfflineEntry, type OfflineSettings} from '../../platform/offline-downloads';
import type {NativeShellRuntime} from '../../shell/runtime';

const t = defaultI18n.t;
const limits = [0, 5, 10, 25, 50, 100].map(gb => gb * 1073741824);

/** Frame-specific keys are supplied only from the checked canonical catalogue. */
export type NativeDownloadsCopy = Readonly<{
  emptyBody: MessageId; storageLimitHelp: MessageId; freeOnPhone: MessageId;
  removeFromPhone: MessageId; stoppedBody: MessageId; downloading: MessageId;
}>;
export type NativeDownloadsScreenProps = Readonly<{
  device: NativeOfflineDownloadsAdapter; runtime: NativeShellRuntime; copy: NativeDownloadsCopy;
  back: () => void; openTitle: (entry: OfflineEntry) => void;
}>;

/** The device adapter publishes only this viewer's native files. No server preparation
 * is ever counted as a file available here, or substituted for a local action. */
export function DownloadsScreen({device, runtime, copy, back, openTitle}: NativeDownloadsScreenProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const snapshot = useSyncExternalStore(device.subscribe, device.getSnapshot);
  const [failure, setFailure] = useState<unknown>(), [entryMenu, setEntryMenu] = useState<{entry: OfflineEntry; anchor: RefObject<View | null>}>();
  const menu = entryMenu?.entry;
  const [pickingLimit, setPickingLimit] = useState(false), [pending, setPending] = useState(false);
  const alive = useRef(true), operation = useRef(0), scroll = useRef<ScrollView>(null), limitRef = useRef<View>(null);
  useEffect(() => {const lifetime = alive, tickets = operation; lifetime.current = true; return () => {lifetime.current = false; tickets.current++;};}, [device]);
  const run = useCallback((work: () => Promise<void>) => {
    const revision = ++operation.current;
    setFailure(undefined); setPending(true);
    void work().catch(error => {if (alive.current && operation.current === revision) {setFailure(error); runtime.reportError(error);}})
      .finally(() => {if (alive.current && operation.current === revision) setPending(false);});
  }, [runtime]);
  useEffect(() => {run(device.open);}, [device, run]);
  const save = (settings: Partial<OfflineSettings>) => run(() => device.setSettings(settings));
  const groups = groupOfflineEntries(snapshot.entries);
  const empty = snapshot.ready && snapshot.entries.length === 0;
  const ruleList = <DownloadsRules settings={snapshot.settings} pending={pending} copy={copy} save={save} limitRef={limitRef} onLimit={() => setPickingLimit(true)}/>;
  const menuItems: MenuEntry[] = menu ? [
    ...(menu.state !== 'ready' ? [{id: 'resume', label: t('action.tryAgain'), icon: 'i-retry' as const, onSelect: () => run(() => device.resume(menu))}] : []),
    {id: 'title', label: t('web.downloads.goToTitle'), icon: 'i-film', onSelect: () => openTitle(menu)},
    {id: 'remove', label: t(copy.removeFromPhone), icon: 'i-trash', destructive: true, onSelect: () => run(() => device.remove(menu))},
  ] : [];
  return <View testID="native-downloads-screen" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{height: Math.max(96, insets.top + 48), paddingTop: Math.max(50, insets.top), paddingHorizontal: 10, justifyContent: 'center'}}>
      <Focusable testID="downloads-back" accessibilityLabel={t('saved.title')} onPress={back} style={{height: 38, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingRight: 6, marginLeft: -4}}>
        <Icon name="i-left" size={24} color={theme.colors.textSecondary}/><Text style={[browseType(theme, 16, 600), {color: theme.colors.textSecondary}]}>{t('saved.title')}</Text>
      </Focusable>
      <Text pointerEvents="none" accessibilityRole="header" style={[browseType(theme, 17, 700), {position: 'absolute', left: 80, right: 80, bottom: 13, textAlign: 'center', color: theme.colors.text}]}>{t('downloads.title')}</Text>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={{paddingBottom: 28}}>
      {!snapshot.supported ? <StateView title={t('downloads.unavailableOnDevice')}/> : <>
        {failure && <StateView {...runtime.error(failure, () => run(device.open))}/>}
        {empty && <View style={{paddingTop: 58, paddingHorizontal: 24, alignItems: 'center'}}>
          <View style={{width: 54, height: 54, borderRadius: 27, backgroundColor: alpha(theme.colors.text, .08), alignItems: 'center', justifyContent: 'center', marginBottom: 18}}><Icon name="i-dl" size={26} color={theme.colors.text}/></View>
          <Text accessibilityRole="header" style={[browseType(theme, 30, 800, -.035, 32.4), {color: theme.colors.text, textAlign: 'center', marginBottom: 10}]}>{t('next.states.native.noDownloads')}</Text>
          <Text style={[browseType(theme, 15, 400, 0, 22.5), {color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 16}]}>{t(copy.emptyBody)}</Text>
        </View>}
        {!empty && snapshot.ready && <View style={{marginHorizontal: 16, marginTop: 4, padding: 14, borderRadius: 14, backgroundColor: theme.colors.raised, flexDirection: 'row', gap: 12, alignItems: 'baseline'}}>
          <Text style={[browseType(theme, 14.5, 700), {color: theme.colors.text}]}>{t('downloads.used', {size: defaultI18n.bytes(snapshot.usedBytes)})}</Text>
          <Text style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary}]}>{t(copy.freeOnPhone, {size: defaultI18n.bytes(snapshot.freeBytes)})}</Text>
        </View>}
        <View style={dimensions.width >= 1024 && !empty ? {flexDirection: 'row', alignItems: 'flex-start'} : undefined}>
          {!empty && <View style={{flex: 1}}>{groups.map(group => <View key={group.key}>
            {!!group.title && <Text accessibilityRole="header" style={[browseType(theme, 13.5, 700), {color: theme.colors.textSecondary, marginTop: 20, marginHorizontal: 20, marginBottom: 8}]}>{group.title}</Text>}
            <View style={{marginHorizontal: 16, backgroundColor: theme.colors.raised, borderRadius: 14, overflow: 'hidden'}}>
              {group.entries.map((entry, index) => <DownloadRow key={entry.id} entry={entry} device={device} copy={copy} separator={index > 0}
                onMenu={anchor => setEntryMenu({entry, anchor})} onPlay={() => run(() => device.openOffline(entry))} onRetry={() => run(() => device.resume(entry))}/>)}
            </View>
          </View>)}</View>}
          <View style={dimensions.width >= 1024 && !empty ? {width: 360} : {flex: 1}}>{ruleList}</View>
        </View>
      </>}
    </ScrollView>
    <Menu testID="downloads-entry-menu" open={!!menu} onOpenChange={open => {if (!open) setEntryMenu(undefined);}} anchorRef={entryMenu?.anchor} returnFocusRef={entryMenu?.anchor} title={menu?.title ?? ''} context={menu && <View style={{flexDirection: 'row', gap: 14, padding: 16}}>
      <Artwork source={localArtwork(menu)} width={44} height={66}/><Text style={[browseType(theme, 17, 800), {color: theme.colors.text, flex: 1}]}>{menu.title}</Text>
    </View>} items={menuItems} presentation={dimensions.width < 600 ? 'sheet' : 'anchored'}/>
    <Menu testID="downloads-storage-limit" open={pickingLimit} onOpenChange={setPickingLimit} anchorRef={limitRef} returnFocusRef={limitRef} title={t('downloads.storageLimit')}
      items={limits.map(value => ({id: String(value), label: value ? defaultI18n.bytes(value) : t('downloads.noLimit'), selected: snapshot.settings.limitBytes === value,
        onSelect: () => save({limitBytes: value})}))} presentation={dimensions.width < 600 ? 'sheet' : 'anchored'}/>
  </View>;
}

function DownloadsRules({settings, pending, copy, save, onLimit, limitRef}: {settings: OfflineSettings; pending: boolean; copy: NativeDownloadsCopy; save: (settings: Partial<OfflineSettings>) => void; onLimit: () => void; limitRef: RefObject<View | null>}) {
  const theme = useTheme();
  const rows = [
    {field: 'wifiOnly', label: 'downloads.wifiOnly', help: 'downloads.wifiOnlyHelp'},
    {field: 'deleteWatched', label: 'downloads.removeAfterWatching', help: 'downloads.removeAfterWatchingHelp'},
    {field: 'autoNext', label: 'downloads.nextEpisode', help: 'downloads.nextEpisodeHelp'},
  ] as const;
  const label = (title: string, help: string) => <View style={{flex: 1, minWidth: 0}}><Text style={[browseType(theme, 15.5, 600), {color: theme.colors.text}]}>{title}</Text><Text style={[browseType(theme, 12.5, 500, 0, 17.5), {color: theme.colors.textTertiary, marginTop: 2}]}>{help}</Text></View>;
  return <>
    <Text accessibilityRole="header" style={[browseType(theme, 13.5, 700), {color: theme.colors.textTertiary, marginTop: 26, marginHorizontal: 20, marginBottom: 8}]}>{t('downloads.rules')}</Text>
    <View style={{marginHorizontal: 16, borderRadius: 14, backgroundColor: theme.colors.raised, overflow: 'hidden'}}>
      {rows.map((row, index) => <View key={row.field} style={{position: 'relative', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 8, paddingHorizontal: 14}}>
        {index > 0 && <View style={{position: 'absolute', top: 0, left: 56, right: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, .45)}}/>}
        {label(t(row.label), t(row.help))}<Switch testID={`downloads-rule-${row.field}`} accessibilityLabel={t(row.label)} checked={settings[row.field]} disabled={pending}
          variant="phone" onCheckedChange={value => save({[row.field]: value})}/>
      </View>)}
      <Focusable ref={limitRef} testID="downloads-rule-limitBytes" accessibilityLabel={t('downloads.storageLimit')} disabled={pending} onPress={onLimit}
        style={{position: 'relative', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingVertical: 8, paddingHorizontal: 14}}>
        <View style={{position: 'absolute', top: 0, left: 56, right: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, .45)}}/>
        {label(t('downloads.storageLimit'), t(copy.storageLimitHelp))}
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 2}}><Text style={[browseType(theme, 14.5, 600), {color: theme.colors.textTertiary}]}>{settings.limitBytes ? defaultI18n.bytes(settings.limitBytes) : t('downloads.noLimit')}</Text><Icon name="i-right" size={18} color={theme.colors.lineStrong}/></View>
      </Focusable>
    </View>
  </>;
}

function localArtwork(entry: OfflineEntry) {
  return entry.artworkUrl ? {uri: entry.artworkUrl, cacheKey: JSON.stringify([entry.owner, entry.receipt?.receiptId, entry.id, entry.artworkUrl])} : undefined;
}

function DownloadRow({entry, device, copy, separator, onMenu, onPlay, onRetry}: {entry: OfflineEntry; device: NativeOfflineDownloadsAdapter; copy: NativeDownloadsCopy; separator: boolean; onMenu: (anchor: RefObject<View | null>) => void; onPlay: () => void; onRetry: () => void}) {
  const theme = useTheme(), blocked = entry.state === 'ready' ? device.playable(entry) : '', opener = useRef<View>(null);
  const menu = () => onMenu(opener);
  const warning = entry.waiting || blocked, stopped = entry.state === 'failed';
  const reason = entry.waiting ? t(entry.waiting === 'wifi' ? 'downloads.waiting.wifi' : 'downloads.waiting.network')
    : blocked || device.note(entry) || (stopped ? t(copy.stoppedBody) : entry.state === 'paused' ? t('downloads.paused') : '');
  return <View style={{position: 'relative', paddingVertical: 9, paddingLeft: 14, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 13}}>
    {separator && <View style={{position: 'absolute', top: 0, left: 74, right: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, .45)}}/>}
    <Focusable ref={opener} testID={`download-${encodeURIComponent(entry.id)}`} accessibilityLabel={entry.title} onPress={entry.state === 'ready' && !blocked ? onPlay : menu} onLongPressAction={menu}
      style={{flex: 1, flexDirection: 'row', alignItems: 'center', gap: 13}}>
      <Artwork source={localArtwork(entry)} width={46} height={69} style={{borderRadius: 6}}/>
      <View style={{flex: 1, minWidth: 0}}><Text numberOfLines={1} style={[browseType(theme, 15, 700), {color: theme.colors.text}]}>{entry.title}</Text>
        {entry.subtitle && <Text style={[browseType(theme, 12.5, 400, 0, 17.5), {color: theme.colors.textTertiary, marginTop: 2}]}>{entry.subtitle}</Text>}
        {!!reason && <Text style={[browseType(theme, 12.5, 400, 0, 17.5), {color: stopped ? theme.colors.record : warning ? theme.colors.amber : theme.colors.textTertiary, marginTop: 2}]}>{reason}</Text>}
        {entry.state === 'downloading' && !entry.waiting && <><Text style={[browseType(theme, 12.5, 400), {color: theme.colors.textTertiary, marginTop: 2}]}>{t(copy.downloading, {percent: Math.round(100 * Math.min(1, entry.bytes > 0 ? entry.bytesDone / entry.bytes : 0))})}</Text><View style={{height: 3, backgroundColor: theme.colors.raisedBright, marginTop: 7, borderRadius: 2, overflow: 'hidden'}}><View style={{height: 3, width: `${100 * Math.min(1, entry.bytes > 0 ? entry.bytesDone / entry.bytes : 0)}%`, backgroundColor: theme.colors.accentStrong}}/></View></>}
      </View>
    </Focusable>
    {stopped && <Button testID={`download-retry-${encodeURIComponent(entry.id)}`} variant="glass" size="compact" icon="i-retry" onPress={onRetry}>{t('action.tryAgain')}</Button>}
    <Focusable testID={`download-action-${encodeURIComponent(entry.id)}`} accessibilityLabel={t(entry.state === 'ready' && !blocked ? 'action.play' : 'card.more', {title: entry.title})}
      onPress={entry.state === 'ready' && !blocked ? onPlay : menu} style={{width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: entry.state === 'ready' && !blocked ? theme.colors.text : undefined}}>
      <Icon name={entry.state === 'ready' && !blocked ? 'i-play' : 'i-more'} size={entry.state === 'ready' && !blocked ? 16 : 20} color={entry.state === 'ready' && !blocked ? theme.colors.ink : theme.colors.textTertiary}/>
    </Focusable>
  </View>;
}
