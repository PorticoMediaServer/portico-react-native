import React, {useEffect, useId, useMemo, useRef, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import Svg, {Defs, LinearGradient, Rect, Stop} from 'react-native-svg';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {SearchEntry, SearchGroup} from '../../../../../packages/client-core/src/search';
import {cardText} from '../../../../../packages/client-core/src/presentation/kit-model';
import {orderedSearchGroups, SEARCH_CHIPS, searchGroupLabel, topSearchResult, topResultKindLabel} from '../../../../../packages/client-core/src/presentation/search-model';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {Artwork} from '../../kit/artwork';
import {Chip, Focusable} from '../../kit/controls';
import {ArtFrame, CardFrame, Parts, Progress} from '../../kit/cards/primitives';
import {FocusRegion} from '../../kit/focus';
import {Icon} from '../../kit/Icon';
import {StateView} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import {nativeDestinationFocusIds, type NativeDestinationActivationPort} from '../destinations/focus';
import {homeSubject} from '../home/model';
import {NativeSearchDestination, nativeSearchEntryKey} from './model';
import {SearchGridCard} from './SearchGridCard';
import {NativeTVKeyboard} from './TVKeyboard';
import type {NativeSearchActions, NativeSearchExplorePort, NativeSearchGenre, NativeSearchSelectionPort, NativeSearchTVCopy} from './types';

const t = defaultI18n.t;
const media = (entry: SearchEntry): entry is ContentEntry => entry.kind !== 'person' && entry.kind !== 'channel';
export type NativeTVSearchScreenProps = Readonly<{
  destination: NativeSearchDestination; runtime: NativeShellRuntime; activation: NativeDestinationActivationPort;
  explore: NativeSearchExplorePort; actions: NativeSearchActions; selection?: NativeSearchSelectionPort; copy: NativeSearchTVCopy;
}>;

/** The actual Search destination keeps its own service, IDs and navigation intent.
 * Only the shared keyboard requests entry focus; result arrival never moves it. */
export function TVSearchScreen({destination, runtime, activation, explore, actions, selection, copy}: NativeTVSearchScreenProps) {
  const theme = useTheme(), dimensions = useWindowDimensions(), scroll = useRef<ScrollView>(null);
  const state = useSyncExternalStore(destination.subscribe, destination.getSnapshot), landing = useSyncExternalStore(explore.subscribe, explore.getSnapshot);
  const active = useSyncExternalStore(activation.subscribe, activation.getSnapshot), authority = runtime.getSnapshot().authority;
  const ids = useMemo(() => nativeDestinationFocusIds(authority), [authority]);
  const typed = !!state.text.trim(), groups = orderedSearchGroups(state.groups);
  const empty = typed && state.search.phase === 'ready' && groups.every(group => group.status === 'success' && group.totalCount === 0);
  const top = state.group === 'all' ? topSearchResult(state.text, groups) : undefined;
  const shown = groups.filter(group => (state.group === 'all' || state.group === group.id) && (group.items.length > 0 || group.status === 'error'));
  const firstEntry = shown.flatMap(group => group.items.map(entry => ({entry, group: group.id})))[0];
  const firstResult = top ? nativeSearchEntryKey(top.group, top.entry) : firstEntry ? nativeSearchEntryKey(firstEntry.group, firstEntry.entry)
    : landing.genres[0] ? `genre:${landing.genres[0].id}` : state.recent[0] ? `recent:${state.recent[0].q}` : undefined;
  const chips = SEARCH_CHIPS.filter(chip => chip.id === 'all' || state.search.data?.capabilities.groups.some(group => group.id === chip.id && group.available)
    && groups.some(group => group.id === chip.id && (group.status !== 'success' || group.totalCount > 0)));
  useEffect(() => runtime.registerScrollToTop({kind: 'search'}, () => scroll.current?.scrollTo({y: 0, animated: !theme.reduceMotion})), [runtime, theme.reduceMotion]);
  const run = (work: Promise<void>) => {void work.catch(runtime.reportError);};
  const problem = state.problem === 'long' ? t('web.search.tooLong') : state.problem === 'words' ? t('web.search.tooManyWords') : state.problem ? t('web.search.tooShort') : undefined;
  const resultsWidth = Math.max(0, dimensions.width - 780 - 72);
  return <View testID="native-tv-search-screen" pointerEvents={active.visible ? 'auto' : 'none'} accessibilityElementsHidden={!active.visible}
    importantForAccessibility={active.visible ? 'auto' : 'no-hide-descendants'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View testID="tv-search-query" accessibilityLabel={t('web.shell.search')} style={{position: 'absolute', left: theme.gutter, top: 64, width: 500, height: 80, borderRadius: 16,
      backgroundColor: alpha(theme.colors.text, .08), paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 16}}>
      <Icon name="i-search" size={32} color={theme.colors.textTertiary}/>
      <Text numberOfLines={1} style={[browseType(theme, 34, 700), {color: theme.colors.text, flexShrink: 1}]}>{state.text || t('web.search.placeholder')}</Text>
      {typed && <View style={{width: 3, height: 40, marginLeft: -12, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/>}
    </View>
    <View style={{position: 'absolute', left: theme.gutter, top: 176}}><NativeTVKeyboard id={ids.searchKeyboard} value={state.text}
      onChangeText={value => destination.setText(value)} activation={active} leftRegionId={ids.rail} rightRegionId={ids.searchResults}/></View>
    {!empty && <View style={{position: 'absolute', left: theme.gutter, top: 792, width: 500, flexDirection: 'row', alignItems: 'flex-start', gap: 18}}>
      <View style={{width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: alpha(theme.colors.text, .08)}}><Icon name="i-mic" size={28} color={theme.colors.textSecondary}/></View>
      <Text style={[browseType(theme, 20, 400, 0, 29), {color: theme.colors.textTertiary, flex: 1}]}><Text style={[browseType(theme, 20, 700), {color: theme.colors.textSecondary}]}>{t(copy.preferToTalk)}</Text>{' '}{t(copy.voiceHint)}</Text>
    </View>}
    <FocusRegion id={ids.searchResults} entry={firstResult} enabled={active.visible} edges={{left: ids.searchKeyboard}}
      style={{position: 'absolute', left: 780, right: 72, top: 64, bottom: 0}}>
      <ScrollView ref={scroll} contentContainerStyle={{paddingBottom: 72}} scrollEventThrottle={100} onScroll={event => {
        if (state.group === 'all' || state.search.phase !== 'ready') return;
        const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        const group = groups.find(value => value.id === state.group);
        if (group?.nextCursor && contentOffset.y + layoutMeasurement.height >= contentSize.height - 600) run(destination.next(group.id));
      }}>
        {typed && !empty && !problem && !!state.search.data && <View style={{flexDirection: 'row', gap: 12}}>{chips.map(chip => {
          const group = groups.find(value => value.id === chip.id);
          const count = chip.id === 'all' ? groups.every(value => value.totalCountExact) ? groups.reduce((sum, value) => sum + value.totalCount, 0) : undefined : group?.totalCountExact ? group.totalCount : undefined;
          return <Chip key={chip.id} focusId={`chip:${chip.id}`} testID={`tv-search-chip-${chip.id}`} selected={state.group === chip.id} count={count} retry={group?.status === 'error'}
            disabled={!active.visible} onPress={() => destination.selectGroup(chip.id)}>{t(chip.label)}</Chip>;
        })}</View>}
        {state.search.error && <StateView {...runtime.error(state.search.error, () => run(destination.retry()))}/>}
        {problem && <StateView variant="search" title={problem}/>}
        {empty && <View><Text accessibilityRole="header" style={[browseType(theme, 52, 800, -.04, 54.6), {color: theme.colors.text, marginBottom: 14}]}>{t('next.states.noMatches', {query: state.text.trim()})}</Text>
          <Text style={[browseType(theme, 26, 400), {color: theme.colors.textSecondary, marginBottom: 54}]}>{t('next.states.noMatchesBody')}</Text></View>}
        {(!typed || empty) && <>
          <Text accessibilityRole="header" style={[browseType(theme, 32, 700, -.019), {color: theme.colors.text, marginBottom: 22}]}>{t(empty ? landing.emptyHeading : landing.initialHeading)}</Text>
          {landing.phase === 'error' && <StateView {...runtime.error(landing.error, () => run(explore.load()))}/>}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 26}}>{landing.genres.map(genre => <TVSearchGenre key={genre.id} genre={genre} width={(resultsWidth - 26) / 2}
            disabled={!active.visible} runtime={runtime} onPress={() => explore.openGenre(genre)}/>)}</View>
          {!typed && !!state.recent.length && <View style={{marginTop: 36}}><Text accessibilityRole="header" style={[browseType(theme, 32, 700), {color: theme.colors.text, marginBottom: 16}]}>{t('web.search.recent')}</Text>
            {state.recent.map(recent => <Focusable key={recent.q} focusId={`recent:${recent.q}`} disabled={!active.visible} onPress={() => destination.useRecent(recent.q)}
              style={{flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64}}><Icon name="i-clock" size={26} color={theme.colors.textTertiary}/><Text style={[browseType(theme, 24, 600), {color: theme.colors.textSecondary}]}>{recent.q}</Text></Focusable>)}</View>}
        </>}
        {top && <TVSearchTopResult entry={top.entry} group={top.group} runtime={runtime} actions={actions} selection={selection?.item(top.group, top.entry)} disabled={!active.visible}/>}
        {typed && !empty && !problem && shown.map(group => <View key={group.id} style={{marginTop: 42}}>
          <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 14}}><Text accessibilityRole="header" style={[browseType(theme, 32, 700, -.019), {color: theme.colors.text}]}>{t(searchGroupLabel(group.id))}</Text>
            {group.totalCountExact && <Text style={[browseType(theme, 20, 600), {color: theme.colors.textTertiary}]}>{group.totalCount}</Text>}</View>
          {group.status === 'error' && <StateView {...runtime.error({code: group.errorCode}, () => run(destination.retry()))}/>}
          <View style={{flexDirection: 'row', flexWrap: state.group === 'all' ? undefined : 'wrap', gap: 28, marginTop: 30}}>
            {group.items.slice(0, state.group === 'all' ? 4 : group.items.length).map(entry => <SearchGridCard key={nativeSearchEntryKey(group.id, entry)} entry={entry} group={group.id} width={196}
              runtime={runtime} actions={actions} selection={selection?.item(group.id, entry)} disabled={!active.visible}/>)}</View>
        </View>)}
      </ScrollView>
    </FocusRegion>
    {selection?.render()}
  </View>;
}

