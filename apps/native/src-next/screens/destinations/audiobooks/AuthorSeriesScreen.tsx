import React, {useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {AmbientArt, Artwork, PersonCircle} from '../../../kit/artwork';
import {Button, Focusable} from '../../../kit/controls';
import {alpha, browseType} from '../../../kit/browse/presentation';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeEntryActions} from '../entry-actions';
import type {NativeAudiobookController} from './model';

const t = defaultI18n.t;
type Actions = Pick<NativeEntryActions, 'menu'>;
const seconds = (value: number | undefined) => value === undefined ? undefined : defaultI18n.duration(value);

function BookRow({entry, runtime, tv, position, onOpen, onMore}: {
  entry: ContentEntry; runtime: NativeShellRuntime; tv: boolean; position?: string; onOpen: () => void; onMore: () => void;
}) {
  const theme = useTheme(), art = runtime.artwork(entry.posterUrl), progress = entry.bookProgress;
  const state = progress?.chapter ? t('next.kit.chapterOf', {number: progress.chapter.index, total: entry.count ?? 0}) : undefined;
  const left = progress?.remainingMs === undefined ? undefined : seconds(progress.remainingMs / 1000);
  const readBy = entry.narrators?.length ? t('next.kit.readBy', {name: defaultI18n.list(entry.narrators)}) : undefined;
  const ratio = progress?.positionMs !== undefined && progress.durationMs ? progress.positionMs / progress.durationMs
    : progress?.partPositionMs !== undefined && progress.durationMs ? progress.partPositionMs / progress.durationMs : undefined;
  // collections 41b/41c draw who read it and the time left on the phone; 44/45
  // add the chapter state and the whole length on TV.
  const phoneLine = [readBy, left ? t('next.kit.remaining', {time: left}) : undefined].filter(Boolean).join(' · ');
  const tvLine = [state, left ? t('next.kit.remaining', {time: left}) : undefined].filter(Boolean).join(', ');
  return <Focusable accessibilityRole="button" accessibilityLabel={entry.title} focusKind="row" focusRadius={10} onPress={onOpen}
    style={{height: tv ? 104 : 76, flexDirection: 'row', alignItems: 'center', gap: tv ? 20 : 12, paddingHorizontal: tv ? 18 : 0,
      borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
    <View style={{width: tv ? 72 : 50, height: tv ? 72 : 50, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {art ? <Artwork source={art} width={tv ? 72 : 50} height={tv ? 72 : 50}/> : null}
      {ratio === undefined ? null : <View style={{position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: alpha(theme.colors.ink, .55)}}>
        <View style={{width: `${Math.max(0, Math.min(1, ratio)) * 100}%`, height: 3, backgroundColor: theme.colors.accentStrong}}/>
      </View>}
    </View>
    <View style={{flex: 1, minWidth: 0, gap: 3}}>
      {position ? <Text numberOfLines={1} style={[browseType(theme, tv ? 19 : 11.5, 600), {color: theme.colors.textTertiary}]}>{t('next.reader.bookNumber', {number: position})}</Text> : null}
      <Text numberOfLines={1} style={[browseType(theme, tv ? 24 : 15.5, 700), {color: theme.colors.text}]}>{entry.title}</Text>
      {tv ? <>
        {readBy ? <Text numberOfLines={1} style={[browseType(theme, 20, 400), {color: theme.colors.textSecondary}]}>{readBy}</Text> : null}
        {tvLine ? <Text numberOfLines={1} style={[browseType(theme, 19, 500), {color: theme.colors.textTertiary}]}>{tvLine}</Text> : null}
      </> : phoneLine ? <Text numberOfLines={1} style={[browseType(theme, 12.5, 400), {color: theme.colors.textSecondary}]}>{phoneLine}</Text> : null}
    </View>
    {tv && entry.duration !== undefined ? <Text style={[browseType(theme, 20, 400), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{seconds(entry.duration)}</Text> : null}
    <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('card.more', {title: entry.title})} onPress={onMore}
      style={{height: tv ? 52 : 36, width: tv ? 52 : 36}}/>
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
  const resume = books.find(book => book.bookProgress?.itemId);
  const series = entry.kind === 'book_series';
  const author = series ? books[0]?.author ?? books[0]?.subtitle : undefined;
  const narrators = [...new Set([...(entity.narrators ?? []), ...books.flatMap(book => book.narrators ?? [])])];
  const facts = [entity.count === undefined ? undefined : t('next.kit.books', {count: entity.count}),
    entity.duration === undefined ? undefined : seconds(entity.duration)].filter((value): value is string => !!value);
  const coverPath = series ? books[0]?.posterUrl ?? entity.posterUrl : entity.posterUrl;
  const title = entity.displayTitle ?? entity.title;
  const resumeLabel = resume?.bookProgress?.chapter && series
    ? t('title.resumeChapter', {chapter: t('next.kit.chapter', {number: resume.bookProgress.chapter.index})})
    : resume ? t('next.browse.resume', {title: resume.title}) : t('entry.play');
  const open = (book: ContentEntry) => openEntry(book);
  const start = () => {if (resume) void controller.resumeBook(resume).catch(error => runtime.reportError(error)); else if (books[0]) open(books[0]);};
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
      <View style={tv ? {width: 1920, height: 1120} : {alignItems: 'center', paddingHorizontal: 20}}>
        {tv && series ? <View style={{position: 'absolute', left: 200, top: 120, width: 380, height: 380, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
          {runtime.artwork(coverPath) ? <Artwork source={runtime.artwork(coverPath)} width={380} height={380} priority/> : null}
        </View> : null}
        {tv && !series ? <View style={{position: 'absolute', left: 1280, top: 150}}><PersonCircle covers={covers} initials={[...title.trim()][0] ?? ''} alt={title} size={360} visible/></View> : null}
        {!tv ? <View style={{marginTop: 4}}>{series
          ? <View style={{width: 232, height: 232, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.raised}}>{runtime.artwork(coverPath) ? <Artwork source={runtime.artwork(coverPath)} width={232} height={232} priority/> : null}</View>
          : <PersonCircle covers={covers} initials={[...title.trim()][0] ?? ''} alt={title} size={164} visible/>}</View> : null}
        <View style={tv ? {position: 'absolute', left: series ? 760 : 200, top: series ? 150 : 150, width: series ? 1000 : 940} : {alignItems: 'center', marginTop: 18, width: '100%'}}>
          <Text style={[browseType(theme, tv ? 22 : 13, 700), {color: theme.colors.textSecondary, textAlign: tv ? 'left' : 'center'}]}>{t('title.kind', {kind: entry.kind})}</Text>
          <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, tv ? (series ? 88 : 120) : 30, 800, -.04), {color: theme.colors.text, textAlign: tv ? 'left' : 'center', marginTop: 8}]}>{title}</Text>
          {author || authorEntry ? (authorEntry && openEntry
            ? <Focusable focusId="series-author-link" accessibilityRole="link" accessibilityLabel={authorEntry.title} onPress={() => openEntry(authorEntry)} style={{marginTop: 6, paddingVertical: 2}}>
              {({focused}) => <Text style={[browseType(theme, tv ? 24 : 16, 700), {color: theme.colors.accentStrong, textAlign: tv ? 'left' : 'center', textDecorationLine: focused ? 'underline' : 'none'}]}>{author ?? authorEntry.title}</Text>}
            </Focusable>
            : <Text style={[browseType(theme, tv ? 24 : 16, 700), {color: theme.colors.accentStrong, marginTop: 6}]}>{author}</Text>) : null}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: tv ? 'flex-start' : 'center', columnGap: 18, rowGap: 6, marginTop: 10}}>
            {facts.map((fact, index) => <Text key={fact} style={[browseType(theme, tv ? 22 : 13, index === 0 ? 700 : 400), {color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
          </View>
          <View style={{flexDirection: 'row', alignItems: 'center', gap: tv ? 18 : 10, marginTop: tv ? 22 : 18, alignSelf: tv ? 'flex-start' : 'stretch'}}>
            <Button icon="i-play" onPress={start} accessibilityLabel={resumeLabel} hasTVPreferredFocus={tv} style={{flex: tv ? undefined : 1, minWidth: tv ? 320 : undefined}}>{resumeLabel}</Button>
            {series && books[0] ? <Button variant="glass" icon="i-restart" iconOnly={!tv} onPress={() => open(books[0]!)} accessibilityLabel={t('action.startOver')}>{tv ? t('action.startOver') : undefined}</Button> : null}
            {tv ? <Button variant="glass" iconOnly icon="i-more" accessibilityLabel={t('card.more', {title})} onPress={() => actions.menu(entity)}/> : null}
          </View>
        </View>
        <View style={tv ? {position: 'absolute', left: 760, top: 560, width: 1000} : {width: '100%', marginTop: 22}}>
          {/* collections 44/45 draw the rows without a section heading; 41b/41c
              keep the heading above the list on the phone. */}
          {!tv ? <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 6}]}>{t('next.kit.books', {count: entity.count ?? books.length})}</Text> : null}
          {/* collections 41c/45: the books are in series order, and each row is
              labelled by that order; the author page has no numbers. */}
          {books.map((book, index) => <BookRow key={book.id} entry={book} runtime={runtime} tv={tv} position={series ? book.series?.[0]?.position ?? String(index + 1) : undefined} onOpen={() => open(book)} onMore={() => actions.menu(book)}/>)}
          {!tv && !series && (narrators.length || entity.duration !== undefined) ? <View style={{marginTop: 20}}>
            <Text style={[browseType(theme, 20, 700), {color: theme.colors.text, marginBottom: 4}]}>{t('title.details')}</Text>
            {narrators.length ? <View style={{paddingVertical: 10, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
              <Text style={[browseType(theme, 14, 600), {color: theme.colors.text}]}>{t('web.metadata.field.narrator')}</Text>
              <Text style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary, marginTop: 2}]}>{defaultI18n.list(narrators)}</Text>
            </View> : null}
            {entity.duration === undefined ? null : <View style={{paddingVertical: 10, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
              <Text style={[browseType(theme, 14, 600), {color: theme.colors.text}]}>{t('next.kit.length')}</Text>
              <Text style={[browseType(theme, 13, 400), {color: theme.colors.textSecondary, marginTop: 2}]}>{seconds(entity.duration)}</Text>
            </View>}
          </View> : null}
        </View>
      </View>
    </ScrollView>
  </View>;
}
