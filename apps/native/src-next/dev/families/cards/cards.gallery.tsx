import React, {useState, type ReactNode} from 'react';
import {Pressable, Text, View} from 'react-native';
import type {Gallery} from '../../gallery-registry';
import {cardText, episodeLabel, titleFactParts, type FactPart} from '../../../../../../packages/client-core/src/presentation/kit-model/index';
import {defaultI18n} from '../../../../../../packages/i18n/src/index';
import {GeneratedCover, type ArtworkSource} from '../../../kit/artwork/index';
import {CircleCard, CollectionBanner, CollectionTile, CoverCard, EpisodeTile, GenreTile, LibraryCard, LibraryRow, LiveCard, NotInterestedButton, PlaylistMosaic, PosterCard, QuickTile, RankedCard, ReadResumeCard, ResumeCard, SeriesTile, SessionCard, SquareCard, WideCard, type CardProps} from '../../../kit/cards/index';
import {useTheme} from '../../../kit/theme';

// Reference media belongs only to this __DEV__ gallery. Production cards never compose fixtures.
const referenceRoot = 'http://100.120.50.24:8787/';
const artwork = (path: string): ArtworkSource => ({uri: `${referenceRoot}${path}`, cacheKey: `cards-reference:${path}`});
const toy = artwork('assets/pool/movies/toy-story.jpg');
const inside = artwork('assets/pool/movies/inside-out.jpg');
const dune = artwork('assets/pool/movies/dune-part-two.jpg');
const backdrop = artwork('assets/bd-tlou.jpg');
const album = artwork('assets/pool/albums/after-hours.jpg');
const audiobook = artwork('assets/pool/books/the-martian-unabridged.jpg');
const albums = [album, artwork('assets/pool/albums/damn.jpg'), artwork('assets/pool/albums/random-access-memories.jpg'), artwork('assets/pool/albums/thriller.jpg')] as const;
const readCover = artwork('assets/read/covers/great-gatsby.jpg');
const magazine = artwork('assets/read/magazines/amazing-1926-04.jpg');
const newspaper = artwork('assets/read/newspapers/nyt-1918-10-21.jpg');
const covers = [toy, inside, dune] as const;
const env = {t: defaultI18n.t};
const episode = cardText({id: 'tlou-e3', kind: 'episode', title: defaultI18n.t('next.cards.fixture.episode'), show: {id: 'tlou', title: defaultI18n.t('next.cards.fixture.show')}, episode: {mode: 'seasonal', season: 1, episode: 3}, durationSeconds: 81 * 60, positionSeconds: 17 * 60}, 'continuation', env);
const movie = cardText({id: 'inside-out', kind: 'movie', title: 'Inside Out', year: 2015, durationSeconds: 95 * 60, positionSeconds: 9 * 60}, 'continuation', env);
const book = cardText({id: 'martian', kind: 'book', title: defaultI18n.t('next.cards.fixture.book'), author: defaultI18n.t('next.cards.fixture.author'), chapterNumber: 15, durationSeconds: 10 * 3600 + 52 * 60, positionSeconds: 6 * 3600 + 18 * 60}, 'continuation', env);
const length = (seconds: number) => titleFactParts({durationSeconds: seconds}, env)[0]?.text;
const fact = (id: string, text: string, role: FactPart['role'] = 'supplement'): FactPart => ({id, text, role});

type Scenario = {id: string; platform?: 'read'; render: (props: CardProps) => ReactNode; selected?: boolean};
function Specimen({scenario}: {scenario: Scenario}) {
  const t = useTheme(), [active, setActive] = useState(!!scenario.selected), [selected, setSelected] = useState(!!scenario.selected), [event, setEvent] = useState<string>();
  const props: CardProps = {
    title: defaultI18n.t('next.cards.fixture.collection'), testID: `card-${scenario.id}`, hasTVPreferredFocus: true,
    onNavigate: () => setEvent(defaultI18n.t('next.cards.fixture.actionNavigate')),
    onPlay: () => setEvent(defaultI18n.t('next.cards.fixture.actionPlay')),
    onMore: () => setEvent(defaultI18n.t('next.cards.fixture.actionMore')),
    selection: {active, selected, onToggle: () => setSelected(value => !value), onEnter: () => {setActive(true); setSelected(true);}},
  };
  return <View style={{padding: t.isTV ? 96 : 20, gap: 24, backgroundColor: t.colors.ink}}>
    {scenario.render(props)}
    {event && <Text testID="cards-last-action" style={[t.type.body, {color: t.colors.text}]}>{event}</Text>}
    {active && <Pressable accessibilityRole="button" accessibilityLabel={defaultI18n.t('action.cancel')} onPress={() => {setActive(false); setSelected(false);}}><Text style={[t.type.bodyStrong, {color: t.colors.accentStrong}]}>{defaultI18n.t('action.cancel')}</Text></Pressable>}
  </View>;
}

