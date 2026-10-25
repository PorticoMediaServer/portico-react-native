import React, {useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {AmbientArt, Artwork, PersonCircle} from '../../../kit/artwork';
import {Button, Focusable} from '../../../kit/controls';
import {FocusRegion} from '../../../kit/focus';
import {alpha, browseType} from '../../../kit/browse/presentation';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeEntryActions} from '../entry-actions';
import type {NativeAudiobookController} from './model';

const t = defaultI18n.t;
type Actions = Pick<NativeEntryActions, 'menu'>;
const seconds = (value: number | undefined) => value === undefined ? undefined : defaultI18n.duration(value);

function BookRow({entry, runtime, tv, position, focusId, onOpen, onPlay, onMore}: {
  entry: ContentEntry; runtime: NativeShellRuntime; tv: boolean; position?: string; focusId: string;
  onOpen: () => void; onPlay: () => void; onMore: () => void;
}) {
  const theme = useTheme(), art = runtime.artwork(entry.posterUrl), progress = entry.bookProgress;
  const left = progress?.remainingMs === undefined ? undefined : seconds(progress.remainingMs / 1000);
  const readBy = entry.narrators?.length ? t('next.kit.readBy', {name: defaultI18n.list(entry.narrators)}) : undefined;
  // The book's own bar is book-wide only: a part's position is not a fraction of
  // the whole book, so it never feeds this.
  const ratio = progress?.positionMs !== undefined && progress.durationMs ? progress.positionMs / progress.durationMs : undefined;
  // collections 44/45 draw the place in small type under the title. The server's
  // chapter index is file-local, so a book-wide "chapter N of M" is not derived
  // from it; the chapter's own title is the place the server actually sent.
  const place = progress?.chapter?.title;
  // collections 41b/41c draw who read it and the time left on the phone; 44/45
  // add the place and the whole length on TV.
  const phoneLine = [readBy, left ? t('next.kit.remaining', {time: left}) : undefined].filter(Boolean).join(' · ');
  const tvLine = [place, left ? t('next.kit.remaining', {time: left}) : undefined].filter(Boolean).join(', ');
  // TV 44/45: OK plays the book, hold OK opens its menu; the rows carry no button.
  // The phone keeps its own row button and opens the book page.
  return <Focusable focusId={focusId} accessibilityRole="button" accessibilityLabel={entry.title} focusKind="row" focusRadius={tv ? 18 : 10}
    onPress={tv ? onPlay : onOpen} onLongPressAction={tv ? onMore : undefined}
    style={tv ? {height: 168, paddingHorizontal: 20, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 32}
      : {height: 76, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 0, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
    <View style={{width: tv ? 128 : 50, height: tv ? 128 : 50, borderRadius: tv ? 10 : 8, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {art ? <Artwork source={art} width={tv ? 128 : 50} height={tv ? 128 : 50}/> : null}
      {ratio === undefined ? null : <View style={{position: 'absolute', left: tv ? 8 : 0, right: tv ? 8 : 0, bottom: tv ? 8 : 0, height: tv ? 6 : 3, borderRadius: tv ? 3 : 0, overflow: 'hidden', backgroundColor: alpha(theme.colors.ink, .55)}}>
        <View style={{width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: tv ? 6 : 3, backgroundColor: theme.colors.accentStrong}}/>
      </View>}
    </View>
    <View style={{flex: 1, minWidth: 0, gap: tv ? 5 : 3}}>
      {position ? <Text numberOfLines={1} style={[browseType(theme, tv ? 20 : 11.5, 700), {color: tv ? theme.colors.accentStrong : theme.colors.textTertiary}]}>{t('next.reader.bookNumber', {number: position})}</Text> : null}
      <Text numberOfLines={1} style={[browseType(theme, tv ? 32 : 15.5, 700), {color: theme.colors.text}]}>{entry.title}</Text>
      {tv ? <>
        {readBy ? <Text numberOfLines={1} style={[browseType(theme, 22, 400), {color: theme.colors.textTertiary}]}>{readBy}</Text> : null}
        {tvLine ? <Text numberOfLines={1} style={[browseType(theme, 22, 600), {color: theme.colors.accentStrong}]}>{tvLine}</Text> : null}
      </> : phoneLine ? <Text numberOfLines={1} style={[browseType(theme, 12.5, 400), {color: theme.colors.textSecondary}]}>{phoneLine}</Text> : null}
    </View>
    {tv && entry.duration !== undefined ? <Text style={[browseType(theme, 24, 400), {width: 200, textAlign: 'right', color: theme.colors.textSecondary, fontVariant: ['tabular-nums']}]}>{seconds(entry.duration)}</Text> : null}
    {!tv ? <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('card.more', {title: entry.title})} onPress={onMore}
      style={{height: 36, width: 36}}/> : null}
  </Focusable>;
}

/** Frames 41b/41c, 44 and 45: the canonical author and series book rows. */
export function AuthorSeriesScreen({controller, entry, runtime, actions, openEntry, onBack}: {
  controller: NativeAudiobookController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions;
  openEntry: (entry: ContentEntry) => void; onBack?: () => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets();
  const entity = snapshot.entity ?? entry, tv = theme.isTV;
  const books = snapshot.sections.find(section => section.id === 'books')?.entries ?? [];
  // collections 41c/45: the series page's author opens the author destination.
  // The entry exists only when the projection named a real author identity.
  const authorEntry = (snapshot.sections.find(section => section.id === 'context')?.entries ?? []).find(value => value.kind === 'author');
  const covers = books.flatMap(book => {const art = runtime.artwork(book.posterUrl); return art ? [art] : [];});
  // collections 45: Resume continues the book this profile is actually in — the
  // listening journey names it, and a book's own progress names its part. Neither
  // is guessed from order.
  const listeningId = snapshot.listening?.resume?.itemId;
  const resume = (listeningId === undefined ? undefined : books.find(book => book.bookProgress?.itemId === listeningId))
    ?? books.find(book => book.bookProgress?.itemId);
  const series = entry.kind === 'book_series';
  const author = series ? books[0]?.author ?? books[0]?.subtitle : undefined;
  const narrators = [...new Set([...(entity.narrators ?? []), ...books.flatMap(book => book.narrators ?? [])])];
  const facts = [entity.count === undefined ? undefined : t('next.kit.books', {count: entity.count}),
    entity.duration === undefined ? undefined : seconds(entity.duration)].filter((value): value is string => !!value);
  const coverPath = series ? books[0]?.posterUrl ?? entity.posterUrl : entity.posterUrl;
  const title = entity.displayTitle ?? entity.title;
  // A file-local chapter index is not a book-wide chapter number, so the drawn
  // label names the book, exactly as frame 44 draws "Resume The Martian".
  const resumeLabel = resume ? t('next.browse.resume', {title: resume.title}) : t('entry.play');
  const open = (book: ContentEntry) => openEntry(book);
  const start = () => {if (resume) void controller.resumeBook(resume).catch(error => runtime.reportError(error)); else if (books[0]) open(books[0]);};
  // A row plays the book it names when this profile already has a place in it;
  // with no place there is nothing to resume, so the row opens the book page,
  // which is where the first chapter can be started.
  const playBook = (book: ContentEntry) => book.bookProgress?.itemId
    ? void controller.resumeBook(book).catch(error => runtime.reportError(error)) : open(book);
  const regionId = `audiobook-${entry.id}`, resumeFocusId = `${regionId}.resume`, startFocusId = `${regionId}.start`,
    moreFocusId = `${regionId}.more`, bookFocus = `${regionId}.book`;
  const body = <>
    {tv && series ? <View style={{position: 'absolute', left: 200, top: 120, width: 380, height: 380}}>
      {runtime.ambient(coverPath) ? <View pointerEvents="none" style={{position: 'absolute', left: -26, top: -26, width: 432, height: 432, borderRadius: 18, overflow: 'hidden'}}>
        <AmbientArt source={runtime.ambient(coverPath)} treatment="cover"/>
      </View> : null}
      <View style={{width: 380, height: 380, borderRadius: 16, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        {runtime.artwork(coverPath) ? <Artwork source={runtime.artwork(coverPath)} width={380} height={380} priority/> : null}
      </View>
    </View> : null}
    {tv && !series ? <View style={{position: 'absolute', left: 200, top: 120}}><PersonCircle covers={covers} initials={[...title.trim()][0] ?? ''} alt={title} size={380} visible/></View> : null}
    {!tv ? <View style={{marginTop: 4}}>{series
      ? <View style={{width: 232, height: 232}}>
        {runtime.ambient(coverPath) ? <View pointerEvents="none" style={{position: 'absolute', left: -16, top: -16, width: 264, height: 264, borderRadius: 16, overflow: 'hidden'}}>
          <AmbientArt source={runtime.ambient(coverPath)} treatment="cover"/>
        </View> : null}
        <View style={{width: 232, height: 232, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.raised}}>{runtime.artwork(coverPath) ? <Artwork source={runtime.artwork(coverPath)} width={232} height={232} priority/> : null}</View>
      </View>
      : <PersonCircle covers={covers} initials={[...title.trim()][0] ?? ''} alt={title} size={164} visible/>}</View> : null}
    <View style={tv ? {position: 'absolute', left: 700, top: 150, width: 1040} : {alignItems: 'center', marginTop: 18, width: '100%'}}>
      <Text style={[browseType(theme, tv ? 24 : 13, 700), {color: theme.colors.textSecondary, textAlign: tv ? 'left' : 'center'}]}>{t('title.kind', {kind: entry.kind})}</Text>
      <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, tv ? 76 : 30, 800, -.04), {color: theme.colors.text, textAlign: tv ? 'left' : 'center', marginTop: 8}]}>{title}</Text>
      {!tv && (author || authorEntry) ? (authorEntry && openEntry
        ? <Focusable focusId="series-author-link" accessibilityRole="link" accessibilityLabel={authorEntry.title} onPress={() => openEntry(authorEntry)} style={{marginTop: 6, paddingVertical: 2}}>
          {({focused}) => <Text style={[browseType(theme, 16, 700), {color: theme.colors.text, textAlign: 'center', textDecorationLine: focused ? 'underline' : 'none'}]}>{author ?? authorEntry.title}</Text>}
        </Focusable>
        : <Text style={[browseType(theme, 16, 700), {color: theme.colors.text, marginTop: 6}]}>{author}</Text>) : null}
      <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: tv ? 'flex-start' : 'center', alignItems: 'center', columnGap: 18, rowGap: 6, marginTop: 10}}>
        {tv && (author || authorEntry) ? (authorEntry && openEntry
          ? <Focusable focusId="series-author-link" accessibilityRole="link" accessibilityLabel={authorEntry.title} onPress={() => openEntry(authorEntry)} style={{paddingVertical: 2}}>
            {({focused}) => <Text style={[browseType(theme, 24, 700), {color: theme.colors.text, textDecorationLine: focused ? 'underline' : 'none'}]}>{author ?? authorEntry.title}</Text>}
          </Focusable>
          : <Text style={[browseType(theme, 24, 700), {color: theme.colors.text}]}>{author}</Text>) : null}
        {facts.map((fact, index) => <Text key={fact} style={[browseType(theme, tv ? 24 : 13, index === 0 ? 700 : 400), {color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
      </View>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: tv ? 18 : 10, marginTop: tv ? 26 : 18, alignSelf: tv ? 'flex-start' : 'stretch'}}>
        <Button focusId={resumeFocusId} icon="i-play" onPress={start} accessibilityLabel={resumeLabel} hasTVPreferredFocus={tv} style={{flex: tv ? undefined : 1, minWidth: tv ? 320 : undefined}}>{resumeLabel}</Button>
        {series && books[0] ? <Button focusId={startFocusId} variant="glass" icon="i-restart" iconOnly={!tv} onPress={() => open(books[0]!)} accessibilityLabel={t(tv ? 'action.startSeriesOver' : 'action.startOver')}>{tv ? t('action.startSeriesOver') : undefined}</Button> : null}
        {tv ? <Button focusId={moreFocusId} variant="glass" iconOnly icon="i-more" accessibilityLabel={t('card.more', {title})} onPress={() => actions.menu(entity)}/> : null}
      </View>
    </View>
    <View style={tv ? {position: 'absolute', left: 700, top: 560, width: 1040} : {width: '100%', marginTop: 22}}>
      {/* collections 44/45 draw the rows without a section heading; 41b/41c
          keep the heading above the list on the phone. */}
      {!tv ? <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 6}}>
        <Text style={[browseType(theme, 20, 700), {color: theme.colors.text}]}>{t(series ? 'next.kit.booksInSeries' : 'next.kit.booksHeading')}</Text>
        <Text style={[browseType(theme, 14, 600), {color: theme.colors.textTertiary}]}>{entity.count ?? books.length}</Text>
      </View> : null}
      {/* collections 41c/45: the rows keep the server's own order and only a
          server-sent series position is labelled; nothing is numbered by index. */}
      {books.map(book => <BookRow key={book.id} entry={book} runtime={runtime} tv={tv} focusId={`${bookFocus}-${book.id}`}
        position={series ? book.series?.[0]?.position : undefined} onOpen={() => open(book)} onPlay={() => playBook(book)} onMore={() => actions.menu(book)}/>)}
      {!tv && !series && (narrators.length || entity.duration !== undefined) ? <View style={{marginTop: 20}}>
        <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 4}]}>{t('title.details')}</Text>
        {narrators.length ? <View style={{paddingVertical: 10, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
          <Text style={[browseType(theme, 14, 600), {color: theme.colors.text}]}>{t('next.kit.narrators')}</Text>
          <Text style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary, marginTop: 2}]}>{defaultI18n.list(narrators)}</Text>
        </View> : null}
        {entity.duration === undefined ? null : <View style={{paddingVertical: 10, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
          <Text style={[browseType(theme, 14, 600), {color: theme.colors.text}]}>{t('next.kit.length')}</Text>
          <Text style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary, marginTop: 2}]}>{seconds(entity.duration)}</Text>
        </View>}
      </View> : null}
    </View>
  </>;
  return <View testID={tv ? 'native-tv-audiobook-collection' : 'native-phone-audiobook-collection'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
      <View style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}/>
      {runtime.ambient(coverPath) ? <AmbientArt source={runtime.ambient(coverPath)} treatment="title" style={{position: 'absolute', inset: 0}}/> : null}
      <View style={{position: 'absolute', inset: 0, backgroundColor: alpha(theme.colors.ink, .45)}}/>
    </View>
    {!tv && onBack ? <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/> : null}
    {!tv ? <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('card.more', {title})} onPress={() => actions.menu(entity)}
      style={{position: 'absolute', top: insets.top + 6, right: 10, zIndex: 10, height: 44, width: 44}}/> : null}
    <ScrollView contentContainerStyle={tv ? {paddingBottom: 64} : {paddingTop: Math.max(104, insets.top + 56), paddingBottom: 48}}>
      {tv ? <FocusRegion id={regionId} entry={resumeFocusId} orientation="free" style={{width: 1920, height: 1120}}>{body}</FocusRegion>
        : <View style={{alignItems: 'center', paddingHorizontal: 20}}>{body}</View>}
    </ScrollView>
  </View>;
}
