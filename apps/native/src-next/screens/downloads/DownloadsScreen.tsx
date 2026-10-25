import React, {useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork} from '../../kit/artwork';
import {Chip, Focusable, Switch} from '../../kit/controls';
import {CardFrame} from '../../kit/cards/primitives';
import {BottomSheet, Menu, type MenuAction} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {Icon} from '../../kit/Icon';
import {browseType, alpha} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {DownloadsService, TrackedDownloadRequest} from '../../../../../packages/client-core/src/downloads-service';
import {type NativeOfflineDownloadsDevice, type OfflineEntry, type OfflineSettings} from '../../platform/offline-downloads';
import type {NativeShellRuntime} from '../../shell/runtime';
import {downloadEntryIdentity, downloadGroups, downloadRequestLines, downloadRowText, downloadStorageSegments, downloadTransferProgress, type NativeDownloadsCopy} from './presentation';
import {useDownloadArtwork} from './useDownloadArtwork';
import {useReadingFacts} from './useReadingFacts';

const t = defaultI18n.t;
const noRequests = (): readonly TrackedDownloadRequest[] => Object.freeze([]);
const noSubscribe = (_listener: () => void) => () => {};
const limits = [0, 5, 10, 25, 50, 100].map(gb => gb * 1073741824);

export type {NativeDownloadsCopy} from './presentation';
export type NativeDownloadsScreenProps = Readonly<{
  device: NativeOfflineDownloadsDevice; runtime: NativeShellRuntime; copy: NativeDownloadsCopy;
  back: () => void; openTitle: (entry: OfflineEntry) => void;
  /** The same authority-local service the route created; its requests are the
   * server's whole-container preparations for this device. */
  service?: Pick<DownloadsService, 'subscribe' | 'getSnapshot'>;
}>;

/** The device adapter publishes only this viewer's native files. No server preparation
 * is ever counted as a file available here, or substituted for a local action. */
