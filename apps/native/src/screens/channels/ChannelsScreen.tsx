import React, {useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore} from 'react';
import {RootHeaderActions} from '../Home';
import {Linking, ScrollView, View, useWindowDimensions} from 'react-native';
import {useRoute} from '@react-navigation/native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {channelOperationId, saveChannelPreference, type GuideChannel} from '../../../../../packages/client-core/src/channel-guide';
import {dedupedGuideApi, forgetGuideReads} from '../../../../../packages/client-core/src/guide/reads';
import {DAY_MS, HOUR_MS, GuideWindowStore, legacyGuideCatalog, legacyChannel, type ChannelSource, type GuideChannelRow, type GuideDataSource} from '../../../../../packages/client-core/src/guide/index';
import {ALL, LIBRARY, RECORDINGS, serverWideReason, channelEntries, channelGuideSource, defaultEntry, newRawIndex, newRequestId, useChannelMemory, useChannelSources, type ChannelEntry, type ChannelSort, type ChannelView, type GuideQuery, type RawIndex, type ServerWideReason} from '../../app/channels';
import {present, say} from '../../app/errors';
import type {Lineup} from '../../player/channel-lineup';
import {usePlayerActions} from '../../app/player-actions';
import {useFreshDocument} from '../../app/freshness';
import {dependsOn} from '../../../../../packages/client-core/src/freshness-hub';
import {useSession} from '../../app/session';
import {Button, Chip, ChipBar, Menu, Sheet, afterOverlaysClose, Notice, PageHeader, Segmented, Skeleton, StateView, showToast, useSpecPlatform, useTheme, type FocusableHandle, type MenuItem} from '../../ui';
import {RecordingsScreen} from '../Recordings';
import {WebHandoff} from '../SettingsPages';
import {ChannelList, ChannelTimeline} from './ChannelList';
import {GuideGrid, type GuideActions, type Selection} from './GuideGrid';
import {ProgramSheet} from './ProgramSheet';
import {GEOMETRY, useGuideFormat} from './format';

/** The guide was brought in again, this profile's recordings changed, or a notice arrived. */
const GUIDE_HINTS = Object.freeze([dependsOn.list('guide'), dependsOn.list('myRecordings'), dependsOn.event('notification.changed')]);

/**
 * Channels (Spec — Channels and Guide §2, §3, §4, §6): one destination organized by source.
 * Opens on All channels with 2+ sources, else the only source; a source picker switches entries
 * (on phones by design; on TV and iPad until the rail lists them). Each entry offers Guide and
 * List, remembered per source. Recordings is its own entry when a live source records.
 */
export function ChannelsScreen() {
  const route = useRoute();
  const param = (route.params as {entry?: string} | undefined)?.entry;
  const {sources, loading, failed, refresh} = useChannelSources();
  const format = useGuideFormat();
  const t = format.t;
  const {session} = useSession();
  const manager = session?.viewer.role === 'owner' || session?.viewer.role === 'admin';
  const entries = useMemo(() => channelEntries(sources), [sources]);
  const [picked, setPicked] = useState<string | undefined>(param);
  useEffect(() => { if (param) setPicked(param); }, [param]);
  const current = picked && entries.some(e => e.id === picked) ? picked : entries.length ? defaultEntry(sources) : undefined;
  const {space} = useTheme();

  if (!current) {
    // §10: the shared error presenter's wording (X-04), with Try again.
    if (failed && !sources.length) { const p = present(new Error('channels'), 'live', {operation: 'load'}); return <Shell><PageHeader title={t('channels.title')} /><StateView icon="warning" title={p.title} message={p.body} action={p.actionLabel ?? t('action.tryAgain')} onAction={refresh} /></Shell>; }
    if (!loading && !sources.length) return <Shell><PageHeader title={t('channels.title')} /><StateView icon="channels" title={t('channels.noSourcesTitle')} message={manager ? t('channels.noSourcesOwner') : t('channels.noSourcesMember')} /></Shell>;
    return <Shell><PageHeader title={t('channels.title')} /><GuideSkeleton /></Shell>;
  }
  const info = entries.find(e => e.id === current)!;
  const picker = entries.length > 1 ? <SourcePicker entries={entries} current={current} onPick={setPicked} /> : null;
  if (current === RECORDINGS) return <RecordingsScreen eyebrow={t('channels.title')} picker={picker ? <View style={{paddingHorizontal: space.page, paddingBottom: space.md}}>{picker}</View> : null} />;
  return <GuideScreen key={current} entry={current} name={info.name} library={info.library} sources={sources} picker={picker} manager={manager} onRecordings={entries.some(e => e.id === RECORDINGS) ? () => setPicked(RECORDINGS) : undefined} />;
}

