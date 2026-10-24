import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultI18n} from '../../../packages/i18n/src';
import {channelTint} from '../../../packages/client-core/src/presentation/kit-model';
import {SEARCH_CHIPS, orderedSearchGroups, searchGroupLabel, topResultKindLabel, topSearchResult} from '../../../packages/client-core/src/presentation/search-model';
import {browseType} from '../src-next/kit/browse/presentation';
import {createTheme} from '../src-next/kit/theme';
import {homeCardText} from '../src-next/screens/home/model';
import {nativeSearchEntryKey} from '../src-next/screens/search/model';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];
const texts = (node: any) => nodes(node).filter(n => n.type === 'Text');
const flatten = (style: any) => Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean).map(flatten)) : style ?? {};

const movie = {id: 'movie-1', kind: 'movie', title: 'Avengers: Endgame', displayTitle: 'Avengers: Endgame', year: 2019, duration: 10860, posterUrl: '/poster/endgame', playback: {itemId: 'movie-1'}, navigation: {view: 'item', entityId: 'movie-1'}};
const show = {id: 'show-1', kind: 'show', title: 'Game of Thrones', year: 2011, seasonCount: 1, backdropUrl: '/backdrop/got', posterUrl: '/poster/got', playback: {itemId: 'show-1'}, navigation: {view: 'item', entityId: 'show-1'}};
const episode = {id: 'episode-1', kind: 'episode', title: "It's Like a Game", show: {id: 'show-2', name: 'Solo Leveling'}, seasonNumber: 1, episodeNumber: 3, stillUrl: '/still/game', navigation: {view: 'item', entityId: 'show-2'}};
const song = {id: 'song-1', kind: 'song', title: 'The Game of Love', artist: {id: 'artist-1', name: 'Daft Punk'}, album: {id: 'album-1', name: 'Random Access Memories'}, posterUrl: '/cover/ram', navigation: {view: 'item', entityId: 'song-1'}};
const book = {id: 'book-1', kind: 'book', title: 'The Hunger Games: Special Edition', author: 'Suzanne Collins', posterUrl: '/cover/hunger', navigation: {view: 'item', entityId: 'book-1'}};

const group = (id: any, items: readonly any[]) => ({id, title: id, entityKind: 'item', status: 'success', errorCode: '', items, totalCount: items.length, totalCountExact: true, hasMore: false, nextCursor: ''});
const capabilities = {groups: SEARCH_CHIPS.map(chip => ({id: chip.id, title: chip.id, entityKind: 'item', available: true, reason: '', sorts: []})), sorts: [], directions: [], maxLimit: 40, groupBudgetMs: 600};

const genres = [
  {id: 'animation', name: 'Animation', count: 12, coverPaths: ['/animation/1', '/animation/2']},
  {id: 'sci-fi', name: 'Sci-Fi & Fantasy', count: 9, coverPaths: ['/scifi/1', '/scifi/2']},
  {id: 'drama', name: 'Drama', count: 8, coverPaths: ['/drama/1', '/drama/2']},
  {id: 'comedy', name: 'Comedy', count: 7, coverPaths: ['/comedy/1', '/comedy/2']},
  {id: 'crime', name: 'Crime', count: 6, coverPaths: ['/crime/1', '/crime/2']},
  {id: 'action', name: 'Action & Adventure', count: 5, coverPaths: ['/action/1', '/action/2']},
  // Ruling 36.4: a genre without the two covers its phone tile needs is skipped.
  {id: 'western', name: 'Western', count: 1, coverPaths: ['/western/1']},
];