const scenarios: readonly Scenario[] = [
  {id: 'poster', render: p => <PosterCard {...p} artwork={toy} caption={[fact('year', '1995')]} />},
  {id: 'poster-new', render: p => <PosterCard {...p} artwork={toy} isNew caption={[fact('year', '1995')]} />},
  {id: 'poster-watched', render: p => <PosterCard {...p} artwork={toy} watched />},
  {id: 'poster-progress', render: p => <PosterCard {...p} artwork={toy} progress={0.38} />},
  {id: 'poster-selected', selected: true, render: p => <PosterCard {...p} artwork={toy} />},
  {id: 'poster-grid', render: p => <PosterCard {...p} width={108} density="grid" artwork={toy} caption={[fact('year', '1995')]} />},
  {id: 'poster-long', render: p => <PosterCard {...p} artwork={dune} title={defaultI18n.t('next.cards.fixture.longTitle')} titleLines={2} />},
  {id: 'poster-missing', render: p => <PosterCard {...p} />},
  {id: 'poster-error', render: p => <PosterCard {...p} artwork={artwork('assets/missing-card-reference.jpg')} />},
  {id: 'wide-episode', render: p => <WideCard {...p} {...episode} artwork={backdrop} primaryAction="play" onPlay={p.onPlay!} />},
  {id: 'wide-film', render: p => <WideCard {...p} {...movie} artwork={inside} primaryAction="play" onPlay={p.onPlay!} />},
  {id: 'wide-selected', selected: true, render: p => <WideCard {...p} {...episode} artwork={backdrop} />},
  {id: 'square', render: p => <SquareCard {...p} title={defaultI18n.t('next.cards.fixture.album')} artwork={album} caption={[fact('artist', defaultI18n.t('next.cards.fixture.artist'), 'identity'), fact('year', '2020')]} />},
  {id: 'square-progress', render: p => <SquareCard {...p} {...book} artwork={audiobook} progress={0.58} />},
  {id: 'circle-one', render: p => <CircleCard {...p} title={defaultI18n.t('next.cards.fixture.artist')} art={{covers: [album]}} />},
  {id: 'circle-two', render: p => <CircleCard {...p} title={defaultI18n.t('next.cards.fixture.artist')} art={{covers: albums.slice(0, 2)}} />},
  {id: 'circle-three', render: p => <CircleCard {...p} title={defaultI18n.t('next.cards.fixture.artist')} art={{covers: albums.slice(0, 3)}} />},
  {id: 'circle-four', render: p => <CircleCard {...p} title={defaultI18n.t('next.cards.fixture.artist')} art={{covers: albums}} />},
  {id: 'circle-person', render: p => <CircleCard {...p} title={defaultI18n.t('next.cards.fixture.person')} person art={{initials: 'RF', covers: [dune, toy]}} />},
  ...(['seasonal', 'date', 'absolute', 'special'] as const).map(mode => ({id: `episode-${mode}`, render: (p: CardProps) => {
    const numbering = mode === 'seasonal' ? {mode, season: 1, episode: 3} : mode === 'date' ? {mode, day: '2026-10-21'} : mode === 'absolute' ? {mode, number: 37} : {mode};
    const label = episodeLabel(numbering, 'in-show', env);
    return <EpisodeTile {...p} title={defaultI18n.t('next.cards.fixture.episode')} artwork={backdrop} backdropFallback label={label ? [label] : []} length={length(76 * 60)} />;
  }})),
  {id: 'episode-still', render: p => <EpisodeTile {...p} title={defaultI18n.t('next.cards.fixture.episode')} artwork={backdrop} label={[fact('episode-label', defaultI18n.t('next.kit.episode', {number: 3}), 'context')]} length={length(76 * 60)} />},
  {id: 'episode-progress', render: p => <EpisodeTile {...p} title={episode.title} artwork={backdrop} backdropFallback label={episode.caption} progress={0.67} length={length(81 * 60)} />},
  {id: 'episode-watched', render: p => <EpisodeTile {...p} title="Infected" artwork={backdrop} backdropFallback label={[fact('episode-label', defaultI18n.t('next.kit.episode', {number: 2}), 'context')]} watched />},
  {id: 'live', render: p => <LiveCard {...p} title={defaultI18n.t('next.cards.fixture.programme')} channel={defaultI18n.t('next.cards.fixture.channel')} number="101" mark={{sourceId: 'northwind', id: 'news24', text: defaultI18n.t('next.cards.fixture.channelMark'), seed: 'northwind:news24'}} flags={[fact('live', defaultI18n.t('next.kit.live'), 'status')]} range={defaultI18n.t('next.cards.fixture.timeRange')} progress={0.58} />},
  {id: 'collection-tile', render: p => <CollectionTile {...p} title={defaultI18n.t('next.cards.fixture.collection')} covers={covers} backdrop={inside} caption={[fact('count', defaultI18n.t('next.cards.fixture.collectionFacts')), fact('years', defaultI18n.t('next.cards.fixture.collectionYears'))]} detail={[fact('watched', defaultI18n.t('next.cards.fixture.collectionWatched'), 'status')]} progress={0.5} />},
  {id: 'collection-banner', render: p => <CollectionBanner {...p} title={defaultI18n.t('next.cards.fixture.collection')} covers={covers} backdrop={inside} />},
  {id: 'genre-video', render: p => <GenreTile {...p} title={defaultI18n.t('next.cards.fixture.genreVideo')} variant="video" covers={covers} backdrop={inside} />},
  {id: 'genre-music', render: p => <GenreTile {...p} title={defaultI18n.t('next.cards.fixture.genreMusic')} variant="music" covers={albums.slice(0, 3)} />},
  {id: 'ranked', render: p => <RankedCard {...p} artwork={toy} rank={1} />},
  {id: 'library-poster', render: p => <LibraryCard {...p} title={defaultI18n.t('next.cards.fixture.library')} covers={covers} shape="poster" />},
  {id: 'library-square', render: p => <LibraryRow {...p} title={defaultI18n.t('next.cards.fixture.musicLibrary')} covers={albums.slice(0, 3)} shape="square" />},
  {id: 'library-empty', render: p => <LibraryRow {...p} title={defaultI18n.t('next.cards.fixture.library')} covers={[]} shape="poster" />},
  {id: 'cover-generated', platform: 'read', render: p => <CoverCard {...p} title="The Time Machine" artworkFallback={<GeneratedCover title="The Time Machine" author="H. G. Wells" tint={{first: '#153749', second: '#1e5b52'}} />} />},
  {id: 'cover-book', platform: 'read', render: p => <CoverCard {...p} title={defaultI18n.t('next.cards.fixture.readBook')} artwork={readCover} progress={0.27} />},
  {id: 'cover-periodical', platform: 'read', render: p => <CoverCard {...p} title={defaultI18n.t('next.cards.fixture.magazine')} artwork={magazine} kind="periodical" />},
  {id: 'cover-newspaper', platform: 'read', render: p => <CoverCard {...p} title={defaultI18n.t('next.cards.fixture.newspaper')} artwork={newspaper} kind="newspaper" watched />},
  {id: 'read-resume', platform: 'read', render: p => <ReadResumeCard {...p} title="The Time Machine" caption={[fact('author', 'H. G. Wells', 'identity')]} detail={[fact('chapter', defaultI18n.t('next.kit.chapter', {number: 4}), 'context'), fact('remaining', '1 h 40 min left')]} progress={0.27} artworkFallback={<GeneratedCover title="The Time Machine" author="H. G. Wells" tint={{first: '#153749', second: '#1e5b52'}} />} />},
  {id: 'series', platform: 'read', render: p => <SeriesTile {...p} title="Little Nemo in Slumberland" covers={covers} segments={[{id: '1', finished: true}, {id: '2', progress: 0.4}, {id: '3'}]} />},
  {id: 'resume', render: p => <ResumeCard {...p} {...book} artwork={audiobook} primaryAction="play" onPlay={p.onPlay!} />},
  {id: 'quick-rest', render: p => <QuickTile {...p} title={defaultI18n.t('next.cards.fixture.album')} artwork={album} caption={[fact('artist', defaultI18n.t('next.cards.fixture.artist'), 'identity')]} />},
  {id: 'quick-playing', render: p => <QuickTile {...p} title={defaultI18n.t('next.cards.fixture.album')} artwork={album} playing onPause={p.onPlay!} caption={[fact('artist', defaultI18n.t('next.cards.fixture.artist'), 'identity')]} />},
  {id: 'playlist', render: p => <PlaylistMosaic {...p} title="Family night" covers={[toy, inside, dune, album]} />},
  {id: 'playlist-create', render: p => <PlaylistMosaic {...p} title={defaultI18n.t('web.saved.newPlaylist')} covers={[]} create />},
  {id: 'session', render: p => <SessionCard {...p} title="The Last of Us" artwork={backdrop} identity={episode.caption} facts={[fact('viewer', 'Demo', 'identity'), fact('device', 'Living room TV')]} progress={0.67} />},
  {id: 'not-interested', render: p => <NotInterestedButton title={p.title} onPress={p.onNavigate!} />},
];

export default scenarios.map(scenario => ({
  id: `cards-${scenario.id}`, title: 'next.cards.native.galleryTitle',
  render: function CardsGalleryCase() {return <Specimen scenario={scenario} />;},
  platforms: scenario.platform === 'read' ? ['phone', 'tablet'] : ['phone', 'tablet', 'tv'],
})) satisfies readonly Gallery[];
