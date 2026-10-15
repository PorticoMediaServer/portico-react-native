import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useFreshDocument} from '../app/freshness';
import {dependsOn, titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';
import {ScrollView, TVFocusGuideView, View, type LayoutChangeEvent} from 'react-native';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {SearchService, type SearchEntry, type SearchGroup, type SearchGroupResult, type SearchSnapshot} from '../../../../packages/client-core/src/search';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ContentStackParams} from '../app/routes';
import {captionFor, iconFor, progressFor, shapeFor, useArtwork, viewerScope} from '../app/content';
import {useOpenEntry} from '../app/open';
import {useSession} from '../app/session';
import {Artwork, Button, Card, Field, Focusable, ListRow, Notice, Page, PageHeader, Shelf, Skeleton, StateView, Text, WindowedGrid, useTheme, type FocusableHandle, type GridWindow} from '../ui';
import {useServerPreferences} from '../app/server-preferences';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {SEARCH_CHIPS, orderedSearchGroups, searchGroupLabel, topResultKindLabel, topSearchResult, type TopSearchResult} from '../../../../packages/client-core/src/presentation/index';
import {usePullToRefresh} from '../app/refresh';
import {useAppendedPages, useEndReached} from '../app/paging';

const searchDependencies = Object.freeze([dependsOn.libraries, ...titlesWithPersonalState()]);

type Chip = SearchGroup | 'all';

/** The chips, in client-core's authored order (the result sections follow the same order). */
const chips = SEARCH_CHIPS;

const DEBOUNCE_MS = 300;

/** APL-SEARCH-01: recent searches on this device, per viewer (server and profile): another
 * profile never sees them. (The server doesn't publish search history yet.) */
const recentByViewer = new Map<string, string[]>();
function remember(viewer: string, q: string) {
  const value = q.trim();
  if (value.length < 2) return;
  const recent = recentByViewer.get(viewer) ?? [];
  recentByViewer.set(viewer, [value, ...recent.filter(r => r.toLowerCase() !== value.toLowerCase())].slice(0, 8));
}

/** Binds one SearchService to React for the lifetime of the screen. */
function useSearchService() {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new SearchService({api, scope}), [api, scope]);
  // Results on screen follow the libraries: a title that arrives, changes or goes updates its card in place.
  useFreshDocument(searchDependencies, context => service.revalidate(context), () => service.getSnapshot().phase === 'ready');
  const [snapshot, setSnapshot] = useState<SearchSnapshot>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const unsubscribe = service.subscribe(() => setSnapshot(service.getSnapshot()));
    return () => {
      unsubscribe();
      service.dispose();
    };
  }, [service]);
  return {service, snapshot};
}

/**
 * Search: one field, a row of group chips, and server-grouped results. The
 * server owns matching and ranking; this screen only debounces the query,
 * chooses a group, and pages within it.
 */