async function mount(snapshot: any, landing: any) {
  const host = hooks();
  (host.react as any).useId = () => 'search-r46';
  const theme = createTheme({width: 390, isTV: false});
  const calls: unknown[] = [];
  const view = await screenModule(new URL('../src-next/screens/search/SearchScreen.tsx', import.meta.url), {
    react: host.react,
    'react-native': {FlatList: 'FlatList', Keyboard: {dismiss: () => {}}, ScrollView: 'ScrollView', Text: 'Text', View: 'View', useWindowDimensions: () => ({width: 390, height: 844})},
    'react-native-svg': {default: 'Svg', Defs: 'Defs', LinearGradient: 'LinearGradient', Rect: 'Rect', Stop: 'Stop'},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({top: 47, bottom: 34, left: 0, right: 0})},
    '../../../../../packages/i18n/src': {defaultI18n},
    '../../../../../packages/client-core/src/presentation/search-model': {orderedSearchGroups, SEARCH_CHIPS, searchGroupLabel, topSearchResult, topResultKindLabel},
    '../../kit/artwork': {Artwork: 'Artwork'}, '../../kit/cards': {GenreTile: 'GenreTile'}, '../../kit/cards/primitives': {CardFrame: 'CardFrame'},
    '../../kit/controls': {Chip: 'Chip', Focusable: 'Focusable', TextField: 'TextField'}, '../../kit/selection': {SelectionCircle: 'SelectionCircle'},
    '../../kit/states': {GridSkeleton: 'GridSkeleton', StateView: 'StateView'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/browse/presentation': {browseType}, '../../kit/theme': {useTheme: () => theme},
    '../home/model': {homeCardText}, './model': {NativeSearchDestination: class {}, nativeSearchEntryKey},
    './SearchGridCard': {SearchGridCard: 'SearchGridCard'}, './TVSearchScreen': {TVSearchScreen: 'TVSearchScreen'},
    '../../../../../packages/client-core/src/presentation/kit-model': {channelTint},
  });
  const tree = host.render(() => view.SearchScreen({
    destination: {subscribe: () => () => {}, getSnapshot: () => snapshot, refreshHistory: async () => {}, clearHistory: async () => calls.push('clear'), setText: () => {},
      selectGroup: () => {}, commit: async () => {}, useRecent: () => calls.push('recent'), next: async () => {}, retry: async () => {}},
    runtime: {artwork: (path: string) => ({uri: path, cacheKey: path}), text: {t: defaultI18n.t}, reportError: () => {}, error: () => ({title: 'error'}),
      registerScrollToTop: () => () => {}},
    explore: {subscribe: () => () => {}, getSnapshot: () => landing, load: async () => {}, openGenre: (genre: any) => calls.push(genre.id)},
    actions: {open: () => {}, play: () => {}, menu: () => {}}, activation: {subscribe: () => () => {}, getSnapshot: () => ({visible: true, intent: 'enter', revision: 1})},
    tvCopy: {preferToTalk: 'next.tv.preferToTalk', voiceHint: 'next.tv.voiceHint'},
  }));
  return {tree, theme, calls};
}

const idle = {generation: 1, scope: {}, query: null, phase: 'idle', data: null, groups: [], pagination: {cursor: null, canPrevious: false}, error: null};

