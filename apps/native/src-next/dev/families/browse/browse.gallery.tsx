import React, {useEffect, useMemo, useState} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n, formatMessage, type MessageId} from '../../../../../../packages/i18n/src';
import {browseNativeFixtures} from '../../../../../../packages/i18n/src/catalog/en-US/next/dev/browse-native-fixtures';
import {appliedFilterParts, browseToolbarModel, cardText, type AppliedFilter, type CardSubject} from '../../../../../../packages/client-core/src/presentation/kit-model';
import type {BrowseCapabilities, BrowseFieldCapability, BrowseNode, BrowseSortSelection} from '../../../../../../packages/client-core/src/browse';
import {createWindowedCollection} from '../../../../../../packages/client-core/src/collections';
import {Artwork, AmbientArt, type AmbientArtSource} from '../../../kit/artwork';
import {Button, Tabs} from '../../../kit/controls';
import {BottomSheet, Dialog, Menu, OverlaysProvider, SidePanel} from '../../../kit/overlays';
import {SelectionCircle} from '../../../kit/selection';
import {BrowseToolbar, FilterBuilder, FilteredEmpty, LibraryHeader, LibraryMenu, LibrarySwitcher, SongRow, SortMenu, StickyBrowseHeader, TrackTable, type BrowseLabels, type FilterFieldState, type FilterFieldValue, type TrackRowData, type TrackSelection} from '../../../kit/browse';
import {useTheme} from '../../../kit/theme';
import type {Gallery} from '../../gallery-registry';

