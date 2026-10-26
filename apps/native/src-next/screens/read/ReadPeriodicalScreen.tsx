import React, {useLayoutEffect, useState, useSyncExternalStore} from 'react';
import {ScrollView, Text, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n, calendarDate, calendarMonth} from '../../../../../packages/i18n/src';
import type {ReadingPeriodicalIssue, ReadingYearChoice} from '../../../../../packages/client-core/src';
import {Artwork, GeneratedCover} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {Icon} from '../../kit/Icon';
import {Menu} from '../../kit/overlays';
import {StateView, SkeletonBlock} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme, type Theme} from '../../kit/theme';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeReadPeriodical, NativeReadPeriodicalState} from './read-periodical-model';

const {t} = defaultI18n;
const initial = (title: string): string => title.trim().slice(0, 1).toUpperCase() || '·';
type PeriodicalRoute = Extract<NativeShellRoute, {kind: 'read-periodical'}>;

/** tablet-read 10/10b: a magazine's issues or a newspaper's editions from the
 * signed periodical projections. Years, months and days are the server's own
 * choices; the page draws no empty calendar, no cadence, publisher or volume
 * fact the projection does not publish, and opens every issue through the one
 * Reading book door. */
export function ReadPeriodicalScreen({controller, route, runtime, onBack}: {
  controller: NativeReadPeriodical; route: PeriodicalRoute; runtime: NativeShellRuntime; onBack: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets();
  useLayoutEffect(() => {
    if (!controller.arm()) return;
    void controller.load().catch(() => {});
    return () => controller.release();
  }, [controller, route]);
  const magazine = route.publicationType === 'magazine';
  // Every action hands the controller the exact state this render drew, so a
  // retained control can never act under a successor page.
  const open = (issue: ReadingPeriodicalIssue) => {void controller.open(state, issue).catch(runtime.reportError);};
  const selectYear = (choice: ReadingYearChoice) => {void controller.selectYear(state, choice).catch(runtime.reportError);};
  const selectMonth = (month: string) => {void controller.selectMonth(state, month).catch(runtime.reportError);};
  const selectDate = (date: string) => {controller.selectDate(state, date);};
  const more = () => {if (state.nextCursor) void controller.next(state).catch(runtime.reportError);};
  // Older real months come from the archive's own bounded cursor, never from the
  // first sixty issues as if they were the whole archive.
  const moreMonths = () => {if (state.archiveCursor) void controller.moreMonths(state).catch(runtime.reportError);};
  return <View testID={`native-read-periodical-${route.groupId}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(96, insets.top + 56), paddingBottom: insets.bottom + 48}} showsVerticalScrollIndicator={false}
      scrollEventThrottle={64}
      onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (!magazine && contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) more();}}>
      {state.phase === 'error' ? <StateView {...runtime.error(state.error, () => {void controller.retry().catch(runtime.reportError);}, 'library')}/> : null}
      <LoadingBoundary ready={state.phase === 'ready'} immediate={state.phase === 'ready'} skeleton={<SkeletonBlock width="100%" height={360}/>}>
      {state.phase === 'ready' ? <View style={{width: '100%', maxWidth: magazine ? 1180 : 900, alignSelf: 'center'}}>
        <PeriodicalHero state={state} magazine={magazine} runtime={runtime} theme={theme} onOpen={open}/>
        {magazine ? <MagazineIssues state={state} theme={theme} runtime={runtime} onOpen={open} onYear={selectYear} onNext={more}/>
          : <NewspaperEditions state={state} theme={theme} runtime={runtime} onOpen={open} onMonth={selectMonth} onDate={selectDate} onMonths={moreMonths}/>}
      </View> : null}
      </LoadingBoundary>
    </ScrollView>
  </View>;
}

/** The drawn group hero: the latest issue's own cover beside its real facts. */
function PeriodicalHero({state, magazine, runtime, theme, onOpen}: {
  state: NativeReadPeriodicalState; magazine: boolean; runtime: NativeShellRuntime; theme: Theme; onOpen: (issue: ReadingPeriodicalIssue) => void;
}) {
  const latest = state.latest, item = latest?.item, cover = runtime.artwork(item?.coverUrl), tint = generatedCoverTint(state.groupName ?? '');
  // The hero reads the group's canonical latest issue, even after an older year is
  // selected; the door admits that exact object alongside this page's own issues.
  const readable = latest && latest.item.inventoryAvailable === true ? latest : undefined;
  const years = state.years.map(value => value.value);
  const range = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0];
  const latestDate = latest ? calendarDate(defaultI18n, latest.issueDate) : '';
  return <View style={{paddingHorizontal: 20}}>
    <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 18}}>
      <View style={{width: 120, height: 160, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
        {cover ? <Artwork source={cover} width={120} height={160} priority/>
          : <GeneratedCover title={state.groupName ?? ''} tint={tint} glyph={initial(state.groupName ?? '')} width={120} height={160}/>}
      </View>
      <View style={{flex: 1, minWidth: 0}}>
        <Text style={[browseType(theme, 12.5, 700), {color: theme.colors.textSecondary}]}>
          {t(magazine ? 'library.tab.magazines' : 'library.tab.newspapers')}
        </Text>
        <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, 30, 800, -.02), {color: theme.colors.text, marginTop: 4}]}>{state.groupName ?? ''}</Text>
        <View style={{flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 6}}>
          {state.issueCount !== undefined ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{t('next.reader.issueCount', {count: state.issueCount})}</Text> : null}
          {range ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{range}</Text> : null}
        </View>
      </View>
    </View>
    {readable ? <View style={{marginTop: 16}}>
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
        <Button icon="i-book" onPress={() => onOpen(readable)} style={{flex: 1}}>{t('next.reader.read')}</Button>
      </View>
      {latestDate ? <Text style={[browseType(theme, 12.5, 600), {color: theme.colors.textTertiary, marginTop: 6}]}>{latestDate}</Text> : null}
    </View> : null}
  </View>;
}

/** The drawn year strips and the selected year's issue track. */
function MagazineIssues({state, theme, runtime, onOpen, onYear, onNext}: {
  state: NativeReadPeriodicalState; theme: Theme; runtime: NativeShellRuntime;
  onOpen: (issue: ReadingPeriodicalIssue) => void; onYear: (choice: ReadingYearChoice) => void; onNext: () => void;
}) {
  const selected = state.years.find(year => year.value === state.selectedYear);
  const width = 150, height = 200;
  if (!state.years.length) return null;
  return <View style={{marginTop: 24}}>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingHorizontal: 20}}>
      {state.years.map(year => <Focusable key={year.value} accessibilityRole="button" accessibilityLabel={year.value}
        accessibilityState={{selected: year.value === state.selectedYear}} focusKind="row" focusRadius={9}
        onPress={() => onYear(year)}
        style={{height: 34, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center',
          backgroundColor: year.value === state.selectedYear ? theme.colors.text : alpha(theme.colors.text, .08)}}>
        <Text style={[browseType(theme, 13.5, 700), {color: year.value === state.selectedYear ? theme.colors.ink : theme.colors.textSecondary}]}>{year.value}</Text>
      </Focusable>)}
    </ScrollView>
    {selected && state.items.length ? <View style={{marginTop: 20}}>
      <View style={{flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 20, marginBottom: 10}}>
        <Text style={[browseType(theme, 21, 700, -.015), {color: theme.colors.text}]}>{selected.value}</Text>
        <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{t('next.reader.issueCount', {count: selected.count})}</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 14, paddingHorizontal: 20, paddingBottom: 4}}
        scrollEventThrottle={64}
        onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
          if (contentSize.width - contentOffset.x - layoutMeasurement.width < 600) onNext();}}>
        {state.items.map(issue => <IssueCard key={issue.item.id} issue={issue} width={width} height={height} theme={theme} runtime={runtime} onOpen={() => onOpen(issue)}/>)}
      </ScrollView>
    </View> : null}
  </View>;
}

/** The drawn newspaper month: the month's real day choices in their real
 * weekday columns, then the editions the server listed for the chosen day. */
function NewspaperEditions({state, theme, runtime, onOpen, onMonth, onDate, onMonths}: {
  state: NativeReadPeriodicalState; theme: Theme; runtime: NativeShellRuntime;
  onOpen: (issue: ReadingPeriodicalIssue) => void; onMonth: (month: string) => void; onDate: (date: string) => void; onMonths: () => void;
}) {
  const [dateOpen, setDateOpen] = useState(false);
  if (!state.selectedMonth) return null;
  const geometry = calendarMonth(defaultI18n, state.selectedMonth);
  if (!geometry) return null;
  const days = new Map(state.days.map(day => [day.value, day.count]));
  const index = state.months.indexOf(state.selectedMonth);
  const older = index >= 0 ? state.months[index + 1] : undefined;
  const newer = index > 0 ? state.months[index - 1] : undefined;
  const day = state.selectedDate, dayIssues = day === undefined ? [] : state.items.filter(issue => issue.issueDate === day);
  return <View style={{marginTop: 24}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 12}}>
      {older ? <Focusable accessibilityRole="button" accessibilityLabel={calendarDate(defaultI18n, older)} focusKind="row"
        onPress={() => onMonth(older)} style={{width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'}}>
        <Icon name="i-left" size={18} color={theme.colors.textSecondary}/>
      </Focusable> : null}
      <Text style={[browseType(theme, 21, 700, -.015), {color: theme.colors.text}]}>{geometry.label}</Text>
      {newer ? <Focusable accessibilityRole="button" accessibilityLabel={calendarDate(defaultI18n, newer)} focusKind="row"
        onPress={() => onMonth(newer)} style={{width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center'}}>
        <Icon name="i-right" size={18} color={theme.colors.textSecondary}/>
      </Focusable> : null}
      {state.days.length ? <Focusable accessibilityRole="button" accessibilityLabel={t('next.reader.goToDate')} focusKind="chip"
        onPress={() => setDateOpen(true)} style={{marginLeft: 'auto', height: 34, paddingHorizontal: 12, borderRadius: 9, justifyContent: 'center',
          backgroundColor: alpha(theme.colors.text, .08)}}>
        <Text style={[browseType(theme, 12.5, 700), {color: theme.colors.textSecondary}]}>{t('next.reader.goToDate')}</Text>
      </Focusable> : null}
      {state.archiveCursor ? <Focusable accessibilityRole="button" accessibilityLabel={t('action.showMore')} focusKind="row"
        onPress={onMonths} style={{height: 36, paddingHorizontal: 12, justifyContent: 'center'}}>
        <Text style={[browseType(theme, 13, 700), {color: theme.colors.accentStrong}]}>{t('action.showMore')}</Text>
      </Focusable> : null}
    </View>
    {/* The drawn Go to a date chip lists only the month's own canonical day
        choices, so the calendar never offers a day the server did not publish. */}
    <Menu open={dateOpen} onOpenChange={setDateOpen} title={t('next.reader.goToDate')}
      items={state.days.map(day => ({id: day.value, label: calendarDate(defaultI18n, day.value), selected: day.value === state.selectedDate,
        onSelect: () => {setDateOpen(false); onDate(day.value);}}))}/>
    <View style={{paddingHorizontal: 20}}>
      <View style={{flexDirection: 'row', marginBottom: 6}}>
        {geometry.weekdays.map(label => <Text key={label} style={[browseType(theme, 11.5, 600), {flex: 1, textAlign: 'center', color: theme.colors.textTertiary}]}>{label}</Text>)}
      </View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
        {Array.from({length: geometry.offset}, (_, index) => <View key={`pad-${index}`} style={{width: `${100 / 7}%`, height: 54}}/>)}
        {geometry.dates.map(date => {
          const count = days.get(date);
          if (count === undefined) return <View key={date} style={{width: `${100 / 7}%`, height: 54}}/>;
          const chosen = date === day;
          return <Focusable key={date} accessibilityRole="button" accessibilityLabel={calendarDate(defaultI18n, date)}
            accessibilityState={{selected: chosen}} focusKind="row" focusRadius={8} onPress={() => onDate(date)}
            style={{width: `${100 / 7}%`, height: 54, padding: 3}}>
            <View style={{flex: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
              backgroundColor: chosen ? theme.colors.text : alpha(theme.colors.text, .06)}}>
              <Text style={[browseType(theme, 13.5, 700), {color: chosen ? theme.colors.ink : theme.colors.text}]}>{date.slice(8, 10)}</Text>
              {count > 1 ? <Text style={[browseType(theme, 9.5, 600), {color: chosen ? theme.colors.ink : theme.colors.textTertiary}]}>{count}</Text> : null}
            </View>
          </Focusable>;
        })}
      </View>
    </View>
    {dayIssues.length ? <View style={{marginTop: 18}}>
      {dayIssues.map(issue => <Focusable key={issue.item.id} accessibilityRole="button" accessibilityLabel={issue.item.title}
        onPress={() => onOpen(issue)} focusKind="row" focusRadius={10}
        style={{marginHorizontal: 20, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
        <View style={{width: 56, height: 75, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
          {runtime.artwork(issue.item.coverUrl) ? <Artwork source={runtime.artwork(issue.item.coverUrl)} width={56} height={75}/>
            : <GeneratedCover title={issue.item.title} tint={generatedCoverTint(issue.item.title)} glyph={initial(issue.item.title)} width={56} height={75}/>}
        </View>
        <View style={{flex: 1, minWidth: 0}}>
          <Text numberOfLines={2} style={[browseType(theme, 15, 700), {color: theme.colors.text}]}>{issue.item.title}</Text>
          <Text style={[browseType(theme, 12.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{calendarDate(defaultI18n, issue.issueDate)}</Text>
        </View>
        <Text style={[browseType(theme, 13, 700), {color: theme.colors.accentStrong}]}>{t('next.reader.read')}</Text>
      </Focusable>)}
    </View> : null}
  </View>;
}

function IssueCard({issue, width, height, theme, runtime, onOpen}: {
  issue: ReadingPeriodicalIssue; width: number; height: number; theme: Theme;
  runtime: NativeShellRuntime; onOpen: () => void;
}) {
  const date = calendarDate(defaultI18n, issue.issueDate);
  return <Focusable accessibilityRole="button" accessibilityLabel={`${issue.item.title}${date ? `. ${date}` : ''}`} focusKind="row" focusRadius={10} onPress={onOpen} style={{width}}>
    <View style={{width, height, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {runtime.artwork(issue.item.coverUrl) ? <Artwork source={runtime.artwork(issue.item.coverUrl)} width={width} height={height}/>
        : <GeneratedCover title={issue.item.title} tint={generatedCoverTint(issue.item.title)} glyph={initial(issue.item.title)} width={width} height={height}/>}
    </View>
    <Text numberOfLines={2} style={[browseType(theme, 13, 600), {color: theme.colors.text, marginTop: 7}]}>{issue.item.title}</Text>
    {date ? <Text numberOfLines={1} style={[browseType(theme, 11.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{date}</Text> : null}
  </Focusable>;
}