/** The screen's frame: below the status bar (TV: the overscan-safe top), not scrolling itself. */
function Shell({children}: {children: React.ReactNode}) {
  const insets = useSafeAreaInsets();
  const {isTV, space} = useTheme();
  return <View style={{flex: 1, paddingTop: isTV ? Math.max(insets.top, 60) - space.lg : insets.top}}>{children}</View>;
}

function GuideSkeleton() {
  const {space} = useTheme();
  return <View style={{paddingHorizontal: space.page, gap: space.sm}}>{Array.from({length: 6}).map((_, i) => <View key={i} style={{flexDirection: 'row', gap: space.md}}><Skeleton width={120} height={56} /><View style={{flex: 1}}><Skeleton height={56} /></View></View>)}</View>;
}

/** §2.0: chips for 3 or fewer entries, otherwise a menu titled with the current source ("Antenna ▾"). */
function SourcePicker({entries, current, onPick}: {entries: readonly ChannelEntry[]; current: string; onPick: (id: string) => void}) {
  const format = useGuideFormat();
  const [open, setOpen] = useState(false);
  if (entries.length <= 3) {
    return <ChipBar label={format.t('channels.source')}>{entries.map(e => <Chip key={e.id} label={e.name} icon={e.icon} selected={e.id === current} onPress={() => onPick(e.id)} />)}</ChipBar>;
  }
  const now = entries.find(e => e.id === current);
  return (
    <View style={{flexDirection: 'row'}}>
      <Button variant="secondary" size="sm" icon={now?.icon} trailingIcon="chevronDown" label={now?.name ?? ''} accessibilityLabel={`${format.t('channels.source')}: ${now?.name ?? ''}`} onPress={() => setOpen(true)} />
      <Menu open={open} onClose={() => setOpen(false)} title={format.t('channels.source')} items={entries.map(e => ({id: e.id, label: e.name, icon: e.icon, selected: e.id === current}))} onSelect={onPick} />
    </View>
  );
}