const t = defaultI18n.t;
const fixture = (id: keyof typeof browseNativeFixtures) => formatMessage(browseNativeFixtures[id]);
// Metadata from the approved reference library, never imported into production.
const movies = fixture('library.movies'), shows = fixture('library.shows'), anime = fixture('library.anime'), music = fixture('library.music'), audiobooks = fixture('library.audiobooks');
const genres = (['genre.action', 'genre.adventure', 'genre.animation', 'genre.comedy', 'genre.crime', 'genre.drama', 'genre.family', 'genre.fantasy', 'genre.horror', 'genre.scifi'] as const).map(fixture);
const counts = [21, 24, 16, 14, 12, 30, 13, 15, 6, 22];
const afterHours = fixture('album.afterHours'), weeknd = fixture('artist.weeknd');
const songNames = (['song.aloneAgain', 'song.tooLate', 'song.hardestToLove', 'song.scaredToLive'] as const).map(fixture);
const chapterNames = (['chapter.boy', 'chapter.glass', 'chapter.letters', 'chapter.keeper', 'chapter.diagon', 'chapter.journey'] as const).map(fixture);
const sourceOrigin = 'http://100.120.50.24:8787';
const art = {uri: `${sourceOrigin}/assets/pool/albums/after-hours.jpg`, cacheKey: 'approved-reference:after-hours'};
const libraryChoices = [
  {id: 'movies', name: movies, count: t('lib.count', {count: 80, pivot: 'movies'})},
  {id: 'shows', name: shows, count: t('lib.count', {count: 24, pivot: 'shows'})},
  {id: 'anime', name: anime, count: t('lib.count', {count: 8, pivot: 'shows'})},
  {id: 'music', name: music, count: t('lib.count', {count: 10, pivot: 'albums'})},
  {id: 'audiobooks', name: audiobooks, count: t('lib.count', {count: 8, pivot: 'books'})},
];
const field = (id: string, type: BrowseFieldCapability['type'], controlHint: BrowseFieldCapability['controlHint'], operators: BrowseFieldCapability['operators'], allowedValues?: readonly string[]): BrowseFieldCapability => ({id, type, controlHint, operators, allowedValues, labelKey: `filter.field.${id}`, complexity: 'quick', cost: 'indexed', applicableKinds: ['movie']});
const capability: BrowseCapabilities = {
  library: {id: 'reference-movies', name: movies, kind: 'movie', defaultView: 'discover', pinned: false}, pivots: [], resolvedPivot: null,
  fields: [field('genre', 'string', 'facet-multi-select', ['contains-any', 'contains-all', 'not-in']), field('year', 'number', 'number-range', ['between', 'at-least', 'at-most']), field('decade', 'enum', 'facet-multi-select', ['in', 'not-in']), field('contentRating', 'enum', 'facet-multi-select', ['in', 'not-in']), field('studio', 'string', 'facet-multi-select', ['in', 'not-in']), field('collection', 'string', 'facet-multi-select', ['contains-any', 'contains-all', 'not-in']), field('tag', 'string', 'facet-multi-select', ['contains-any', 'contains-all', 'not-in']), field('playState', 'enum', 'select', ['equals'], ['unplayed', 'in-progress', 'played']), field('favorite', 'boolean', 'toggle', ['equals']), field('watchlisted', 'boolean', 'toggle', ['equals']), field('dateAdded', 'date', 'date-range', ['at-least', 'at-most', 'between']), field('actor', 'string', 'text', ['contains']), field('resolution', 'enum', 'facet-multi-select', ['in', 'not-in']), field('audioLanguage', 'enum', 'select', ['in', 'not-in'], ['en', 'fr'])],
  sorts: ['title', 'added', 'year', 'duration', 'communityRating', 'personalRating', 'forYou', 'lastPlayed', 'releaseDate', 'criticRating', 'fileSize', 'resolution', 'random', 'playCount'].map(id => ({id, labelKey: `sort.${id}`, directions: id === 'forYou' ? ['desc'] : ['asc', 'desc'], defaultDirection: id === 'title' || id === 'random' ? 'asc' : 'desc', expensive: id === 'forYou', seeded: id === 'random', applicableKinds: ['movie']})),
  quickFilters: [{id: 'unwatched', labelKey: 'filter.quick.unwatched', query: {field: 'playState', operator: 'equals', value: 'unplayed'}}, {id: 'watched', labelKey: 'filter.quick.played', query: {field: 'playState', operator: 'equals', value: 'played'}}, {id: 'in-progress', labelKey: 'filter.quick.inProgress', query: {field: 'playState', operator: 'equals', value: 'in-progress'}}, {id: 'favorites', labelKey: 'filter.quick.favorites', query: {field: 'favorite', operator: 'equals', value: true}}, {id: 'watchlist', labelKey: 'filter.quick.watchlist', query: {field: 'watchlisted', operator: 'equals', value: true}}],
  queryLimits: {maximumDepth: 5, maximumClauses: 40, maximumBytes: 65536, maximumSorts: 1, defaultLimit: 40, maximumLimit: 100, cursorTtlMs: 1800000},
};
const fieldNames: Record<string, MessageId> = {genre: 'filter.field.genre', year: 'filter.field.year', decade: 'filter.field.year', contentRating: 'filter.field.contentRating', studio: 'filter.field.studio', collection: 'filter.field.collection', tag: 'filter.field.tag', playState: 'filter.field.playState', favorite: 'filter.field.favorite', watchlisted: 'filter.field.watchlisted', dateAdded: 'filter.field.dateAdded', actor: 'filter.field.actor', resolution: 'filter.field.resolution', audioLanguage: 'filter.field.audioLanguage'};
const sortNames: Record<string, MessageId> = {title: 'filter.field.title', added: 'filter.field.dateAdded', year: 'filter.field.year', duration: 'filter.field.duration', communityRating: 'filter.field.audienceRating', personalRating: 'filter.field.yourRating', forYou: 'sort.forYou', lastPlayed: 'filter.field.lastPlayed', releaseDate: 'sort.releaseDate', criticRating: 'sort.criticRating', fileSize: 'sort.fileSize', resolution: 'sort.resolution', random: 'sort.random', playCount: 'sort.playCount'};
const labels: BrowseLabels = {field: f => t(fieldNames[f.id]), sort: s => t(sortNames[s.id]), quick: q => t(q.labelKey as MessageId)};

/** Root binds real versioned ambient sources privately after the contract-server update. */
declare global {var __porticoBrowseEvidence: {ambient?: readonly AmbientArtSource[]} | undefined;}

export type BrowsePickerSlot = (props: {
  id: string; label: string; state: FilterFieldState; onChange: (value: FilterFieldValue) => void; onClose: () => void;
}) => React.ReactNode;