test('phone Search draws the frame 7 empty state: 32pt title, bare 44px recent rows, six two-cover genre tiles', async () => {
  const snapshot = {text: '', group: 'all', search: idle, groups: [], clearing: false,
    recent: [{q: 'slow horses', updatedAt: '2026-10-24T09:00:00Z', uses: 2}, {q: 'tolkien', updatedAt: '2026-10-24T08:00:00Z', uses: 1}, {q: 'fleetwood mac', updatedAt: '2026-10-24T07:00:00Z', uses: 1}]};
  const {tree} = await mount(snapshot, {phase: 'ready', genres, initialHeading: 'next.search.browseByGenre', emptyHeading: 'next.search.browseInstead'});

  // .lt: 32/800 with the drawn 1.15 line box and 12pt gap under it.
  const heading = texts(tree).find(node => node.props.children === defaultI18n.t('web.shell.search'))!;
  const headingStyle = flatten(heading.props.style);
  assert.equal(heading.props.accessibilityRole, 'header');
  assert.equal(headingStyle.fontSize, 32);
  assert.equal(headingStyle.lineHeight, 36.8);
  assert.equal(Number(headingStyle.letterSpacing.toFixed(2)), -1.12);
  assert.equal(headingStyle.marginBottom, 12);
  assert.equal(headingStyle.marginHorizontal, 20);

  // .shead: 19/700 "Recent searches" with Clear, on the 24/20/6 box.
  const recent = texts(tree).find(node => node.props.children === defaultI18n.t('web.search.recent'))!;
  assert.equal(flatten(recent.props.style).fontSize, 19);
  assert.ok(texts(tree).some(node => node.props.children === defaultI18n.t('web.search.clearRecent')));
  assert.ok(nodes(tree).some(node => node.props.accessibilityLabel === defaultI18n.t('web.search.clearRecent')));
  const boxes = nodes(tree).filter(node => node.type === 'View' && flatten(node.props.style).marginTop === 24);
  assert.ok(boxes.length >= 2, 'both drawn sections take the .shead margins');
  assert.equal(flatten(boxes[0].props.style).marginBottom, 6);
  assert.equal(flatten(boxes[0].props.style).marginHorizontal, 20);

  // .rs: bare 44px rows on ink, clock first and the query filling the row. No raised card, no invented control.
  const rows = nodes(tree).filter(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('search-recent-'));
  assert.deepEqual(rows.map(row => row.props.accessibilityLabel), ['slow horses', 'tolkien', 'fleetwood mac']);
  for (const row of rows) {
    const style = flatten(row.props.style);
    assert.equal(style.height, 44);
    assert.equal(style.paddingHorizontal, 20);
    assert.equal(style.borderRadius, undefined);
    assert.equal(style.backgroundColor, undefined);
    assert.deepEqual(nodes(row).filter(n => n.type === 'Icon').map(n => n.props.name), ['i-clock']);
  }

  // .gtiles/.gt: the six drawn tiles, each two covers at 174 x 84 under ruling 36's facet tint.
  const tiles = nodes(tree).filter(node => node.type === 'GenreTile');
  assert.deepEqual(tiles.map(tile => tile.props.title), ['Animation', 'Sci-Fi & Fantasy', 'Drama', 'Comedy', 'Crime', 'Action & Adventure']);
  const tint = new Map(genres.map(genre => [genre.coverPaths[0], channelTint(genre.id)]));
  for (const tile of tiles) {
    assert.equal(tile.props.width, 174);
    assert.equal(tile.props.variant, 'video');
    assert.equal(tile.props.covers.length, 2);
    assert.equal(tile.props.caption, undefined);
    assert.deepEqual(tile.props.palette, {first: tint.get(tile.props.covers[0].uri), second: tint.get(tile.props.covers[0].uri)});
  }
  assert.ok(!tiles.some(tile => tile.props.title === 'Western'), 'a genre without its two covers is skipped');
  assert.ok(texts(tree).some(node => node.props.children === defaultI18n.t('next.search.browseByGenre')));
  assert.ok(!texts(tree).some(node => node.props.children === defaultI18n.t('next.search.browseInstead')));
  assert.ok(!nodes(tree).some(node => node.type === 'Chip'), 'chips stay hidden before a query');
});