function TVSearchGenre({genre, runtime, width, disabled, onPress}: {genre: NativeSearchGenre; runtime: NativeShellRuntime; width: number; disabled: boolean; onPress: () => void}) {
  const theme = useTheme(), gradient = useId();
  return <Focusable focusId={`genre:${genre.id}`} testID={`tv-search-genre-${encodeURIComponent(genre.id)}`} disabled={disabled} onPress={onPress}
    accessibilityLabel={genre.name} focusRadius={16} style={{width, height: 200, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
    <Artwork source={runtime.artwork(genre.backdropPath)} width={width} height={200}/>
    <Svg pointerEvents="none" width={width} height={200} style={{position: 'absolute', inset: 0}}><Defs><LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={theme.colors.ink} stopOpacity={.88}/><Stop offset=".55" stopColor={theme.colors.ink} stopOpacity={.5}/><Stop offset="1" stopColor={theme.colors.ink} stopOpacity={.15}/></LinearGradient></Defs><Rect width={width} height={200} fill={`url(#${gradient})`}/></Svg>
    <View style={{position: 'absolute', left: 30, bottom: 26}}><Text style={[browseType(theme, 36, 800, -.025), {color: theme.colors.text}]}>{genre.name}</Text>
      <Text style={[browseType(theme, 20, 400), {color: theme.colors.textSecondary, marginTop: 4}]}>{t('next.selection.titles', {count: genre.count})}</Text></View>
  </Focusable>;
}

function TVSearchTopResult({entry, group, runtime, actions, selection, disabled}: Pick<NativeTVSearchScreenProps, 'runtime' | 'actions'> & {entry: SearchEntry; group: SearchGroup; selection?: ReturnType<NativeSearchSelectionPort['item']>; disabled: boolean}) {
  const theme = useTheme(), anchor = useRef<View>(null), content = media(entry) ? entry : undefined, kind = topResultKindLabel(group);
  const text = content && cardText(homeSubject(content), 'search', runtime.text), title = content?.displayTitle || entry.title;
  return <CardFrame focusId={nativeSearchEntryKey(group, entry)} testID="tv-search-top-result" title={title} disabled={disabled} selection={selection}
    menuAnchorRef={anchor} moreExpanded={actions.isMenuOpen?.(entry, group)} onNavigate={() => actions.open(entry, group)} onMore={() => actions.menu(entry, group, anchor)}
    style={{marginTop: 44}} pressableStyle={{flexDirection: 'row', gap: 36, alignItems: 'center'}}>
    {state => <><ArtFrame width={480} height={270} radius={14} focused={state.focused} hovered={state.hovered} holding={state.holding} selected={selection?.selected}>
      <Artwork source={runtime.artwork(content?.backdropUrl ?? entry.posterUrl)} width={480} height={270}/></ArtFrame>
      <View style={{flex: 1}}><Text style={[browseType(theme, 20, 700), {color: theme.colors.accentStrong, marginBottom: 10}]}>{t('search.topResult')}</Text>
        <Text numberOfLines={3} style={[browseType(theme, 52, 800, -.04, 52), {color: theme.colors.text, marginBottom: 14}]}>{title}</Text>
        <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 16, marginBottom: 14}}>{content?.year !== undefined && <Text style={[browseType(theme, 20, 700), {color: theme.colors.textSecondary}]}>{content.year}</Text>}
          {kind && <Text style={[browseType(theme, 20, 600), {color: theme.colors.textSecondary}]}>{t(kind)}</Text>}
          {text && <Parts parts={text.caption.filter(part => part.id !== 'year')} style={browseType(theme, 20, 600)}/>}</View>
        {!!content?.duration && content.progressSeconds !== undefined && <Progress value={content.progressSeconds / content.duration} style={{width: 180, marginBottom: 10}}/>}
        {text && <Parts parts={text.detail} style={browseType(theme, 20, 600)}/>}</View></>}
  </CardFrame>;
}