function RowSelectionControl({row, selected, onPress}: {row: TrackRowData; selected: boolean; onPress: () => void}) {
  const theme = useTheme();
  return <SelectionCircle variant="row" selected={selected} selecting interactive={!theme.isTV} accessibilityLabel={t('card.select', {title: row.text.title})} onSelectedChange={onPress}/>;
}
const renderRowSelection: TrackSelection['renderControl'] = (row, selected, onPress) => <RowSelectionControl row={row} selected={selected} onPress={onPress}/>;

function BrowseStage({children, height = 844}: {children: React.ReactNode; height?: number}) {
  const theme = useTheme();
  return <OverlaysProvider><View testID="browse-reference-stage" style={{width: theme.isTV ? 1920 : theme.platform === 'phone' ? 390 : 1440, height: theme.isTV ? 1080 : height, marginHorizontal: -theme.gutter, backgroundColor: theme.colors.ink}}>{children}</View></OverlaysProvider>;
}

function HeaderCase({initial = 'movies', switchOpen = false, menuOpen = false, owner = false, ownerTag}: {initial?: string; switchOpen?: boolean; menuOpen?: boolean; owner?: boolean; ownerTag?: React.ReactNode}) {
  const theme = useTheme(), [value, setValue] = useState(initial), [pivot, setPivot] = useState('discover'), [switcherOpen, setSwitcherOpen] = useState(switchOpen), [optionsOpen, setOptionsOpen] = useState(menuOpen), [action, setAction] = useState<string>();
  const name = libraryChoices.find(choice => choice.id === value)!.name;
  const pivots = value === 'music' ? ['discover', 'artists', 'albums', 'songs', 'genres', 'playlists'] : value === 'audiobooks' ? ['discover', 'books', 'authors', 'series'] : ['discover', 'movies', 'collections'];
  const pivotLabel = (id: string) => t(`library.tab.${id}` as MessageId);
  if (owner && !ownerTag) throw new Error('The owner reference case requires the real shell OwnerTag.');
  const sources = globalThis.__porticoBrowseEvidence?.ambient;
  const props = {name, ambient: sources?.length ? <AmbientArt sources={sources} treatment="library"/> : undefined, switcher: <LibrarySwitcher libraries={libraryChoices} value={value} onValueChange={setValue} open={switcherOpen} onOpenChange={setSwitcherOpen} trigger={theme.isTV ? 'chevron' as const : 'name' as const}/>, menu: <LibraryMenu {...(owner ? {owner: true as const, ownerTag, onLibrarySettings: () => setAction(t('next.browse.native.librarySettings')), onScan: () => setAction(t('next.browse.native.scan'))} : {owner: false as const})} open={optionsOpen} onOpenChange={setOptionsOpen} onSaveView={() => setAction(t('next.browse.native.saveThisView'))} onMarkAll={() => setAction(t('next.browse.native.markAllWatched'))} onEditPins={() => setAction(t('next.browse.native.editPins'))} count={libraryChoices.find(choice => choice.id === value)?.count} viewSummary={t('web.filters.direction', {kind: 'alpha', dir: 'asc'})}/>, children: <Tabs value={pivot} onValueChange={setPivot} items={pivots.map(id => ({value: id, label: pivotLabel(id)}))}/>};
  return <BrowseStage>{theme.isTV ? <LibraryHeader {...props}/> : <StickyBrowseHeader {...props} safeArea={false} onLibraries={() => setAction(t('next.browse.native.libraries'))} style={{paddingTop: 48}}/>}{action && <Dialog open onOpenChange={open => {if (!open) setAction(undefined);}} title={action} footer={<Button onPress={() => setAction(undefined)}>{t('action.done')}</Button>}><Text style={{color: theme.colors.text}}>{action}</Text></Dialog>}</BrowseStage>;
}