export function SearchScreen() {
  const navigation = useNavigation();
  const {service, snapshot} = useSearchService();
  const {space, isTV, metrics, colors} = useTheme();
  const [text, setText] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const rememberHistory = useServerPreferences().value<boolean>('search.rememberHistory', true);
  const {session} = useSession();
  const viewer = `${session?.viewer.serverId ?? ''}/${session?.viewer.profileId ?? ''}`;
  // With history off, earlier searches are neither kept nor shown.
  const recent = rememberHistory ? recentByViewer.get(viewer) ?? [] : [];
  const i18n = useI18n();
  const [, setRecentVersion] = useState(0);
  const [, setContentWidth] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const group: SearchGroup | undefined = chip === 'all' ? undefined : chip;

  const submit = useCallback(
    (value: string, selected: SearchGroup | undefined) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // QA: the service validates the query synchronously (it throws over 128 characters); a
      // query it refuses is simply not searched, never an exception inside a timer.
      // Justin: a short query never errors. The server searches 2–128 characters with 1–8 words, at
      // least one of two letters or digits; anything shorter simply waits (the results clear).
      const q = value.trim().slice(0, MAX_QUERY);
      let pending: Promise<void>;
      try { pending = service.select(searchable(q) ? q : '', selected); } catch { return; }
      void pending.then(() => { if (rememberHistory && service.getSnapshot().groups.some(g => g.items.length)) remember(viewer, value); }, () => {});
    },
    [service, rememberHistory, viewer],
  );

  // Debounce typing; group changes apply immediately.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => submit(text, group), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    if (text.trim()) submit(text, group);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group]);

  const onLayout = useCallback((e: LayoutChangeEvent) => setContentWidth(e.nativeEvent.layout.width), []);

  // A total the server only estimated (several words over a large library) is not shown.
  const counts = useMemo(() => new Map(snapshot.groups.flatMap(g => (g.totalCountExact ? [[g.id, g.totalCount] as const] : []))), [snapshot.groups]);

  const query = snapshot.query?.q ?? '';
  const hasQuery = text.trim().length > 0;
  const sections = orderedSearchGroups(snapshot.groups);
  const top = !group && snapshot.phase === 'ready' ? topSearchResult(query, snapshot.groups) : undefined;
  const focused = group ? snapshot.groups.find(s => s.id === group) : undefined;
  const failed = snapshot.groups.filter(s => s.status === 'error');
  const loadingFresh = snapshot.phase === 'loading' && !snapshot.groups.length;
  const groupChip = group ? chips.find(c => c.id === group) : undefined;
  // APL-SYS-08: a narrowed group grows as it scrolls; APL-SYS-07: pull to run the search again.
  const focusedItems = useAppendedPages(`${snapshot.query?.q ?? ''}|${group ?? ''}`, snapshot.pagination.cursor, focused?.items ?? noResults, resultKey);
  const onScroll = useEndReached(() => {
    if (group && focused?.nextCursor && snapshot.phase === 'ready') void service.next(focused.id).catch(() => {});
  });
  const pull = usePullToRefresh(() => (snapshot.query ? service.refresh().catch(() => {}) : undefined), {auto: false});

  // APL-SEARCH-01: the field and chips stay put (with a backing) while results scroll.
  const controls = (
    <View style={{paddingHorizontal: space.page, gap: space.md, paddingTop: isTV ? space.lg : 0, paddingBottom: space.md, marginBottom: space.sm, backgroundColor: isTV ? undefined : colors.ink}}>
      {/* Justin: the platform's own keyboard, with dictation. On TV, selecting the field opens the
          system's full-screen keyboard (Siri Remote dictation, iPhone keyboard continuity). This
          field is the one search input on every device (B-19.19): the separate native search view
          was never mounted and is retired. */}
      {<Field
        value={text}
        onChangeText={setText}
        maxLength={MAX_QUERY}
        placeholder={i18n.t('search.placeholder')}
        autoFocus={!isTV}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        clearButtonMode="while-editing"
        enablesReturnKeyAutomatically
        onSubmitEditing={() => submit(text, group)}
        accessibilityLabel={i18n.t('route.search')}
      />}
      <ChipRow chips={chips.map(c => ({id: c.id, label: i18n.t(c.label)}))} counts={counts} chip={chip} onChip={setChip} />
    </View>
  );
  const pageHeader = isTV ? null : <PageHeader title={i18n.t('route.search')} onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />;
  // A narrowed group can hold thousands of results: it scrolls in the windowed grid, which mounts
  // only the cells on screen (O(visible)), and asks for the next page as its end comes into view.
  const grid = useMemo<GridWindow<SearchEntry>>(() => ({
    ensureRange: (_first, last) => { if (focused?.nextCursor && snapshot.phase === 'ready' && last >= focusedItems.length - 20) void service.next(focused.id).catch(() => {}); },
    slotAt: index => focusedItems[index] ? {kind: 'item', key: resultKey(focusedItems[index]!), item: focusedItems[index]!} : {kind: 'placeholder', key: `pending:${index}`},
    pageOf: index => Math.floor(index / 60),
    subscribePage: (_page, listener) => service.subscribe(listener),
    getPageVersion: () => `${focusedItems.length}:${snapshot.phase}`,
  }), [service, focused, focusedItems, snapshot.phase]);
  const renderResult = useResultCard();
  if (group && focused && focused.items.length) {
    const shape = shapeOf(focused.items[0]);
    const shown = focusedItems.length, total = focused.totalCount;
    return (
      <View style={{flex: 1}} onLayout={onLayout}>
        {pageHeader}
        {isTV ? null : controls}
        <WindowedGrid
          list={grid}
          total={focusedItems.length + (focused.nextCursor ? 60 : 0)}
          itemWidth={cardWidthFor(focused, metrics, isTV)}
          aspect={shape === 'landscape' ? 9 / 16 : shape === 'square' || shape === 'circle' ? 1 : 1.5}
          renderItem={renderResult}
          refreshControl={pull}
          header={<>
            {isTV ? controls : null}
            <View style={{flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: space.page, marginBottom: space.md}}>
              <Text variant="heading" lines={1} style={{flex: 1}}>{i18n.t(searchGroupLabel(focused.id))}</Text>
              {focused.totalCountExact ? <Text variant="caption" tone="tertiary">{total > shown ? i18n.t('web.search.someOf', {shown, total}) : i18n.t('web.search.results', {count: total})}</Text> : null}
            </View>
          </>}
        />
      </View>
    );
  }

  return (
    <View style={{flex: 1}} onLayout={onLayout}>
      <Page keyboardDismissMode="on-drag" stickyHeaderIndices={isTV ? undefined : [1]} refreshControl={pull} onScroll={onScroll} scrollEventThrottle={100}>
        {/* tvOS: no screen header; the system keyboard sits at the top with the chips under it. */}
        {isTV ? <View /> : <PageHeader title={i18n.t('route.search')} onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />}
        {controls}

        {!hasQuery && snapshot.phase === 'idle' && recent.length ? (
          <View style={{paddingHorizontal: space.page, gap: space.xs, marginBottom: space.lg}}>
            <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
              <Text variant="heading">{i18n.t('web.search.recent')}</Text>
              <Button variant="ghost" size="sm" label={i18n.t('web.search.clearRecent')} onPress={() => { recentByViewer.delete(viewer); setRecentVersion(v => v + 1); }} />
            </View>
            {recent.map(r => <ListRow key={r} icon="clock" title={r} onPress={() => setText(r)} />)}
          </View>
        ) : null}
        {!hasQuery && snapshot.phase === 'idle' && !recent.length ? (
          <StateView icon="search" title={i18n.t('web.search.emptyTitle')} message={i18n.t('web.search.emptyBody')} />
        ) : null}

        {snapshot.phase === 'error' ? (
          <Notice tone="error" title={i18n.t('error.title.load', {subject: 'search'})} message={say(snapshot.error, 'search', 'load')} action={i18n.t('action.tryAgain')} onAction={() => void service.retry().catch(() => {})} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
        ) : snapshot.phase === 'refresh-required' ? (
          <Notice tone="warning" message={say(snapshot.error ?? 'stale', 'search', 'load')} action={i18n.t('action.refresh')} onAction={() => void service.refresh().catch(() => {})} style={{marginHorizontal: space.page, marginBottom: space.lg}} />
        ) : null}

        {loadingFresh ? <LoadingResults /> : null}
        {failed.length && snapshot.phase === 'ready' ? <Notice tone="warning" message={i18n.t('web.search.partial', {groups: i18n.list(failed.map(g => i18n.t(searchGroupLabel(g.id))))})} action={i18n.t('action.tryAgain')} onAction={() => void service.refresh().catch(() => {})} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}

        {snapshot.phase === 'ready' && !sections.length ? (
          <StateView icon="search" title={i18n.t('web.search.noMatches', {query})} message={group ? i18n.t('web.search.nothingIn', {group: groupChip ? i18n.t(groupChip.label) : group}) : i18n.t('web.search.noMatchesBody')} action={group ? i18n.t('web.search.everything') : undefined} onAction={group ? () => setChip('all') : undefined} />
        ) : null}

        {top ? <TopResult top={top} /> : null}
        {group ? null : (
          sections.map((section, index) => <GroupShelf key={section.id} section={section} preferFocus={index === 0} onSeeAll={section.totalCount > section.items.length || section.nextCursor ? () => setChip(section.id) : undefined} />)
        )}
      </Page>
    </View>
  );
}