function GuideScreen({entry, name, library, sources, picker, manager, onRecordings}: {entry: string; name: string; library: boolean; sources: readonly ChannelSource[]; picker: React.ReactNode; manager: boolean; onRecordings?: () => void}) {
  const {api, session} = useSession();
  const serverId = session?.viewer.serverId ?? '';
  const format = useGuideFormat();
  const t = format.t;
  const {space, isTV} = useTheme();
  const platform = useSpecPlatform();
  const window = useWindowDimensions();
  const memory = useChannelMemory(entry);
  // §6: the grid on TV, iPad and a landscape phone (≥ 700 pt); phones in portrait list.
  const gridFits = isTV || platform === 'tablet' || window.width >= 700;
  const view: ChannelView = gridFits ? memory.view ?? 'guide' : 'list';
  const geometry = isTV ? GEOMETRY.tv : platform === 'tablet' ? GEOMETRY.tablet : GEOMETRY.phoneLandscape;
  const [filter, setFilter] = useState<{group?: string; favorites?: boolean}>({});
  const [showHidden, setShowHidden] = useState(false);
  const sort = memory.sort;

  // One raw index per screen (tuning, recording and favorites still need the raw guide objects).
  const raw = useMemo<RawIndex>(() => newRawIndex(), []);
  const query = useMemo((): GuideQuery => ({entry, timezone: format.zone, sort, ...(filter.group ? {group: filter.group} : {}), ...(filter.favorites ? {favorites: true} : {}), ...(showHidden ? {includeHidden: true} : {})}), [entry, format.zone, sort, filter.group, filter.favorites, showHidden]);
  const source = useRef<GuideDataSource | null>(null);
  const makeSource = useCallback(() => (source.current = channelGuideSource(api, serverId, query, raw)), [api, serverId, query, raw]);
  const store = useMemo(() => new GuideWindowStore({source: makeSource()}), [api, serverId]); // eslint-disable-line react-hooks/exhaustive-deps
  const firstQuery = useRef(query);
  useEffect(() => {
    if (firstQuery.current === query) return;
    firstQuery.current = query;
    store.reset(makeSource());
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => store.dispose(), [store]);
  // The programmes in view are read again, quietly, when the server brings the guide in again or
  // this profile's recordings change (a programme's recording mark).
  useFreshDocument(GUIDE_HINTS, async context => { await context.settle(); forgetGuideReads(); store.invalidate(); });
  // The grid and list report their viewport once they know the channel count, and the count comes
  // from the first channel page: ask for the top of the guide around now so that page is read.
  useEffect(() => { const now = Date.now(); store.setViewport({firstRow: 0, lastRow: 12, start: now - HOUR_MS, end: now + 3 * HOUR_MS}); }, [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);

  // Groups and favorites of this source, unfiltered (the chips): the top groups by count, plus All.
  const [catalog, setCatalog] = useState<{groups: string[]; favorites: boolean; serverWide: ServerWideReason | null}>({groups: [], favorites: false, serverWide: null});
  useEffect(() => {
    const controller = new AbortController();
    legacyGuideCatalog(dedupedGuideApi(api),serverId,{kind:entry===ALL?'all':entry===LIBRARY?'library-channel':'live-source',sourceId:entry===ALL||entry===LIBRARY?'':entry,timezone:format.zone,sort:'number'},controller.signal).then(summary => {
      const reasons=new Set(summary.unavailableReasons.map(serverWideReason));
      const serverWide:ServerWideReason|null=!reasons.size||reasons.has(null)?null:reasons.has('platform')?'platform':reasons.has('tools')?'tools':'delivery';
      if(!controller.signal.aborted)setCatalog({groups:[...summary.groups],favorites:summary.favorites,serverWide});
    }, () => {});
    return () => controller.abort();
  }, [api, serverId, entry, format.zone, snapshot.total === undefined]); // eslint-disable-line react-hooks/exhaustive-deps

  const [selection, setSelection] = useState<Selection | null>(null);
  const [menuFor, setMenuFor] = useState<GuideChannelRow | null>(null);
  const [timeline, setTimeline] = useState<GuideChannelRow | null>(null);
  const [sortMenu, setSortMenu] = useState(false);
  const player = usePlayerActions();
  const watch = useCallback((channel: GuideChannelRow) => {
    const rawChannel = raw.channels.get(channel.id);
    // FEAT-07: the player steps through this guide's channels, in its order and filters.
    const from = source.current;
    const lineup:Lineup|undefined = from ? Object.assign(async () => [] as readonly GuideChannel[], {
      step: async (current:GuideChannel,delta:1|-1) => {
        const row:GuideChannelRow={id:current.id,sourceId:current.provenance==='library-channel'?'library':current.sourceId,kind:current.provenance==='library-channel'?'library':'live',number:current.number,name:current.name,group:current.group,favorite:current.favorite,tuneAvailable:current.tuneAvailable,recordAvailable:current.recordAvailable,guide:'full',native:current};
        const next=await from.neighbor?.(row,delta,new AbortController().signal);
        return next?legacyChannel(next):undefined;
      },
    }) : undefined;
    if (rawChannel && channel.tuneAvailable) player.tune(rawChannel, lineup);
  }, [raw, player]);
  const setPreference = useCallback(async (channel: GuideChannelRow, values: {favorite: boolean; hidden: boolean}) => {
    const c = raw.channels.get(channel.id);
    if (!c) return;
    try {
      await saveChannelPreference(api, serverId, c, await channelOperationId(newRequestId), values);
      forgetGuideReads();
      store.reset(makeSource());
    } catch (e) { showToast({message: say(e, 'live', 'save'), icon: 'warning'}); }
  }, [api, serverId, raw, store, makeSource]);

  const range = useMemo(() => {
    const scoped = entry === ALL ? sources : sources.filter(x => x.id === entry);
    const starts = scoped.map(x => x.availableStart).filter((v): v is number => !!v);
    const ends = scoped.map(x => x.availableEnd).filter((v): v is number => !!v);
    const now = Date.now();
    return {start: Math.min(now - DAY_MS, ...(starts.length ? [Math.min(...starts)] : [])), end: Math.max(now + 3 * HOUR_MS, ...(ends.length ? [Math.max(...ends)] : [now + 7 * DAY_MS]))};
  }, [sources, entry]);

  // FEAT-01: when the whole server can't play channels, one notice explains it and rows stay plain.
  const quiet = catalog.serverWide !== null;
  const actions: GuideActions = useMemo(() => ({store, format, sources, entry, onOpen: setSelection, onWatch: watch, onChannelMenu: setMenuFor, quiet}), [store, format, sources, entry, watch, quiet]);
  const channelMenu = (channel: GuideChannelRow): MenuItem[] => {
    const hidden = raw.channels.get(channel.id)?.hidden ?? false;
    return [
      {id: 'fav', label: channel.favorite ? t('channels.removeFavorite') : t('channels.addFavorite'), icon: channel.favorite ? 'starFilled' : 'star'},
      ...(manager ? [{id: 'hide', label: hidden ? t('channels.unhide') : t('channels.hide'), icon: (hidden ? 'eye' : 'eyeOff') as MenuItem['icon']}] : []),
    ];
  };
  const onChannelMenu = (channel: GuideChannelRow, id: string) => {
    const hidden = raw.channels.get(channel.id)?.hidden ?? false;
    if (id === 'fav') void setPreference(channel, {favorite: !channel.favorite, hidden});
    else if (id === 'hide') void setPreference(channel, {favorite: channel.favorite, hidden: !hidden});
  };

  const filterName = filter.favorites ? t('channels.favorites') : filter.group ?? '';
  // §10: a source whose guide refresh is behind says so above the guide.
  const stale = (entry === ALL ? sources : sources.filter(x => x.id === entry)).some(x => x.guideState === 'stale');
  const controlsTop = useRef<FocusableHandle>(null);
  const [box, setBox] = useState({width: 0, height: 0});

  const header = (
    <View style={{gap: space.sm, paddingBottom: space.sm}}>
      <PageHeader
        eyebrow={t('channels.title')}
        title={name}
        // The same Search, bell and account buttons as every other tab, after the Guide/List switch.
        actions={<RootHeaderActions extra={gridFits ? <Segmented accessibilityLabel={t('channels.view')} items={[{id: 'guide', label: t('channels.viewGuide')}, {id: 'list', label: t('channels.viewList')}]} selected={view} onSelect={id => memory.setView(id as ChannelView)} /> : undefined} />}
        style={{paddingBottom: space.xs}}
      />
      {picker ? <View style={{paddingHorizontal: space.page}}>{picker}</View> : null}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.page, paddingRight: space.page}}>
        {/* §2.2: one row of chips that scrolls sideways. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex: 1, minWidth: 0}}>
          <ChipBar label={t('channels.filters')} style={{flexWrap: 'nowrap'}}>
            <Chip label={t('channels.filterAll')} selected={!filter.group && !filter.favorites} onPress={() => setFilter({})} />
            {catalog.favorites || filter.favorites ? <Chip label={t('channels.favorites')} icon="starFilled" selected={!!filter.favorites} onPress={() => setFilter(f => ({favorites: !f.favorites}))} /> : null}
            {catalog.groups.map(g => <Chip key={g} label={g} selected={filter.group === g} onPress={() => setFilter(f => ({group: f.group === g ? undefined : g}))} />)}
          </ChipBar>
        </ScrollView>
        <Button variant="ghost" size="sm" icon="sort" label={sort === 'name' ? t('channels.sortName') : t('channels.sortNumber')} accessibilityLabel={`${t('channels.sort')}: ${sort === 'name' ? t('channels.sortName') : t('channels.sortNumber')}`} onPress={() => setSortMenu(true)} />
      </View>
      {stale ? <View style={{paddingHorizontal: space.page}}><Notice tone="warning" message={t('guide.stale')} /></View> : null}
      {catalog.serverWide ? <View style={{paddingHorizontal: space.page}}><ServerWideNotice reason={catalog.serverWide} manager={manager} /></View> : null}
    </View>
  );

  let body: React.ReactNode;
  if (snapshot.total === undefined && snapshot.channelsError) { const p = present(new Error('channels'), 'live', {operation: 'load'}); body = <StateView icon="warning" title={p.title} message={p.body} action={p.actionLabel ?? t('action.tryAgain')} onAction={() => store.retry()} />; }
  else if (snapshot.total === 0) {
    body = filterName
      ? <StateView icon="filter" title={t('channels.filterEmptyTitle', {filter: filterName})} action={t('channels.showAll')} onAction={() => setFilter({})} />
      : <StateView icon={library ? 'library' : 'channels'} title={t('channels.emptyTitle', {source: name})} message={manager ? t('channels.emptyOwner') : t('channels.emptyMember')} action={manager ? t('channels.refreshNow') : undefined} onAction={manager ? () => { forgetGuideReads(); store.reset(makeSource()); } : undefined} />;
  } else if (snapshot.total === undefined) body = <GuideSkeleton />;
  else if (view === 'guide') body = box.width > 0 ? <GuideGrid actions={actions} geometry={geometry} range={range} width={box.width} height={box.height} controlsTop={controlsTop} paused={!!selection || !!menuFor} /> : null;

  const overlays = (
    <>
      {selection ? <ProgramSheet selection={selection} format={format} raw={raw} sources={sources} showSource={entry === ALL} quiet={quiet} onClose={() => setSelection(null)} onWatch={s => watch(s.channel)} onChanged={() => { forgetGuideReads(); store.invalidate(); }} onFavorite={s => void setPreference(s.channel, {favorite: !s.channel.favorite, hidden: raw.channels.get(s.channel.id)?.hidden ?? false})} onRecordings={onRecordings} /> : null}
      <Menu open={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor?.name} subtitle={menuFor?.number ? t('channels.channel', {number: menuFor.number}) : undefined} items={menuFor ? channelMenu(menuFor) : []} onSelect={id => { if (menuFor) onChannelMenu(menuFor, id); }} />
      <Menu
        open={sortMenu}
        onClose={() => setSortMenu(false)}
        title={t('channels.sort')}
        items={[
          {id: 'number', label: t('channels.sortNumber'), selected: sort === 'number'},
          {id: 'name', label: t('channels.sortName'), selected: sort === 'name'},
          ...(manager ? [{id: 'hidden', label: t('channels.showHidden'), selected: showHidden, section: ''}] : []),
        ]}
        onSelect={id => { if (id === 'hidden') setShowHidden(v => !v); else memory.setSort(id as ChannelSort); }}
      />
      {source.current ? <ChannelTimeline channel={timeline} source={source.current} format={format} range={range} onClose={() => setTimeline(null)} onOpen={program => {
        // One overlay at a time: the timeline closes, then the program sheet opens.
        const channel = timeline;
        setTimeline(null);
        if (channel) requestAnimationFrame(() => afterOverlaysClose(() => setSelection({channel, program})));
      }} onWatch={watch} /> : null}
    </>
  );

  // The list scrolls with its header; the grid fills the screen under a fixed header.
  if (view === 'list' && snapshot.total) {
    return (
      <Shell>
        <ChannelList actions={actions} header={header} onTimeline={platform === 'phone' ? setTimeline : undefined} />
        {overlays}
      </Shell>
    );
  }
  return (
    <Shell>
      {header}
      <View style={{flex: 1}} onLayout={e => { const {width, height} = e.nativeEvent.layout; setBox(b => (b.width === width && b.height === height ? b : {width, height})); }}>
        {body}
      </View>
      {overlays}
    </Shell>
  );
}


/**
 * FEAT-01: one calm explanation when the server itself can't play channels. Owners and admins get
 * the way to fix it: the server's Live TV settings, opened in the browser (a QR code on TV).
 */
function ServerWideNotice({reason, manager}: {reason: ServerWideReason; manager: boolean}) {
  const format = useGuideFormat();
  const t = format.t;
  const {isTV} = useTheme();
  const {serverUrl, session, hostedUrl} = useSession();
  const [handoff, setHandoff] = useState(false);
  const base = (session?.viewer.authority === 'hosted' ? hostedUrl : serverUrl ?? '').replace(/\/$/, '');
  const url = base ? `${base}/server/live-tv` : '';
  const body = !manager ? t('web.live.serverWide.memberBody') : reason === 'platform' ? t('web.live.serverWide.platformBody') : reason === 'tools' ? t('web.live.serverWide.toolsBody') : t('web.live.serverWide.deliveryBody');
  const open = () => {
    if (isTV) { setHandoff(true); return; }
    Linking.openURL(url).catch(() => showToast({message: t('link.openFailed', {address: url.replace(/^https?:\/\//, '')}), icon: 'warning'}));
  };
  return (
    <>
      <Notice tone="info" title={t('web.live.serverWide.title')} message={body} action={manager && url ? t('channels.serverWide.ownerAction') : undefined} onAction={manager && url ? open : undefined} />
      {isTV && url ? (
        <Sheet open={handoff} onClose={() => setHandoff(false)} title={t('channels.serverWide.ownerAction')} kind="form" cancelLabel={null} primary={{label: t('action.done'), onPress: () => setHandoff(false)}}>
          <WebHandoff url={url} title={t('channels.serverWide.ownerHint')} />
        </Sheet>
      ) : null}
    </>
  );
}