function initialFields(): Record<string, FilterFieldState> {
  return {
    genre: {kind: 'values', values: genres.map((label, index) => ({value: label, label, count: counts[index]})), included: [genres[2], genres[6]], excluded: [genres[8]], mode: 'any', allowAll: true, search: '', active: true, showAllLabel: t('next.browse.native.allValues', {count: 18, field: t('library.tab.genres').toLocaleLowerCase('en-US')})},
    year: {kind: 'values', values: [1950, 1970, 1980, 1990, 2000, 2010, 2020].map((value, index) => ({value: String(value), label: t('next.kit.filter.decade', {year: String(value)}), count: [1, 6, 10, 17, 10, 11, 25][index]})), included: ['1980'], excluded: [], mode: 'any', allowAll: false, summary: t('next.kit.filter.decade', {year: '1980'}), active: true, preferredFocusValue: '1990'},
    contentRating: {kind: 'choice', options: (['g', 'pg', 'pg13', 'r'] as const).map(value => ({value, label: fixture(`rating.${value}`)})), value: null},
    studio: {kind: 'values', values: (['studio.warner', 'studio.pixar'] as const).map(id => ({value: id, label: fixture(id)})), included: [], excluded: [], mode: 'any', allowAll: false},
    collection: {kind: 'values', values: (['collection.toyStory', 'collection.lordRings'] as const).map(id => ({value: id, label: fixture(id)})), included: [], excluded: [], mode: 'any', allowAll: true},
    tag: {kind: 'values', values: (['tag.familyNight', 'tag.toWatch'] as const).map(id => ({value: id, label: fixture(id)})), included: [], excluded: [], mode: 'any', allowAll: true},
    playState: {kind: 'choice', value: null, options: [{value: 'unplayed', label: t('filter.quick.unplayed')}, {value: 'in-progress', label: t('filter.quick.inProgress')}, {value: 'played', label: t('filter.quick.played')}]}, favorite: {kind: 'toggle', value: null}, watchlisted: {kind: 'toggle', value: null}, dateAdded: {kind: 'range', value: null, presets: [{value: 'last30', label: t('filter.preset.lastDays', {count: 30})}]}, actor: {kind: 'text', value: ''}, resolution: {kind: 'choice', value: null, options: [{value: 'sd', label: t('quality.sd')}, {value: '4k', label: t('next.kit.4k')}]}, audioLanguage: {kind: 'choice', value: null, options: ['en', 'fr'].map(value => ({value, label: defaultI18n.languageName(value)}))},
  };
}
function clearedFields(): Record<string, FilterFieldState> {
  return Object.fromEntries(Object.entries(initialFields()).map(([id, state]) => [id, state.kind === 'values'
    ? {...state, included: [], excluded: [], mode: 'any', active: false, summary: undefined, search: state.search === undefined ? undefined : ''}
    : {...state, value: state.kind === 'text' ? '' : null, active: false, summary: undefined}]));
}

function updateField(previous: Record<string, FilterFieldState>, id: string, value: FilterFieldValue) {
  const active = value.kind === 'values' ? value.included.length + value.excluded.length > 0 : value.value !== null && value.value !== '';
  return {...previous, [id]: {...previous[id], ...value, active, summary: undefined} as FilterFieldState};
}