test('phone Search draws the frame 8 results: counted type chips, the 178px top result and per-type row shapes', async () => {
  const groups = [group('movies', [movie]), group('shows', [show]), group('episodes', [episode]), group('songs', [song]), group('books', [book])];
  const snapshot = {text: 'game', group: 'all', search: {generation: 2, scope: {}, query: {q: 'game'}, phase: 'ready', groups,
    data: {scope: {}, revision: {catalog: 1, viewer: 1}, heading: {key: '', fallback: ''}, query: {q: 'game', sort: 'relevance', direction: 'desc', group: '', groups: [], libraryIds: [], limit: 12, searchMode: 'normalized_prefix', recorded: false},
      groups, capabilities, empty: undefined}, pagination: {cursor: null, canPrevious: false}, error: null},
    groups, recent: [], clearing: false};
  const {tree, theme} = await mount(snapshot, {phase: 'ready', genres: [], initialHeading: 'next.search.browseByGenre', emptyHeading: 'next.search.browseInstead'});

  // .hs/.chip: only the groups that answered with results carry a chip, each with its exact count.
  const chips = nodes(tree).filter(node => node.type === 'Chip');
  assert.deepEqual(chips.map(chip => chip.props.children), ['All', 'Movies', 'Shows', 'Episodes', 'Songs', 'Audiobooks']);
  assert.deepEqual(chips.map(chip => chip.props.count), [5, 1, 1, 1, 1, 1]);
  assert.deepEqual(chips.map(chip => chip.props.selected), [true, false, false, false, false, false]);
  assert.ok(chips.every(chip => chip.props.retry === false));

  // .topr: 14/16 margins, 178 tall, radius 14, ink-black base, one exact-match title.
  const top = nodes(tree).find(node => node.props.testID === 'search-top-result')!;
  const topStyle = flatten(top.props.pressableStyle);
  assert.deepEqual([topStyle.height, topStyle.borderRadius, topStyle.backgroundColor], [178, 14, theme.colors.dim]);
  assert.deepEqual([flatten(top.props.style).marginTop, flatten(top.props.style).marginHorizontal], [14, 16]);
  const banner = nodes(top.props.children({focused: false, hovered: false, pressed: false, holding: false}));
  assert.equal(banner.find(node => node.type === 'Artwork')!.props.source.uri, '/backdrop/got');
  assert.ok(texts(banner).some(node => node.props.children === defaultI18n.t('search.topResult')));
  assert.ok(texts(banner).some(node => node.props.children === 'Game of Thrones'));
  assert.ok(texts(banner).some(node => node.props.children === defaultI18n.t(topResultKindLabel('shows')!)));
  const play = banner.find(node => node.props.testID === 'search-top-play')!;
  const playStyle = flatten(play.props.style);
  assert.deepEqual([playStyle.width, playStyle.height, playStyle.borderRadius, playStyle.backgroundColor], [46, 46, 23, theme.colors.text]);

  // .rr: one 46x69 poster, one 100x56 wide still, square art for songs and audiobooks, canonical captions.
  const shapes: Record<string, [number, number]> = {movies: [46, 69], episodes: [100, 56], songs: [56, 56], books: [56, 56]};
  const entries: Record<string, any> = {movies: movie, episodes: episode, songs: song, books: book};
  const env = {t: defaultI18n.t};
  for (const id of Object.keys(shapes)) {
    const entry = entries[id], [width, height] = shapes[id];
    const row = nodes(tree).find(node => node.props.testID === `search-result-${nativeSearchEntryKey(id as any, entry)}`)!;
    assert.ok(row, `${id} row is drawn`);
    const body = nodes(row.props.children({focused: false, hovered: false, pressed: false, holding: false}));
    const art = body.find(node => node.type === 'View' && flatten(node.props.style).overflow === 'hidden')!;
    const artStyle = flatten(art.props.style);
    assert.deepEqual([artStyle.width, artStyle.height, artStyle.borderRadius], [width, height, 6], `${id} keeps its drawn art slot`);
    const captions = texts(body).filter(node => flatten(node.props.style).fontSize === 12.5);
    assert.deepEqual(captions.map(node => node.props.children), homeCardText(entry, false, env).caption.map(part => part.text));
  }
  // The Shows row is omitted: its only result already leads the page as the Top result.
  assert.ok(!nodes(tree).some(node => node.props.testID === `search-result-${nativeSearchEntryKey('shows', show)}`));
  assert.deepEqual(texts(tree).filter(node => node.props.accessibilityRole === 'header').map(node => node.props.children),
    ['movies', 'episodes', 'songs', 'books'].map(id => defaultI18n.t(searchGroupLabel(id as any))));
});