/**
 * The group chips under the field. TV: moving Down from the field lands on the selected chip, not
 * whichever chip is geometrically nearest (a focus guide whose destination is that chip).
 */
function ChipRow({chips, counts, chip, onChip}: {chips: readonly {id: Chip; label: string}[]; counts: ReadonlyMap<string, number>; chip: Chip; onChip: (id: Chip) => void}) {
  const {space, isTV} = useTheme();
  const refs = useRef(new Map<string, FocusableHandle | null>());
  const [target, setTarget] = useState<View | null>(null);
  useEffect(() => {
    if (!isTV) return;
    const node = refs.current.get(chip)?.node?.() ?? null;
    setTarget(prev => (prev === node ? prev : node));
  }, [chip, chips, isTV]);
  const row = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: space.sm, paddingVertical: isTV ? space.sm : 0}} style={isTV ? {marginVertical: -space.sm, overflow: 'visible'} : undefined}>
      {chips.map(item => {
        const count = item.id === 'all' ? undefined : counts.get(item.id);
        const label = count !== undefined && count > 0 ? `${item.label} · ${count}` : item.label;
        return <Button key={item.id} ref={h => { refs.current.set(item.id, h); }} size="sm" variant="secondary" selected={chip === item.id} label={label} onPress={() => onChip(item.id)} />;
      })}
    </ScrollView>
  );
  if (!isTV) return row;
  return <TVFocusGuideView destinations={target ? [target] : undefined} autoFocus={!target}>{row}</TVFocusGuideView>;
}