function FilterSurface({open, onOpenChange, fields, onFieldsChange, onApply, onSave, match = false, renderAllValues}: {
  open: boolean; onOpenChange: (open: boolean) => void; fields: Record<string, FilterFieldState>;
  onFieldsChange: React.Dispatch<React.SetStateAction<Record<string, FilterFieldState>>>;
  onApply: () => void; onSave: () => void; match?: boolean; renderAllValues?: BrowsePickerSlot;
}) {
  const theme = useTheme(), [openFields, setOpenFields] = useState<readonly string[]>([theme.isTV ? 'year' : 'genre']), [all, setAll] = useState<string>();
  const model = useMemo(() => {
    const fields = theme.platform === 'phone' ? capability.fields.filter(value => ['genre', 'year', 'contentRating', 'favorite', 'watchlisted', 'resolution', 'audioLanguage'].includes(value.id)) : capability.fields;
    return browseToolbarModel({...capability, fields}, 'movie', [], {field: 'title', direction: 'asc'}, {t, owner: true, textEntry: !theme.isTV});
  }, [theme.isTV, theme.platform]);
  const change = (id: string, value: FilterFieldValue) => onFieldsChange(previous => updateField(previous, id, value));
  const visibleFields = Object.fromEntries(Object.entries(fields).map(([id, state]) => [id, state.kind === 'values' ? {
    ...state, showAllLabel: renderAllValues ? state.showAllLabel : undefined,
    values: state.search ? state.values.filter(option => option.label.toLocaleLowerCase('en-US').includes(state.search!.toLocaleLowerCase('en-US'))) : state.values,
    showMatchMode: id === 'genre' ? match : state.showMatchMode,
  } : state]));
  const content = <FilterBuilder model={model} labels={labels} openFields={openFields}
    onFieldOpenChange={(id, next) => setOpenFields(previous => next ? [...new Set([...previous, id])] : previous.filter(value => value !== id))}
    fields={visibleFields} onFieldChange={change}
    onSearchChange={(id, search) => onFieldsChange(previous => ({...previous, [id]: {...previous[id], search} as FilterFieldState}))}
    onShowAll={renderAllValues ? setAll : undefined}/>;
  const clear = () => onFieldsChange(clearedFields());
  const footer = <View style={{flexDirection: 'row', gap: theme.isTV ? 16 : 10}}>
    {!theme.isTV && <Button variant="glass" size="compact" onPress={onSave}>{t('next.browse.native.saveView')}</Button>}
    <Button size="hero" onPress={onApply} style={{flex: 1}}>{t('next.browse.native.showResults', {results: t('lib.count', {count: theme.isTV ? 10 : 19, pivot: 'movies'})})}</Button>
    {theme.isTV && <Button variant="glass" onPress={clear}>{t('next.browse.native.clearAll')}</Button>}
  </View>;
  return <>{theme.isTV
    ? <BottomSheet open={open} onOpenChange={onOpenChange} title={t('next.browse.native.filters')} description={t('next.browse.native.resultsMatch', {results: t('lib.count', {count: 10, pivot: 'movies'})})} titleType={{size: 44, weight: 800, tracking: -.03, lineHeight: 'normal'}} width={680} scrollable={false} footer={footer}>{content}</BottomSheet>
    : theme.platform === 'phone'
      ? <BottomSheet open={open} onOpenChange={onOpenChange} title={t('next.browse.native.filters')} detents={[698]} defaultDetent={0} scrollable={false} headerAction={<Button variant="text" size="small" onPress={clear}>{t('next.browse.native.clearAll')}</Button>} footer={footer}>{content}</BottomSheet>
      : <SidePanel open={open} onOpenChange={onOpenChange} title={t('next.browse.native.filters')} width={504} footer={footer}>{content}</SidePanel>}
    {all && renderAllValues?.({id: all, label: t(fieldNames[all]), state: fields[all], onChange: value => change(all, value), onClose: () => setAll(undefined)})}
  </>;
}

function FilterCase({match = false, renderAllValues}: {match?: boolean; renderAllValues: BrowsePickerSlot}) {
  return <ToolbarCase filtered initialFilters match={match} renderAllValues={renderAllValues}/>;
}

// This bounded DEV interaction fixture supplies predicates to the real canonical model.
function fixturePredicates(fields: Record<string, FilterFieldState>): readonly BrowseNode[] {
  return Object.entries(fields).flatMap(([id, state]): BrowseNode[] => {
    if (state.kind === 'values') return [
      ...(state.included.length ? [{field: id === 'year' ? 'decade' : id, operator: state.mode === 'all' ? 'contains-all' as const : state.mode === 'none' ? 'not-in' as const : 'in' as const, value: state.included}] : []),
      ...(state.excluded.length ? [{field: id, operator: 'not-in' as const, value: state.excluded}] : []),
    ];
    if ((state.kind === 'choice' || state.kind === 'toggle') && state.value !== null) return [{field: id, operator: 'equals', value: state.value}];
    return [];
  });
}

