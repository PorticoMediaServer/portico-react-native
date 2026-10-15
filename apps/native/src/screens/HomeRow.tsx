import React, {useEffect, useMemo, useSyncExternalStore} from 'react';
import {useFreshDocument} from '../app/freshness';
import {dependsOn, titlesWithPersonalState} from '../../../../packages/client-core/src/freshness-hub';
import {View} from 'react-native';
import {useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {HomeRowPager} from '../../../../packages/client-core/src/home-row-page';
import {serverTextLabel} from '../../../../packages/client-core/src/presentation/server-text';
import type {ContentStackParams} from '../app/routes';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import type {GridWindow} from '../ui/Grid';
import {useSession} from '../app/session';
import {useI18n} from '../app/i18n';
import {present, say} from '../app/errors';
import {withoutNotInterested} from '../app/not-interested';
import {useTurnedDown} from '../app/not-interested-hook';
import {Notice, Page, PageHeader, Skeleton, StateView, WindowedGrid, useTheme} from '../ui';
import {useSectionCards} from './Home';

const rowDependencies = Object.freeze([dependsOn.libraries, ...titlesWithPersonalState()]);
const NO_ENTRIES: readonly ContentEntry[] = [];

/**
 * A Home row's See all (Recommendations P7): Recommended, Trending now or one of the Picks for
 * you rows as a paged grid from the row's own endpoint (`HomeRowPager`: the whole row; a stale
 * cursor starts again from the first page). The cards are recommendations: their long-press menu
 * offers Not interested, and a title turned down leaves the grid.
 */
export function HomeRowScreen({route}: {route: RouteProp<ContentStackParams, 'HomeRow'>}) {
  const {rowId, title} = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const {api} = useSession();
  const i18n = useI18n();
  const {space, metrics} = useTheme();
  const pager = useMemo(() => new HomeRowPager(api, rowId), [api, rowId]);
  useEffect(() => { void pager.load(); return () => pager.dispose(); }, [pager]);
  // The row's full list follows the libraries and this profile's state while it is in front; pages already scrolled into stay.
  useFreshDocument(rowDependencies, context => pager.revalidate(context), () => pager.getSnapshot().phase === 'ready');
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  const turnedDown = useTurnedDown();
  const row = state.row;
  const name = row ? serverTextLabel(i18n, row.titleText, row.title) : title ?? '';
  const entries = useMemo(() => (state.phase === 'loading' && state.restarts ? NO_ENTRIES : withoutNotInterested({id: rowId, entries: state.entries}, turnedDown, true).entries), [state.phase, state.restarts, state.entries, rowId, turnedDown]);
  const {width, renderCard, shape} = useSectionCards(entries.slice(0, 1), row?.libraryId, true, {row: 1, group: rowId}, 'recommendation');
  // The pager owns cursor order; WindowedGrid mounts only viewport cells and asks for the next
  // cursor when its virtual placeholder range comes into view.
  const grid = useMemo<GridWindow<ContentEntry>>(() => ({
    ensureRange: (_first, last) => { if (state.phase === 'ready' && state.nextCursor && last >= entries.length - 20) void pager.more(); },
    slotAt: index => entries[index] ? {kind: 'item', key: entries[index]!.id, item: entries[index]!} : {kind: 'placeholder', key: `pending:${index}`},
    pageOf: index => Math.floor(index / 60),
    subscribePage: (_page, listener) => pager.subscribe(listener),
    getPageVersion: () => `${state.entries.length}:${state.restarts}:${entries.length}`,
  }), [pager, entries, state.phase, state.nextCursor, state.entries.length, state.restarts]);
  const header = <PageHeader title={name} onBack={() => navigation.goBack()} />;
  const notice = state.error && row ? <Notice tone="warning" message={say(state.error, 'home', 'load')} action={i18n.t('action.tryAgain')} onAction={() => void (state.phase === 'error' ? pager.load() : pager.more())} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null;
  return (
    <View style={{flex: 1}}>
      {row ? <WindowedGrid list={grid} total={entries.length + (state.nextCursor ? 60 : 0)} itemWidth={width || metrics.posterWidth} aspect={shape === 'landscape' ? 9 / 16 : shape === 'square' || shape === 'circle' ? 1 : 1.5} renderItem={renderCard} header={<>{header}{notice}</>} footer={state.phase === 'loading' && state.restarts ? <View style={{paddingHorizontal: space.page}}><Skeleton width={metrics.posterWidth} height={metrics.posterWidth * 1.5} /></View> : null} generation={state.restarts} /> : <Page>
        {header}
        {state.phase === 'loading' && !state.entries.length ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: space.page}}>{Array.from({length: 6}).map((_, i) => <Skeleton key={i} width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />)}</View>
        ) : null}
        {state.phase === 'error' && !row ? (() => { const failure = present(state.error, 'home', {i18n}); return <StateView icon="warning" title={failure.title} message={failure.body} action={i18n.t('action.tryAgain')} onAction={() => void pager.load()} />; })() : null}
      </Page>}
    </View>
  );
}