/** People and channels are search-only entries: they open their own pages rather than an item detail. */
function isContent(entry: SearchEntry): entry is ContentEntry {
  return entry.kind !== 'person' && entry.kind !== 'channel';
}
function shapeOf(entry: SearchEntry | undefined): 'poster' | 'square' | 'landscape' | 'circle' {
  if (!entry) return 'poster';
  if (entry.kind === 'person') return 'circle';
  if (entry.kind === 'channel') return 'landscape';
  // An episode is found by its still, not its show's poster.
  if (entry.kind === 'episode') return 'landscape';
  return shapeFor(entry.kind);
}

function useResultCard() {
  const artwork = useArtwork();
  const open = useOpenEntry();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  return useCallback(
    (entry: SearchEntry, width?: number) => {
      if (!isContent(entry)) {
        const person = entry.kind === 'person';
        return (
          <Card
            title={entry.title}
            subtitle={entry.subtitle}
            source={artwork(entry.posterUrl)}
            shape={person ? 'circle' : 'landscape'}
            width={width}
            icon={entry.posterUrl ? undefined : person ? 'person' : 'live'}
            onPress={() => (person ? navigation.push('Person', {personId: entry.navigation.entityId, name: entry.title}) : navigation.push('Channels', undefined))}
          />
        );
      }
      const shape = shapeOf(entry);
      return (
        <Card
          title={entry.title}
          subtitle={captionFor(entry)}
          watched={entry.watched === true}
          unavailable={entry.available === false}
          source={artwork(shape === 'landscape' ? entry.backdropUrl ?? entry.posterUrl : entry.posterUrl ?? entry.backdropUrl)}
          shape={shape}
          width={width}
          progress={progressFor(entry)}
          icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)}
          onPress={() => open(entry)}
          onLongPress={() => open(entry, 'more')}
        />
      );
    },
    [artwork, open, navigation],
  );
}