function ToolbarCase({sticky = false, owner = true, musicMode = false, filtered = false, initialFilters = false, match = false, renderAllValues}: {
  sticky?: boolean; owner?: boolean; musicMode?: boolean; filtered?: boolean; initialFilters?: boolean; match?: boolean; renderAllValues?: BrowsePickerSlot;
}) {
  const theme = useTheme();
  const [sort, setSort] = useState<BrowseSortSelection>({field: 'title', direction: 'asc'}), [predicates, setPredicates] = useState<readonly BrowseNode[]>(filtered ? [{field: 'decade', operator: 'in', value: ['1980']}] : []);
  const [filters, setFilters] = useState(initialFilters), [fields, setFields] = useState(initialFields), [saved, setSaved] = useState(false), [jump, setJump] = useState(false), [letter, setLetter] = useState('A');
  const [view, setView] = useState<'grid' | 'list'>('grid'), [size, setSize] = useState('medium');
  const model = useMemo(() => browseToolbarModel(capability, musicMode ? 'music' : 'movie', predicates, sort, {t, owner}), [musicMode, predicates, sort, owner]);
  const applied = model.applied.flatMap((predicate, index) => 'field' in predicate ? [{id: String(index), parts: appliedFilterParts(predicate as AppliedFilter, id => t(fieldNames[id]), {t})}] : []);
  return <BrowseStage height={900}>
    <BrowseToolbar model={model} labels={labels} sticky={sticky} resultCount={t('lib.count', {count: filtered ? 10 : 80, pivot: musicMode ? 'songs' : 'movies'})}
      onFilters={() => setFilters(true)} onSortChange={setSort} onReshuffle={() => setSort(previous => ({...previous, seed: (previous.seed ?? 0) + 1}))}
      onQuickChange={(id, checked) => {const query = model.quick.find(item => item.id === id)!.query; setPredicates(previous => checked ? [...previous, query] : previous.filter(item => item !== query)); setSaved(false);}}
      applied={applied} onRemoveFilter={id => {const target = model.applied[Number(id)]; setPredicates(previous => previous.filter(item => item !== target)); setSaved(false);}} onClearFilters={() => {setPredicates([]); setFields(clearedFields()); setSaved(false);}}
      view={{value: view, onValueChange: setView}} cardSize={{value: size, options: ['small', 'medium', 'large'].map(value => ({value, label: t(`next.browse.native.${value}` as MessageId)})), onValueChange: setSize}}
      save={{canSave: !saved && predicates.length > 0, onSave: () => setSaved(true)}} onJump={() => setJump(true)}/>
    {theme.isTV && <Text style={{color: theme.colors.textTertiary, margin: 56}}>{t('next.browse.native.jumpTo')} {letter}</Text>}
    <FilterSurface open={filters} onOpenChange={setFilters} fields={fields} onFieldsChange={setFields} match={match} renderAllValues={renderAllValues} onApply={() => {setPredicates(fixturePredicates(fields)); setSaved(false); setFilters(false);}} onSave={() => {setPredicates(fixturePredicates(fields)); setSaved(true); setFilters(false);}}/>
    <Menu open={jump} onOpenChange={setJump} title={t('next.browse.native.jumpTo')} items={[...fixture('alphabet')].map(value => ({id: value, label: value, selected: value === letter, onSelect: () => {setLetter(value); setSort({field: 'title', direction: 'asc'});}}))}/>
  </BrowseStage>;
}

function SortCase({random = false, expensive = false}: {random?: boolean; expensive?: boolean}) {
  const [sort, setSort] = useState<BrowseSortSelection>({field: random ? 'random' : expensive ? 'forYou' : 'year', direction: 'desc'}), [open, setOpen] = useState(true);
  const model = browseToolbarModel(capability, 'movie', [], sort, {t, owner: true});
  return <BrowseStage height={900}><View style={{padding: 20, alignItems: 'flex-end'}}><SortMenu sorts={model.sorts} value={model.sort} label={labels.sort} onValueChange={setSort} open={open} onOpenChange={setOpen} onReshuffle={() => setSort(previous => ({...previous, seed: (previous.seed ?? 0) + 1}))}/></View></BrowseStage>;
}