export function DownloadsScreen({device, runtime, copy, back, openTitle, service}: NativeDownloadsScreenProps) {
  const theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  const snapshot = useSyncExternalStore(device.subscribe, device.getSnapshot);
  const [failure, setFailure] = useState<unknown>(), [entryMenu, setEntryMenu] = useState<{entry: OfflineEntry; anchor: RefObject<View | null>}>();
  const menu = entryMenu && snapshot.entries.find(entry => downloadEntryIdentity(entry) === downloadEntryIdentity(entryMenu.entry));
  useEffect(() => {if (entryMenu && !menu) setEntryMenu(undefined);}, [entryMenu, menu]);
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
  const groups = downloadGroups(snapshot.entries), storage = downloadStorageSegments(snapshot);
  const requests = useSyncExternalStore(service ? service.subscribe : noSubscribe, service ? () => service.getSnapshot().requests : noRequests);
  const empty = snapshot.ready && snapshot.entries.length === 0 && requests.length === 0;
  // tablet-read12 draws Saved › Downloads at the expanded width: what the device
  // holds and what is left, then the profile's actual reading publications and
  // everything else as two-column lists. Phone and medium keep today's page.
  const expanded = !theme.isTV && dimensions.width >= 1024;
  const readingEntry = (entry: OfflineEntry) => {
    const kind = entry.info?.kind ?? entry.kind;
    return kind === 'ebook' || kind === 'comic';
  };
  const readingEntries = snapshot.entries.filter(readingEntry), watchingEntries = snapshot.entries.filter(entry => !readingEntry(entry));
  const storedBytes = (entry: OfflineEntry) => entry.state === 'ready' ? entry.bytes : entry.bytesDone;
  const readingBytes = readingEntries.reduce((sum, entry) => sum + storedBytes(entry), 0);
  const watchingBytes = watchingEntries.reduce((sum, entry) => sum + storedBytes(entry), 0);
  const heldBytes = Math.max(snapshot.usedBytes, readingBytes + watchingBytes);
  const watchingGroups = downloadGroups(watchingEntries);
  const requestText = (tracked: TrackedDownloadRequest): string => downloadRequestLines(tracked.request).map(line =>
    line.key === 'downloads.requestProgress' ? t(line.key, line.values as {ready: number; total: number})
      : line.key === 'downloads.requestFailed' ? t(line.key, line.values as {failed: number}) : t(line.key)).join(' · ');
  const ruleList = <DownloadsRules settings={snapshot.settings} pending={pending} copy={copy} save={save} limitRef={limitRef} onLimit={() => setPickingLimit(true)}/>;
  const otherNotice = snapshot.otherBytes > 0 && <View style={{marginHorizontal: 16, marginTop: 14, paddingLeft: 14, paddingRight: 12, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: alpha(theme.colors.text, .08), flexDirection: 'row', gap: 10, alignItems: 'center'}}>
    <Icon name="i-info" size={18} color={theme.colors.textSecondary}/><Text style={[browseType(theme, 13.5, 400), {color: theme.colors.textSecondary, flex: 1}]}>{t(copy.otherProfiles, {size: defaultI18n.bytes(snapshot.otherBytes)})}</Text>
    <Chip testID="downloads-remove-other-profiles" disabled={pending} onPress={() => run(device.removeOthers)}>{t('action.remove')}</Chip>
  </View>;
  const firstMenuAction = useRef<View>(null);
  const menuItems: MenuAction[] = menu ? [
    ...(menu.state !== 'ready' ? [{id: 'resume', label: t('action.tryAgain'), icon: 'i-retry' as const, onSelect: () => run(() => device.resume(menu))}] : []),
    {id: 'title', label: t('web.downloads.goToTitle'), icon: 'i-film', onSelect: () => openTitle(menu)},
    {id: 'remove', label: t(copy.removeFromPhone), icon: 'i-trash', destructive: true, onSelect: () => run(() => device.remove(menu))},
  ] : [];
  const downloadRow = (entry: OfflineEntry, separator: boolean) => <DownloadRow key={entry.id} entry={entry} device={device} runtime={runtime} copy={copy} separator={separator} menuOpen={menu?.id === entry.id}
    onMenu={anchor => setEntryMenu({entry, anchor})} onPlay={device.openOffline ? () => run(() => device.openOffline!(entry)) : undefined} onRetry={() => run(() => device.resume(entry))}/>;
  return <View testID="native-downloads-screen" style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View style={{height: Math.max(96, insets.top + 48), paddingTop: Math.max(50, insets.top), paddingHorizontal: 10, justifyContent: 'center'}}>
      <Focusable testID="downloads-back" accessibilityLabel={t('saved.title')} onPress={back} style={{height: 38, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', paddingRight: 6, marginLeft: -4}}>
        <Icon name="i-left" size={24} color={theme.colors.textSecondary}/><Text style={[browseType(theme, 16, 600), {color: theme.colors.textSecondary}]}>{t('saved.title')}</Text>
      </Focusable>
      <Text pointerEvents="none" accessibilityRole="header" style={[browseType(theme, 17, 700), {position: 'absolute', left: 80, right: 80, bottom: 13, textAlign: 'center', color: theme.colors.text}]}>{t('downloads.title')}</Text>
    </View>
    <ScrollView ref={scroll} style={{flex: 1}} contentContainerStyle={{paddingBottom: 28}}>
      {!snapshot.supported ? <StateView title={t('downloads.unavailableOnDevice')}/> : <>
        {failure && <StateView {...runtime.error(failure, () => run(device.open))}/>}
        {empty && <View style={{paddingTop: 58, paddingHorizontal: 24, alignItems: 'center'}}>
          <View style={{width: 54, height: 54, borderRadius: 27, backgroundColor: alpha(theme.colors.text, .08), alignItems: 'center', justifyContent: 'center', marginBottom: 18}}><Icon name="i-dl" size={26} color={theme.colors.text}/></View>
          <Text accessibilityRole="header" style={[browseType(theme, 30, 800, -.035, 32.4), {color: theme.colors.text, textAlign: 'center', marginBottom: 10}]}>{t('next.states.native.noDownloads')}</Text>
          <Text style={[browseType(theme, 15, 400, 0, 22.5), {color: theme.colors.textSecondary, textAlign: 'center', marginBottom: 16}]}>{t(copy.emptyBody)}</Text>
        </View>}
        {!empty && snapshot.ready && <View style={{marginHorizontal: 16, marginTop: 4, padding: 14, borderRadius: 14, backgroundColor: theme.colors.raised}}>
          <View style={{flexDirection: 'row', gap: 12, alignItems: 'baseline'}}>
          <Text style={[browseType(theme, 14.5, 700), {color: theme.colors.text}]}>{t('downloads.used', {size: defaultI18n.bytes(snapshot.usedBytes)})}</Text>
          <Text style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary}]}>{t(expanded ? 'downloads.freeOnDevice' : copy.freeOnPhone, {size: defaultI18n.bytes(snapshot.freeBytes)})}</Text>
          </View>
          {expanded ? (heldBytes > 0 && <>
            <View testID="downloads-storage-split" style={{height: 6, borderRadius: 3, backgroundColor: theme.colors.raisedBright, marginTop: 10, overflow: 'hidden', flexDirection: 'row'}}>
              <View style={{height: 6, width: `${100 * watchingBytes / heldBytes}%`, backgroundColor: theme.colors.accentStrong}}/>
              <View style={{height: 6, width: `${100 * readingBytes / heldBytes}%`, backgroundColor: theme.colors.amber}}/>
            </View>
            <View style={{flexDirection: 'row', gap: 18, marginTop: 10, flexWrap: 'wrap'}}>
              <DownloadsStorageKey color={theme.colors.accentStrong} label={t('next.live.watching')} size={watchingBytes}/>
              <DownloadsStorageKey color={theme.colors.amber} label={t('next.settingsSpec.account.reading.title')} size={readingBytes}/>
            </View>
          </>) : storage && <View testID="downloads-storage-bar" style={{height: 6, borderRadius: 3, backgroundColor: theme.colors.raisedBright, marginTop: 10, overflow: 'hidden', flexDirection: 'row'}}>
            <View style={{height: 6, width: `${100 * storage.downloads}%`, backgroundColor: theme.colors.accentStrong}}/>
            <View style={{height: 6, width: `${100 * storage.other}%`, backgroundColor: alpha(theme.colors.accentStrong, .4)}}/>
          </View>}
        </View>}
        {requests.length > 0 && <View testID="downloads-requests" style={{marginTop: 18, marginHorizontal: 16}}>
          <Text accessibilityRole="header" style={[browseType(theme, 13.5, 700), {color: theme.colors.textSecondary, marginBottom: 8}]}>{t('downloads.requestsTitle')}</Text>
          <View style={{backgroundColor: theme.colors.raised, borderRadius: 14, overflow: 'hidden'}}>
            {requests.map((tracked, index) => <View key={tracked.request.requestId} testID={`downloads-request-${tracked.request.requestId}`}
              style={{paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: index ? 1 : 0, borderTopColor: alpha(theme.colors.lineStrong, .45)}}>
              <Text numberOfLines={1} style={[browseType(theme, 15, 700), {color: theme.colors.text}]}>{tracked.title}</Text>
              <Text style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary, marginTop: 3}]}>{requestText(tracked)}</Text>
            </View>)}
          </View>
        </View>}
        {expanded && !empty ? <>
          {readingEntries.length > 0 && <View testID="downloads-reading" style={{marginTop: 24}}>
            <DownloadsSectionHeading label={t('next.settingsSpec.account.reading.title')} count={readingEntries.length}/>
            <View style={{flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 14}}>
              {readingEntries.map(entry => <View key={entry.id} style={{width: '50%', paddingHorizontal: 6}}>
                <View style={{borderBottomWidth: 1, borderBottomColor: alpha(theme.colors.lineStrong, .45)}}>{downloadRow(entry, false)}</View>
              </View>)}
            </View>
          </View>}
          {watchingGroups.length > 0 && <View testID="downloads-watching" style={{marginTop: 24}}>
            <DownloadsSectionHeading label={t('next.live.watching')} count={watchingGroups.length}/>
            {watchingGroups.map(group => <View key={group.key} style={{marginTop: 8}}>
              {!!group.title && <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 8, marginHorizontal: 20, marginBottom: 4}}>
                <Text accessibilityRole="header" style={[browseType(theme, 15, 700), {color: theme.colors.textSecondary}]}>{group.title}</Text>
                {group.episodeCount !== undefined && <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textTertiary}]}>{t('count.episodes', {count: group.episodeCount})}</Text>}
              </View>}
              <View style={{flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 14}}>
                {group.entries.map(entry => <View key={entry.id} style={{width: '50%', paddingHorizontal: 6}}>
                  <View style={{borderBottomWidth: 1, borderBottomColor: alpha(theme.colors.lineStrong, .45)}}>{downloadRow(entry, false)}</View>
                </View>)}
              </View>
            </View>)}
          </View>}
          <View style={{marginTop: 10}}>{ruleList}{otherNotice}</View>
        </> : <View>
          {!empty && groups.map(group => <View key={group.key}>
            {!!group.title && <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 20, marginHorizontal: 20, marginBottom: 8}}>
              <Text accessibilityRole="header" style={[browseType(theme, 13.5, 700), {color: theme.colors.textSecondary}]}>{group.title}</Text>
              {group.episodeCount !== undefined && <Text style={[browseType(theme, 13.5, 700), {color: theme.colors.textTertiary}]}>{t('count.episodes', {count: group.episodeCount})}</Text>}
            </View>}
            <View style={{marginHorizontal: 16, backgroundColor: theme.colors.raised, borderRadius: 14, overflow: 'hidden'}}>
              {group.entries.map((entry, index) => downloadRow(entry, index > 0))}
            </View>
          </View>)}
          <View>{ruleList}{otherNotice}</View>
        </View>}
      </>}
    </ScrollView>
    {dimensions.width < 600 && !theme.isTV ? <BottomSheet testID="downloads-entry-menu" title={undefined} open={!!menu} onOpenChange={open => {if (!open) setEntryMenu(undefined);}}
      initialFocusRef={firstMenuAction} returnFocusRef={entryMenu?.anchor} accessibilityLabel={menu?.title} headerContent={menu && <DownloadMenuContext entry={menu} copy={copy}/>}
      showClose={false} fitContent scrollable={false}>
      <View style={{paddingBottom: Math.max(26, insets.bottom)}}>{menuItems.map((action, index) => <Focusable key={action.id} ref={index === 0 ? firstMenuAction : undefined} testID={`downloads-entry-menu-item-${action.id}`}
        onPress={() => {setEntryMenu(undefined); action.onSelect();}} style={{height: 54, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 14}}>
        {action.icon && <Icon name={action.icon} size={22} color={action.destructive ? theme.colors.record : theme.colors.textSecondary}/>}
        <Text style={[browseType(theme, 16, 600), {color: action.destructive ? theme.colors.record : theme.colors.text}]}>{action.label}</Text>
      </Focusable>)}</View>
    </BottomSheet> : <Menu testID="downloads-entry-menu" title={undefined} open={!!menu} onOpenChange={open => {if (!open) setEntryMenu(undefined);}} anchorRef={entryMenu?.anchor} returnFocusRef={entryMenu?.anchor} accessibilityLabel={menu?.title}
      context={menu && <DownloadMenuContext entry={menu} copy={copy}/>} items={menuItems} presentation={theme.isTV ? 'sideSheet' : 'anchored'}/>}
    <Menu testID="downloads-storage-limit" open={pickingLimit} onOpenChange={setPickingLimit} anchorRef={limitRef} returnFocusRef={limitRef} title={t('downloads.storageLimit')}
      items={limits.map(value => ({id: String(value), label: value ? defaultI18n.bytes(value) : t('downloads.noLimit'), selected: snapshot.settings.limitBytes === value,
        onSelect: () => save({limitBytes: value})}))} presentation={dimensions.width < 600 ? 'sheet' : 'anchored'}/>
  </View>;
}

