import React, {useLayoutEffect, useSyncExternalStore} from 'react';
import {ScrollView, Text, View, useWindowDimensions} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {generatedCoverTint} from '@portico/design';
import {defaultI18n} from '../../../../../packages/i18n/src';
import type {ReadingPeriodicalIssue} from '../../../../../packages/client-core/src';
import {Artwork, GeneratedCover} from '../../kit/artwork';
import {Button, Focusable} from '../../kit/controls';
import {StateView, SkeletonBlock} from '../../kit/states';
import {alpha, browseType} from '../../kit/browse/presentation';
import {useTheme, type Theme} from '../../kit/theme';
import type {NativeShellRoute} from '../../shell/routes';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeReadPeriodical} from './read-periodical-model';

const {t} = defaultI18n;
const initial = (title: string): string => title.trim().slice(0, 1).toUpperCase() || '·';
type PeriodicalRoute = Extract<NativeShellRoute, {kind: 'read-periodical'}>;

/** phone/tablet read 10/10b: a magazine or newspaper group from its signed
 * periodical projections. Years, months and days are the server's own choices;
 * the page draws no empty calendar and no invented cadence or publisher. */
export function ReadPeriodicalScreen({controller, route, runtime, onBack}: {
  controller: NativeReadPeriodical; route: PeriodicalRoute; runtime: NativeShellRuntime; onBack: () => void;
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), theme = useTheme(), insets = useSafeAreaInsets(), dimensions = useWindowDimensions();
  useLayoutEffect(() => {
    if (!controller.arm()) return;
    void controller.load().catch(() => {});
    return () => controller.release();
  }, [controller, route]);
  const latest = state.latest?.item, cover = runtime.artwork(latest?.coverUrl), tint = generatedCoverTint(state.groupName ?? '');
  const years = state.years.map(value => value.value);
  const range = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : years[0];
  const yearIssues = state.items.filter(entry => state.selectedYear === undefined || entry.issueDate.startsWith(state.selectedYear + '-'));
  const monthIssues = state.items.filter(entry => state.selectedMonth === undefined || entry.issueDate.startsWith(state.selectedMonth + '-'));
  const dayIssues = state.selectedDate === undefined ? [] : monthIssues.filter(entry => entry.issueDate === state.selectedDate);
  const columns = theme.platform === 'phone' ? 3 : 5, gap = 16;
  const width = Math.max(96, Math.min(150, (dimensions.width - theme.gutter * 2 - gap * (columns - 1)) / columns));
  const open = (issue: ReadingPeriodicalIssue) => {void controller.open(state, issue).catch(runtime.reportError);};
  return <View testID={`native-read-periodical-${route.groupId}`} style={{flex: 1, backgroundColor: theme.colors.ink}}>
    <Button variant="icon" icon="i-left" iconOnly accessibilityLabel={t('action.back')} onPress={onBack}
      style={{position: 'absolute', top: insets.top + 6, left: 10, zIndex: 10, height: 44, width: 44}}/>
    <ScrollView contentContainerStyle={{paddingTop: Math.max(96, insets.top + 56), paddingBottom: insets.bottom + 48}} showsVerticalScrollIndicator={false}
      onScroll={event => {const {contentOffset, contentSize, layoutMeasurement} = event.nativeEvent;
        if (contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height) void controller.next(state).catch(runtime.reportError);}}
      scrollEventThrottle={64}>
      {state.phase === 'error' ? <StateView {...runtime.error(state.error, () => {void controller.retry().catch(runtime.reportError);}, 'library')}/> : null}
      {state.phase !== 'ready' && state.phase !== 'error' ? <SkeletonBlock width="100%" height={360}/> : null}
      {state.phase === 'ready' ? <View style={{width: '100%', maxWidth: 900, alignSelf: 'center'}}>
        <View style={{paddingHorizontal: 20}}>
          <View style={{flexDirection: 'row', alignItems: 'flex-end', gap: 18}}>
            <View style={{width: 112, height: 150, borderRadius: 8, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
              {cover ? <Artwork source={cover} width={112} height={150} priority/>
                : <GeneratedCover title={state.groupName ?? ''} tint={tint} glyph={initial(state.groupName ?? '')} width={112} height={150}/>}
            </View>
            <View style={{flex: 1, minWidth: 0}}>
              <Text style={[browseType(theme, 12.5, 700), {color: theme.colors.textSecondary}]}>
                {t(route.publicationType === 'newspaper' ? 'library.tab.newspapers' : 'library.tab.magazines')}
              </Text>
              <Text accessibilityRole="header" numberOfLines={2} style={[browseType(theme, 26, 800, -.02), {color: theme.colors.text, marginTop: 4}]}>{state.groupName ?? ''}</Text>
              <View style={{flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 4, marginTop: 6}}>
                {state.issueCount !== undefined ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textSecondary}]}>{t('next.reader.issueCount', {count: state.issueCount})}</Text> : null}
                {range ? <Text style={[browseType(theme, 13, 600), {color: theme.colors.textTertiary}]}>{range}</Text> : null}
              </View>
            </View>
          </View>
        </View>
        {route.publicationType === 'magazine' ? <View style={{marginTop: 20}}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingHorizontal: 20}}>
            {state.years.map(year => <Focusable key={year.value} accessibilityRole="button" accessibilityLabel={year.value}
              accessibilityState={{selected: year.value === state.selectedYear}} onPress={() => {void controller.selectYear(state, year).catch(runtime.reportError);}}
              style={{height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: year.value === state.selectedYear ? theme.colors.text : alpha(theme.colors.text, .08)}}>
              <Text style={[browseType(theme, 13, 700), {color: year.value === state.selectedYear ? theme.colors.ink : theme.colors.textSecondary}]}>{year.value}</Text>
            </Focusable>)}
          </ScrollView>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap, paddingHorizontal: 20, marginTop: 16}}>
            {yearIssues.map(issue => <IssueCard key={issue.item.id} issue={issue} width={width} height={width * 4 / 3} theme={theme} runtime={runtime} onOpen={() => open(issue)}/>)}
          </View>
          {yearIssues.length === 0 ? <StateView testID="native-read-periodical-empty" variant="inline" title={t('library.emptyLibrary')} body={t('library.emptyLibraryBody')}/> : null}
        </View> : <View style={{marginTop: 20}}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap: 8, paddingHorizontal: 20}}>
            {state.months.map(month => <Focusable key={month} accessibilityRole="button" accessibilityLabel={month}
              accessibilityState={{selected: month === state.selectedMonth}} onPress={() => {void controller.selectMonth(state, month).catch(runtime.reportError);}}
              style={{height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: month === state.selectedMonth ? theme.colors.text : alpha(theme.colors.text, .08)}}>
              <Text style={[browseType(theme, 13, 700), {color: month === state.selectedMonth ? theme.colors.ink : theme.colors.textSecondary}]}>{month}</Text>
            </Focusable>)}
            {state.archiveCursor ? <Focusable accessibilityRole="button" accessibilityLabel={t('next.controls.more')}
              onPress={() => {void controller.moreMonths(state).catch(runtime.reportError);}}
              style={{height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', borderWidth: 1, borderColor: alpha(theme.colors.text, .24)}}>
              <Text style={[browseType(theme, 13, 700), {color: theme.colors.textSecondary}]}>{t('next.controls.more')}</Text>
            </Focusable> : null}
          </ScrollView>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 20, marginTop: 16}}>
            {state.days.map(day => <Focusable key={day.value} accessibilityRole="button" accessibilityLabel={day.value}
              accessibilityState={{selected: day.value === state.selectedDate}} onPress={() => controller.selectDate(state, day.value)}
              style={{width: 56, height: 56, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
                backgroundColor: day.value === state.selectedDate ? theme.colors.text : alpha(theme.colors.text, .08)}}>
              <Text style={[browseType(theme, 15, 700), {color: day.value === state.selectedDate ? theme.colors.ink : theme.colors.text}]}>{day.value.slice(8, 10)}</Text>
              {day.count > 1 ? <Text style={[browseType(theme, 10, 600), {color: day.value === state.selectedDate ? theme.colors.ink : theme.colors.textTertiary}]}>{day.count}</Text> : null}
            </Focusable>)}
          </View>
          {dayIssues.map(issue => <Focusable key={issue.item.id} accessibilityRole="button" accessibilityLabel={issue.item.title}
            onPress={() => open(issue)} focusKind="row" focusRadius={10}
            style={{marginHorizontal: 20, marginTop: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 14, borderTopWidth: 1, borderTopColor: alpha(theme.colors.line, .7)}}>
            <View style={{width: 56, height: 75, borderRadius: 6, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
              {runtime.artwork(issue.item.coverUrl) ? <Artwork source={runtime.artwork(issue.item.coverUrl)} width={56} height={75}/>
                : <GeneratedCover title={issue.item.title} tint={generatedCoverTint(issue.item.title)} glyph={initial(issue.item.title)} width={56} height={75}/>}
            </View>
            <View style={{flex: 1, minWidth: 0}}>
              <Text numberOfLines={2} style={[browseType(theme, 15, 700), {color: theme.colors.text}]}>{issue.item.title}</Text>
              <Text style={[browseType(theme, 12.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{issue.issueDate}</Text>
            </View>
            <Text style={[browseType(theme, 13, 700), {color: theme.colors.accentStrong}]}>{t('next.reader.read')}</Text>
          </Focusable>)}
          {state.selectedDate === undefined ? <StateView testID="native-read-periodical-day" variant="inline" title={t('next.reader.goToDate')} body={t('next.reader.datesFromFileNames')}/> : null}
        </View>}
      </View> : null}
    </ScrollView>
  </View>;
}

function IssueCard({issue, width, height, theme, runtime, onOpen}: {
  issue: ReadingPeriodicalIssue; width: number; height: number; theme: Theme;
  runtime: NativeShellRuntime; onOpen: () => void;
}) {
  return <Focusable accessibilityRole="button" accessibilityLabel={issue.item.title} focusKind="row" focusRadius={10} onPress={onOpen} style={{width}}>
    <View style={{width, height, borderRadius: 10, overflow: 'hidden', backgroundColor: theme.colors.raised}}>
      {runtime.artwork(issue.item.coverUrl) ? <Artwork source={runtime.artwork(issue.item.coverUrl)} width={width} height={height}/>
        : <GeneratedCover title={issue.item.title} tint={generatedCoverTint(issue.item.title)} glyph={initial(issue.item.title)} width={width} height={height}/>}
    </View>
    <Text numberOfLines={2} style={[browseType(theme, 13, 600), {color: theme.colors.text, marginTop: 7}]}>{issue.item.title}</Text>
    <Text style={[browseType(theme, 11.5, 500), {color: theme.colors.textTertiary, marginTop: 2}]}>{issue.issueDate}</Text>
  </Focusable>;
}