function TrackCase({chapters = false, compact = false, songs = false, topSongs = false, renderSelectionControl}: {
  chapters?: boolean; compact?: boolean; songs?: boolean; topSongs?: boolean; renderSelectionControl: TrackSelection['renderControl'];
}) {
  const theme = useTheme();
  const [playing, setPlaying] = useState(chapters ? 'chapter-5' : theme.isTV && !topSongs ? 'song-1' : 'song-0');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set()), [selecting, setSelecting] = useState(false), [menuId, setMenuId] = useState<string>();
  const [favorite, setFavorite] = useState<ReadonlySet<string>>(new Set([theme.isTV ? 'song-1' : 'song-0']));
  const rows = useMemo(() => {
    const tvNames = topSongs
      ? (['song.comeTogether', 'song.something', 'song.ohDarling', 'song.maxwell'] as const).map(fixture)
      : (['song.blood', 'song.dna', 'song.yah', 'song.element'] as const).map(fixture);
    const names = chapters ? chapterNames : theme.isTV ? tvNames : songNames;
    return names.map((title, index): TrackRowData => {
      const id = `${chapters ? 'chapter' : 'song'}-${index}`;
      const durationSeconds = chapters ? [1663, 1810, 2412, 2339, 2847, 3120][index]
        : theme.isTV ? (topSongs ? [259, 183, 207, 207] : [118, 185, 160, 208])[index] : [250, 240, 211, 191][index];
      const subject: CardSubject = {id, title, kind: chapters ? 'chapter' : 'song', durationSeconds,
        artist: chapters || theme.isTV && !topSongs ? undefined : theme.isTV ? undefined : weeknd,
        album: chapters || theme.isTV && !topSongs ? undefined : theme.isTV ? fixture('album.abbeyRoad') : afterHours};
      const cover = theme.isTV ? {uri: `${sourceOrigin}/assets/pool/albums/${topSongs ? 'abbey-road-2019-mix' : 'damn'}.jpg`, cacheKey: `approved-reference:${topSongs ? 'abbey-road' : 'damn'}`} : art;
      return {id, text: cardText(subject, 'song-row', {t}), number: index + 1,
        duration: chapters ? {id: 'duration', text: defaultI18n.clock(durationSeconds), role: 'value'} : undefined,
        plays: chapters || theme.isTV ? undefined : [24, 18, 12, 8][index], playing: id === playing, favorite: chapters ? undefined : favorite.has(id),
        done: chapters && index < 5, current: chapters && index === 5, progress: chapters && index === 5 ? .4 : undefined,
        artwork: chapters || theme.isTV && !topSongs ? undefined : <Artwork source={cover}/>};
    });
  }, [chapters, topSongs, theme.isTV, playing, favorite]);
  const selection: TrackSelection = {active: selecting, isSelected: id => selected.has(id),
    onToggle: id => setSelected(previous => {const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next;}),
    onEnter: id => {setSelecting(true); setSelected(new Set([id]));}, renderControl: renderSelectionControl};
  const collection = useMemo(() => createWindowedCollection<TrackRowData>({pageSize: 40, maxResidentPages: 3, maxConcurrent: 1, keyOf: row => row.id,
    fetchPage: async start => ({items: rows.slice(start, start + 40), total: rows.length})}), [rows]);
  useEffect(() => () => collection.dispose(), [collection]);
  const actions = {onPlay: setPlaying, onMore: setMenuId, onToggleFavorite: (id: string, checked: boolean) => setFavorite(previous => {const next = new Set(previous); if (checked) next.add(id); else next.delete(id); return next;})};
  const row = rows.find(item => item.id === menuId);
  return <BrowseStage height={600}><View style={{height: theme.isTV ? 900 : 500}}>
    {compact ? rows.map(item => <SongRow key={item.id} row={item} {...actions} onLongPress={() => selection.onEnter(item.id)} selected={selected.has(item.id)}
      selection={selecting ? renderSelectionControl(item, selected.has(item.id), () => selection.onToggle(item.id)) : undefined}
      onSelectionChange={selecting ? () => selection.onToggle(item.id) : undefined}/>)
      : songs ? <TrackTable variant="songs" collection={collection} selection={selection} {...actions}/>
      : <TrackTable variant={chapters ? 'chapters' : topSongs ? 'top-songs' : 'album'} rows={rows} selection={selection} {...actions}/>}
  </View><Menu open={row !== undefined} onOpenChange={open => {if (!open) setMenuId(undefined);}} title={row?.text.title}
    items={row ? [{id: 'play', label: t('action.play'), onSelect: () => setPlaying(row.id)},
      {id: 'favorite', label: t(row.favorite ? 'next.browse.native.unfavorite' : 'next.browse.native.favorite'), onSelect: () => actions.onToggleFavorite(row.id, !row.favorite)},
      {id: 'select', label: t('next.browse.native.select'), onSelect: () => selection.onEnter(row.id)}] : []}/></BrowseStage>;
}