function DownloadsSectionHeading({label, count}: {label: string; count: number}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, marginHorizontal: 20, marginBottom: 6}}>
    <Text accessibilityRole="header" style={[browseType(theme, 17, 700), {color: theme.colors.text}]}>{label}</Text>
    <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{defaultI18n.t('count.titles', {count})}</Text>
  </View>;
}

function DownloadsStorageKey({color, label, size}: {color: string; label: string; size: number}) {
  const theme = useTheme();
  return <View style={{flexDirection: 'row', alignItems: 'center', gap: 6}}>
    <View style={{width: 7, height: 7, borderRadius: 4, backgroundColor: color}}/>
    <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{label}</Text>
    <Text style={[browseType(theme, 13, 400), {color: theme.colors.textTertiary}]}>{defaultI18n.bytes(size)}</Text>
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
  return entry.artworkUrl ? {uri: entry.artworkUrl, cacheKey: JSON.stringify([downloadEntryIdentity(entry), entry.artworkUrl])} : undefined;
}

function DownloadMenuContext({entry, copy}: {entry: OfflineEntry; copy: NativeDownloadsCopy}) {
  const theme = useTheme(), progress = downloadTransferProgress(entry);
  const percent = progress === undefined ? undefined : Math.round(progress * 100);
  return <>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 2, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: alpha(theme.colors.lineStrong, .45)}}>
      <Artwork source={localArtwork(entry)} width={36} height={54} style={{borderRadius: 5}}/>
      <View style={{flex: 1, minWidth: 0}}><Text numberOfLines={1} style={[browseType(theme, 16, 700), {color: theme.colors.text}]}>{entry.title}</Text>
        {entry.state === 'failed' && percent !== undefined && <Text style={[browseType(theme, 13, 600), {color: theme.colors.record, marginTop: 2}]}>{t(copy.stoppedAt, {percent})}</Text>}
      </View>
    </View>
    {entry.state === 'failed' && percent !== undefined && <Text style={[browseType(theme, 13, 400, 0, 19.5), {color: theme.colors.textTertiary, marginTop: 10, marginHorizontal: 20, marginBottom: 2}]}>{t(copy.stoppedHelp, {percent})}</Text>}
  </>;
}

