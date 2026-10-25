import React, {useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {defaultI18n} from '../../../../../../packages/i18n/src';
import {presentError} from '../../../../../../packages/client-core/src/presentation/errors';
import type {ContentEntry} from '../../../../../../packages/client-core/src/library-content';
import {AmbientArt, Artwork} from '../../../kit/artwork';
import {Button, Focusable} from '../../../kit/controls';
import {Icon} from '../../../kit/Icon';
import {StateView} from '../../../kit/states';
import {alpha, browseType} from '../../../kit/browse/presentation';
import {useTheme} from '../../../kit/theme';
import type {NativeShellRuntime} from '../../../shell/runtime';
import type {NativeEntryActions} from '../entry-actions';
import {askNativeDownload} from '../../downloads/request';
import {nativeDownloadRequest} from '../../watch/download-request';
import type {NativeAudiobookController} from './model';

const t = defaultI18n.t;
type Actions = Pick<NativeEntryActions, 'menu'>;

const chapterIndex = (entry: ContentEntry): number | undefined => {
  const value = entry.id.includes(':') ? Number(entry.id.slice(entry.id.lastIndexOf(':') + 1)) : undefined;
  return value !== undefined && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
};
const duration = (seconds: number | undefined) => seconds === undefined ? undefined : defaultI18n.duration(seconds);
const chapterDuration = (entry: ContentEntry) => duration(entry.duration);

function ErrorState({error, retry}: {error: unknown; retry: () => void}) {
  const presented = presentError(error, 'detail', {operation: 'load'});
  return <StateView variant="inline" title={presented.title} body={presented.body}
    {...(presented.action === 'try-again' || presented.action === 'refresh' ? {primaryAction: {id: 'retry', label: presented.actionLabel ?? t('action.tryAgain'), onPress: retry}} : {})}/>;
}

function Cover({runtime, path, size}: {runtime: NativeShellRuntime; path: string | undefined; size: number}) {
  const source = runtime.artwork(path), theme = useTheme();
  return <View style={{width: size, height: size, borderRadius: 12, overflow: 'hidden', backgroundColor: theme.colors.raised,
    shadowColor: theme.colors.shadow, shadowOffset: {width: 0, height: 24}, shadowOpacity: .85, shadowRadius: 28}}>
    {source ? <Artwork source={source} width={size} height={size} priority/> : null}
  </View>;
}

function ChapterRows({controller, entries, current, progress, runtime, tv}: {
  controller: NativeAudiobookController; entries: readonly ContentEntry[]; current?: number; progress: number | undefined; runtime: NativeShellRuntime; tv: boolean;
}) {
  const theme = useTheme();
  return <View style={{marginTop: tv ? 14 : 12}}>
    {entries.map((entry, index) => {
      const number = chapterIndex(entry) ?? index + 1, playing = current === number;
      // collections 41: a finished chapter keeps its row but trades its number
      // for the check and dims. The server sends `watched` only when playback
      // really passed that chapter's end; nothing here infers it.
      const finished = entry.watched === true && !playing;
      return <Focusable key={entry.id} accessibilityRole="button" accessibilityLabel={finished ? `${entry.title}, ${t('title.finished')}` : entry.title} focusKind="row" focusRadius={10}
        onPress={() => {void controller.playChapter(entry).catch(error => runtime.reportError(error));}}
        style={{height: tv ? 72 : 54, paddingHorizontal: tv ? 18 : 4, flexDirection: 'row', alignItems: 'center', gap: tv ? 18 : 12,
          borderTopWidth: index ? 1 : 0, borderTopColor: alpha(theme.colors.line, .7)}}>
        {finished
          ? <View style={{width: tv ? 42 : 24, alignItems: 'center'}}><Icon name="i-check" size={tv ? 20 : 15} color={theme.colors.textTertiary}/></View>
          : <Text style={[browseType(theme, tv ? 22 : 14, 600), {width: tv ? 42 : 24, color: playing ? theme.colors.accentStrong : theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{number}</Text>}
        <Text numberOfLines={1} style={[browseType(theme, tv ? 24 : 15.5, 600), {flex: 1, color: finished ? theme.colors.textTertiary : playing ? theme.colors.accentStrong : theme.colors.text}]}>{entry.title}</Text>
        {chapterDuration(entry) ? <Text style={[browseType(theme, tv ? 21 : 13.5, 400), {color: theme.colors.textTertiary, fontVariant: ['tabular-nums']}]}>{chapterDuration(entry)}</Text> : null}
        {playing && progress !== undefined ? <View style={{position: 'absolute', left: tv ? 18 : 4, right: tv ? 18 : 4, bottom: 0, height: 2, backgroundColor: alpha(theme.colors.accentStrong, .5)}}>
          <View style={{width: `${Math.max(0, Math.min(1, progress)) * 100}%`, height: 2, backgroundColor: theme.colors.accentStrong}}/>
        </View> : null}
      </Focusable>;
    })}
  </View>;
}

/** The drawn phone (41a) and TV (43) book page. Real catalog entity, chapters,
 * resume and container finished mark; author/series links are text until their
 * pages exist, and nothing is invented for a missing fact. */
export function BookScreen({controller, entry, runtime, actions, openEntry, onBack}: {
  controller: NativeAudiobookController; entry: ContentEntry; runtime: NativeShellRuntime; actions: Actions;
  /** Opens an author or series destination the book's own projection names. */
  openEntry?: (entry: ContentEntry) => void; onBack?: () => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets();
  const entity = snapshot.entity ?? entry, tv = theme.isTV;
  const chapters = snapshot.sections.find(section => section.id === 'chapters')?.entries ?? [];
  const parts = snapshot.sections.find(section => section.id === 'files')?.entries ?? [];
  const rows = chapters.length ? chapters : parts;
  // collections 41/43: the projection's own Author & series entries carry the real
  // author and book_series navigation ids; a link exists only when the server sent one.
  const context = snapshot.sections.find(section => section.id === 'context')?.entries ?? [];
  const seriesEntry = context.find(value => value.kind === 'book_series');
  const authorEntry = context.find(value => value.kind === 'author');
  const progress = entity.bookProgress;
  const current = progress?.chapter?.index;
  const progressRatio = progress?.positionMs !== undefined && progress.durationMs ? progress.positionMs / progress.durationMs : progress?.partPositionMs !== undefined && progress.durationMs ? progress.partPositionMs / progress.durationMs : undefined;
  const remaining = progress?.remainingMs === undefined ? undefined : duration(progress.remainingMs / 1000);
  const facts = [entity.author, entity.narrators?.length ? t('next.kit.readBy', {name: defaultI18n.list(entity.narrators ?? [])}) : undefined,
    entity.duration === undefined ? undefined : duration(entity.duration), entity.count === undefined ? undefined : t('title.chapterCount', {count: entity.count})].filter((value): value is string => !!value);
  const resume = snapshot.listening?.resume;
  const canResume = !!resume && !snapshot.listening?.resumeUnavailable;
  const resumeLabel = canResume && current !== undefined ? t('title.resumeChapter', {chapter: t('next.kit.chapter', {number: current})}) : t(canResume ? 'entry.resume' : 'entry.play');
  const onPlay = () => {void (canResume ? controller.resume() : controller.startOver()).catch(error => runtime.reportError(error));};
  const retry = () => {void controller.load();};
  // phone-player 41: Download sits beside Finished; mobile web has none, and the TV
  // page draws Resume, Start over and More only (collections 43).
  const download = nativeDownloadRequest(entity);
  return <View testID={tv ? 'native-tv-book' : 'native-phone-book'} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <View pointerEvents="none" style={{position: 'absolute', inset: 0, overflow: 'hidden'}}>
      <View style={{position: 'absolute', inset: 0, backgroundColor: theme.colors.ink}}/>
      {runtime.ambient(entity.posterUrl) ? <AmbientArt source={runtime.ambient(entity.posterUrl)} treatment="title" style={{position: 'absolute', inset: 0}}/> : null}
      <View style={{position: 'absolute', inset: 0, backgroundColor: alpha(theme.colors.ink, .45)}}/>
    </View>
    {!tv && onBack ? <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/> : null}
    {!tv && <Button variant="icon" icon="i-more" iconOnly accessibilityLabel={t('card.more', {title: entity.title})} onPress={() => actions.menu(entity)}
      style={{position: 'absolute', top: insets.top + 6, right: 10, zIndex: 10, height: 44, width: 44}}/>}
    <ScrollView contentContainerStyle={tv ? {paddingBottom: 64} : {paddingTop: Math.max(104, insets.top + 56), paddingBottom: 48}} showsVerticalScrollIndicator={false}>
      <View style={tv ? {width: 1920, height: 1120} : {alignItems: 'center', paddingHorizontal: 20}}>
        <View style={tv ? {position: 'absolute', left: 200, top: 150} : undefined}><Cover runtime={runtime} path={entity.posterUrl} size={tv ? 480 : 232}/></View>
        <View style={tv ? {position: 'absolute', left: 760, top: 150, width: 1000} : {alignItems: 'center', marginTop: 20, width: '100%'}}>
          {entity.series?.[0] || seriesEntry ? <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: tv ? 'flex-start' : 'center', flexWrap: 'wrap'}}>
            {seriesEntry && openEntry
              ? <Focusable focusId="book-series-link" accessibilityRole="link" accessibilityLabel={seriesEntry.title} onPress={() => openEntry(seriesEntry)} style={{paddingVertical: 2}}>
                {({focused}) => <Text style={[browseType(theme, tv ? 22 : 13, 600), {color: theme.colors.accentStrong, textDecorationLine: focused ? 'underline' : 'none'}]}>{entity.series?.[0]?.name ?? seriesEntry.title}</Text>}
              </Focusable>
              : <Text style={[browseType(theme, tv ? 22 : 13, 600), {color: theme.colors.accentStrong}]}>{entity.series?.[0]?.name}</Text>}
            {entity.series?.[0]?.position ? <Text style={[browseType(theme, tv ? 22 : 13, 600), {color: theme.colors.accentStrong}]}>{t('title.bookInSeries', {number: entity.series[0].position})}</Text> : null}
          </View> : null}
          <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, tv ? 88 : 30, 800, -.04), {color: theme.colors.text, textAlign: tv ? 'left' : 'center', marginTop: tv ? 10 : 6}]}>{entity.displayTitle ?? entity.title}</Text>
          {entity.author || authorEntry ? (authorEntry && openEntry
            ? <Focusable focusId="book-author-link" accessibilityRole="link" accessibilityLabel={authorEntry.title} onPress={() => openEntry(authorEntry)} style={{marginTop: 8, paddingVertical: 2}}>
              {({focused}) => <Text style={[browseType(theme, tv ? 24 : 16, 700), {color: theme.colors.accentStrong, textAlign: tv ? 'left' : 'center', textDecorationLine: focused ? 'underline' : 'none'}]}>{entity.author ?? authorEntry.title}</Text>}
            </Focusable>
            : <Text style={[browseType(theme, tv ? 24 : 16, 700), {color: theme.colors.accentStrong, textAlign: tv ? 'left' : 'center', marginTop: 8}]}>{entity.author}</Text>) : null}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', justifyContent: tv ? 'flex-start' : 'center', columnGap: 18, rowGap: 6, marginTop: 10}}>
            {facts.map((fact, index) => <Text key={`${fact}-${index}`} style={[browseType(theme, tv ? 22 : 13, index === 0 ? 700 : 400), {color: index === 0 ? theme.colors.text : theme.colors.textSecondary}]}>{fact}</Text>)}
          </View>
          {remaining ? <View style={{flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, alignSelf: tv ? 'flex-start' : 'center'}}>
            <View style={{width: tv ? 280 : 120, height: 4, borderRadius: 2, backgroundColor: alpha(theme.colors.text, .18)}}><View style={{width: `${Math.max(0, Math.min(1, progressRatio ?? 0)) * 100}%`, height: 4, borderRadius: 2, backgroundColor: theme.colors.accentStrong}}/></View>
            <Text style={[browseType(theme, tv ? 21 : 13, 500), {color: theme.colors.textSecondary}]}>{t('title.resumeRemaining', {remaining})}</Text>
          </View> : null}
          <View style={{flexDirection: 'row', alignItems: 'center', gap: tv ? 18 : 10, marginTop: tv ? 24 : 18, alignSelf: tv ? 'flex-start' : 'stretch'}}>
            <Button icon="i-play" onPress={onPlay} accessibilityLabel={resumeLabel} style={{flex: tv ? undefined : 1, minWidth: tv ? 320 : undefined}}>{resumeLabel}</Button>
            <Button variant="glass" icon="i-restart" onPress={() => {void controller.startOver().catch(error => runtime.reportError(error));}} accessibilityLabel={t('action.startOver')}>{tv ? t('action.startOver') : undefined}</Button>
            {!tv ? <Button variant="glass" iconOnly icon={'i-check'} accessibilityLabel={t('title.markFinished')}
              accessibilityState={{checked: snapshot.finished}} onPress={() => {void controller.markFinished().catch(error => runtime.reportError(error));}}/> : null}
            {!tv && download ? <Button variant="glass" iconOnly icon="i-dl" accessibilityLabel={t('action.download')}
              onPress={() => askNativeDownload(download)}/> : null}
            {tv ? <Button variant="glass" iconOnly icon="i-more" accessibilityLabel={t('card.more', {title: entity.title})} onPress={() => actions.menu(entity)}/> : null}
          </View>
        </View>
        <View style={tv ? {position: 'absolute', left: 760, top: 620, width: 1000} : {width: '100%', marginTop: 22}}>
          {snapshot.phase === 'error' ? <ErrorState error={snapshot.error} retry={retry}/> : null}
          {entity.overview ? <Text style={[browseType(theme, tv ? 22 : 14.5, 400), {color: theme.colors.textSecondary, lineHeight: tv ? 32 : 23}]}>{entity.overview}</Text> : null}
          {rows.length ? <View style={{marginTop: tv ? 24 : 18}}>
            <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 12}}>
              <Text style={[browseType(theme, tv ? 32 : 20, 700), {color: theme.colors.text}]}>{t('next.browse.chapters')}</Text>
              <Text style={[browseType(theme, tv ? 22 : 14, 600), {color: theme.colors.textTertiary}]}>{entity.count ?? rows.length}</Text>
            </View>
            <ChapterRows controller={controller} entries={rows} current={current} progress={progressRatio} runtime={runtime} tv={tv}/>
          </View> : null}
        </View>
      </View>
    </ScrollView>
  </View>;
}