/** The one title the words name: its art, what it is, and the way in. */
function TopResult({top}: {top: TopSearchResult}) {
  const {space, colors, metrics, isTV} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const open = useOpenEntry();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const entry = top.entry;
  const content = isContent(entry);
  const shape = shapeOf(entry);
  const go = () => {
    if (content) open(entry);
    else if (entry.kind === 'person') navigation.push('Person', {personId: entry.navigation.entityId, name: entry.title});
    else navigation.push('Channels', undefined);
  };
  const width = isTV ? 160 : 84;
  return (
    <View style={{paddingHorizontal: space.page, marginBottom: space.xl, gap: space.sm}}>
      <Text variant="heading">{i18n.t('search.topResult')}</Text>
      <Focusable accessibilityRole="button" accessibilityLabel={entry.title} radius={metrics.radius.card} onPress={go} onLongPress={content ? () => open(entry, 'more') : undefined}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.lg, padding: space.md, borderRadius: metrics.radius.card, backgroundColor: colors.raised}}>
          <Artwork source={artwork(entry.posterUrl)} shape={shape === 'landscape' ? 'poster' : shape} width={width} title={entry.title} icon={entry.posterUrl ? undefined : content ? iconFor(entry.kind) : 'person'} />
          <View style={{flex: 1, minWidth: 0, gap: space.xs}}>
            <Text variant="title" lines={2}>{entry.title}</Text>
            <Text variant="body" tone="secondary" lines={1}>{[i18n.t(topResultKindLabel(top.group) ?? searchGroupLabel(top.group)), content ? captionFor(entry) : entry.subtitle].filter(Boolean).join(' · ')}</Text>
          </View>
        </View>
      </Focusable>
    </View>
  );
}

function cardWidthFor(section: SearchGroupResult, metrics: ReturnType<typeof useTheme>['metrics'], isTV: boolean): number {
  const shape = shapeOf(section.items[0]);
  return shape === 'landscape' ? metrics.landscapeWidth : shape === 'square' ? metrics.squareWidth : shape === 'circle' ? (isTV ? 150 : 96) : metrics.posterWidth;
}

/** One group as a horizontal row with a See all that narrows to the group. */
function GroupShelf({section, onSeeAll, preferFocus}: {section: SearchGroupResult; onSeeAll?: () => void; preferFocus: boolean}) {
  const {metrics, isTV} = useTheme();
  const i18n = useI18n();
  const renderCard = useResultCard();
  return (
    <Shelf
      title={i18n.t(searchGroupLabel(section.id))}
      data={section.items}
      itemWidth={cardWidthFor(section, metrics, isTV)}
      keyExtractor={e => e.id}
      renderItem={({item}) => renderCard(item)}
      onSeeAll={onSeeAll}
      seeAllLabel={section.totalCount && section.totalCountExact ? i18n.t('shelf.seeAllCount', {count: section.totalCount}) : i18n.t('shelf.seeAll')}
      preferFocus={preferFocus}
    />
  );
}

function LoadingResults() {
  const {space, metrics} = useTheme();
  return (
    <View style={{paddingHorizontal: space.page, gap: space.xl}}>
      {[0, 1].map(row => (
        <View key={row} style={{gap: space.md}}>
          <Skeleton width={160} height={metrics.icon} radius={6} />
          <View style={{flexDirection: 'row', gap: space.gutter}}>
            {[0, 1, 2, 3, 4, 5].map(i => (
              <Skeleton key={i} width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

const noResults: readonly SearchEntry[] = [];
const resultKey = (entry: SearchEntry) => entry.id;

/** The longest query the search service accepts. */
const MAX_QUERY = 128;

/** The server's rule (catalog `NormalizeSearch`): 2–128 characters, 1–8 words, one of them 2+ letters or digits. */
export function searchable(q: string): boolean {
  const text = q.trim().split(/\s+/).join(' ');
  const length = [...text].length;
  if (length < 2 || length > MAX_QUERY) return false;
  const words = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 0 && words.length <= 8 && words.some(w => [...w].length >= 2);
}