function DownloadRow({entry, device, runtime, copy, separator, menuOpen, onMenu, onPlay, onRetry}: {entry: OfflineEntry; device: NativeOfflineDownloadsDevice; runtime: NativeShellRuntime; copy: NativeDownloadsCopy; separator: boolean; menuOpen: boolean; onMenu: (anchor: RefObject<View | null>) => void; onPlay?: () => void; onRetry: () => void}) {
  const theme = useTheme(), blocked = entry.state === 'ready' ? device.playabilityReason(entry) : null, opener = useRef<View>(null);
  const facts = useDownloadArtwork(device, entry), reading = useReadingFacts(device, entry, entry.state === 'ready' && !blocked);
  const text = downloadRowText(entry, facts, blocked, copy, runtime.text, reading);
  const menu = () => onMenu(opener);
  const playable = entry.state === 'ready' && !blocked, progress = downloadTransferProgress(entry);
  const backdrop = entry.info?.kind === 'episode' ? facts?.backdropUrl : undefined;
  const artwork = backdrop ? {uri: backdrop, cacheKey: JSON.stringify([downloadEntryIdentity(entry), backdrop])} : localArtwork(entry);
  return <View style={{position: 'relative', paddingVertical: 9, paddingLeft: 14, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 13}}>
    {separator && <View style={{position: 'absolute', top: 0, left: 74, right: 0, height: 1, backgroundColor: alpha(theme.colors.lineStrong, .45)}}/>}
    <View style={{flex: 1, minWidth: 0}}>
      <CardFrame title={entry.title} menuAnchorRef={opener} moreExpanded={menuOpen} testID={`download-${encodeURIComponent(entry.id)}`}
        onNavigate={playable && onPlay ? onPlay : menu} onMore={menu} pressableStyle={{flexDirection: 'row', alignItems: 'center', gap: 13}}>
        {() => <>
          <Artwork source={artwork} width={46} height={69} zoom={backdrop ? 2.2 : 1} saturation={backdrop ? .55 : 1} brightness={backdrop ? .45 : 1} style={{borderRadius: 6}}/>
          <View style={{flex: 1, minWidth: 0}}><Text numberOfLines={1} style={[browseType(theme, 15, 700), {color: theme.colors.text}]}>{entry.title}</Text>
            {!!text.metadata.length && <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 2}}>{text.metadata.map((value, index) => <Text key={index} numberOfLines={1} style={[browseType(theme, 12.5, 400, 0, 17.5), {color: theme.colors.textTertiary}]}>{value}</Text>)}</View>}
            {!!text.reason && <Text style={[browseType(theme, 12.5, 400, 0, 17.5), {color: text.stopped ? theme.colors.record : text.warning ? theme.colors.amber : theme.colors.textTertiary, marginTop: 2}]}>{text.reason}</Text>}
            {entry.state === 'downloading' && !entry.waiting && progress !== undefined && <><Text style={[browseType(theme, 12.5, 400, 0, 17.5), {color: theme.colors.textTertiary, marginTop: 2}]}>{t(copy.downloading, {percent: Math.round(100 * progress)})}</Text><View style={{height: 3, backgroundColor: theme.colors.raisedBright, marginTop: 7, borderRadius: 2, overflow: 'hidden'}}><View style={{height: 3, width: `${100 * progress}%`, backgroundColor: theme.colors.accentStrong}}/></View></>}
            {text.stopped && <View style={{height: 37}}/>}
          </View>
        </>}
      </CardFrame>
      {text.stopped && <Chip testID={`download-retry-${encodeURIComponent(entry.id)}`} icon="i-retry" iconSize={14} onPress={onRetry} style={{position: 'absolute', bottom: 0, left: 59, height: 30, paddingHorizontal: 11}} textStyle={browseType(theme, 13, 700)}>{t('action.tryAgain')}</Chip>}
    </View>
    <Focusable testID={`download-action-${encodeURIComponent(entry.id)}`} accessibilityLabel={t(playable ? (entry.kind === 'ebook' || entry.kind === 'comic' ? 'next.cards.read' : 'action.play') : 'card.more', {title: entry.title})}
      disabled={playable && !onPlay} onPress={playable ? onPlay : menu} style={{width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: playable ? theme.colors.text : undefined}}>
      <Icon name={playable ? (entry.kind === 'ebook' || entry.kind === 'comic' ? 'i-book' : 'i-play') : 'i-more'} size={playable ? 16 : 20} color={playable ? theme.colors.ink : theme.colors.textTertiary}/>
    </Focusable>
  </View>;
}