function EmptyCase() {
  const [empty, setEmpty] = useState(true), horror = genres[8];
  return <BrowseStage>{empty ? <FilteredEmpty description={t('next.browse.native.filteredEmptyDescription', {library: movies, genre: horror.toLocaleLowerCase('en-US'), decade: '2010'})} onClearFilters={() => setEmpty(false)} suggestionsLabel={t('next.browse.native.orTry')} suggestions={[{id: 'year', label: t('next.browse.native.anyYear', {genre: horror}), count: 6, onSelect: () => setEmpty(false)}, {id: 'genre', label: t('next.browse.native.fromDecade', {decade: '2010'}), count: 11, onSelect: () => setEmpty(false)}]}/> : <ToolbarCase/>}</BrowseStage>;
}

const galleries: readonly Gallery[] = [
  {id: 'browse-header', title: 'next.browse.native.galleryTitle', render: () => <HeaderCase/>},
  {id: 'browse-switcher', title: 'next.browse.native.switchLibrary', render: () => <HeaderCase switchOpen/>},
  {id: 'browse-menu-member', title: 'next.browse.native.libraryOptions', render: () => <HeaderCase menuOpen owner={false}/>},
  {id: 'browse-music-header', title: 'next.browse.native.galleryTitle', render: () => <HeaderCase initial="music"/>},
  {id: 'browse-audiobook-header', title: 'next.browse.native.galleryTitle', render: () => <HeaderCase initial="audiobooks"/>},
  {id: 'browse-toolbar', title: 'next.browse.native.toolbar', render: () => <ToolbarCase/>},
  {id: 'browse-toolbar-filtered', title: 'next.browse.native.toolbar', render: () => <ToolbarCase filtered/>},
  {id: 'browse-toolbar-sticky', title: 'next.browse.native.toolbar', render: () => <ToolbarCase sticky/>},
  {id: 'browse-toolbar-music', title: 'next.browse.native.toolbar', render: () => <ToolbarCase musicMode/>},
  {id: 'browse-sort', title: 'next.browse.native.sort', render: () => <SortCase/>},
  {id: 'browse-sort-random', title: 'next.browse.native.sort', render: () => <SortCase random/>},
  {id: 'browse-sort-expensive', title: 'next.browse.native.sort', render: () => <SortCase expensive/>},
  {id: 'browse-empty', title: 'next.browse.native.filterEmptyTitle', render: EmptyCase},
  {id: 'browse-album-tracks', title: 'next.browse.native.galleryTitle', render: () => <TrackCase renderSelectionControl={renderRowSelection}/>},
  {id: 'browse-top-songs', title: 'next.browse.native.galleryTitle', render: () => <TrackCase topSongs renderSelectionControl={renderRowSelection}/>},
  {id: 'browse-song-rows', title: 'next.browse.native.galleryTitle', render: () => <TrackCase compact renderSelectionControl={renderRowSelection}/>},
  {id: 'browse-windowed-songs', title: 'next.browse.native.galleryTitle', render: () => <TrackCase songs renderSelectionControl={renderRowSelection}/>},
  {id: 'browse-chapters', title: 'next.browse.native.galleryTitle', platforms: ['phone', 'tablet'], render: () => <TrackCase chapters renderSelectionControl={renderRowSelection}/>},
];
export default galleries;

/** Integrated here when the dedicated selection/shell milestones supply their real renderers. */
export function componentSlotGalleries(ownerTag: React.ReactNode, renderAllValues: BrowsePickerSlot): readonly Gallery[] {
  return [
    {id: 'browse-filters', title: 'next.browse.native.filters', render: () => <FilterCase renderAllValues={renderAllValues}/>},
    {id: 'browse-match-modes', title: 'next.browse.native.match', render: () => <FilterCase match renderAllValues={renderAllValues}/>},
    {id: 'browse-menu-owner', title: 'next.browse.native.libraryOptions', render: () => <HeaderCase menuOpen owner ownerTag={ownerTag}/>},
  ];
}
