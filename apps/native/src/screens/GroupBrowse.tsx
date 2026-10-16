import React, {useMemo} from 'react';
import {View} from 'react-native';
import type {ContentSection} from '../../../../packages/client-core/src/library-content';
import type {GroupBrowse} from '../app/group-browse';
import type {useGroupPages} from '../app/group-browse';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {useSession} from '../app/session';
import {Button, Notice, Ring, StateView, useTheme} from '../ui';
import {BrowseBar} from './BrowseFilters';
import {FacetGroupContext} from '../app/browse';
import {facetGroupOf} from '../../../../packages/client-core/src/browse';
import {SectionView} from './Home';
import {RowGuide} from './title/RowGuide';
import {groupSequence} from '../app/container-play';

/**
 * Sort and Filter for a group of a library's titles: the library's own controls (`BrowseBar`),
 * with the group's own order as the first choice of sort. A group's page already has its hero and
 * actions, so here they are the two buttons the library shows beside its tabs on television, on
 * every device: Sort, and Filter, which opens every filter the library has. They sit in a row of
 * their own that the remote reaches from the hero above and the list below. Nothing is drawn
 * until the server has said the group can be sorted and filtered.
 */
export function GroupBar({group, leading}: {group: GroupBrowse; /** Drawn before the buttons (the library, for a group with titles in several). */ leading?: React.ReactNode}) {
  const {space} = useTheme();
  const session = useSession();
  const owner = session.session?.viewer.role === 'owner';
  const {scope, capabilities} = group;
  // A list across libraries counts its filter choices over its own titles.
  const facetGroup = useMemo(() => (scope ? facetGroupOf(scope.base) : undefined), [scope]);
  if (!scope || !capabilities) return null;
  const bar = (
    <FacetGroupContext.Provider value={facetGroup}><BrowseBar
      inline
      leading={leading}
      owner={owner}
      libraryId={scope.libraryId}
      capabilities={capabilities}
      predicates={group.choice.predicates}
      onChange={group.setPredicates}
      sort={group.sort}
      onSort={group.setSort}
      ownOrder={{selected: group.ownSelected, onSelect: () => group.setSort(undefined)}}
    /></FacetGroupContext.Provider>
  );
  return (
    <RowGuide>
      <View style={{flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.page, marginBottom: space.lg}}>{bar}</View>
    </RowGuide>
  );
}

/**
 * The group's sorted and filtered titles inside a page, drawn as the page's own grids are: cards
 * in the library's shapes, and "Show more" for the next page. While a new sort or filter is on its
 * way the titles already there stay; nothing matching says so and offers the way back.
 */
export function GroupResults({group, results, libraryId, row, as = 'grid', playsList = false}: {group: GroupBrowse; results: ReturnType<typeof useGroupPages>; /** The library the titles are in; none for a list across libraries, whose titles each name theirs. */ libraryId?: string; /** Position on the screen, for artwork order. */ row?: number; /** Rows, for a list of things that are played in turn (a playlist's songs); cards otherwise. */ as?: 'grid' | 'list'; /** A pressed row plays the whole sorted or filtered list on from there (the server's query). */ playsList?: boolean}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const {snapshot, pages} = results;
  const section = useMemo<ContentSection>(() => ({id: 'group-results', type: as, heading: {key: '', fallback: ''}, entries: snapshot.entries, totalCount: snapshot.total ?? snapshot.entries.length, nextCursor: snapshot.hasMore ? 'more' : ''}), [snapshot.entries, snapshot.total, snapshot.hasMore, as]);
  if (!group.engaged) return null;
  if (snapshot.status === 'error' && !snapshot.entries.length) return <StateView icon="error" title={i18n.t('lib.viewLoadFailed')} message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={() => pages?.retry()} />;
  if (snapshot.status !== 'ready' && !snapshot.entries.length) return <View style={{alignItems: 'center', paddingVertical: space.xl}}><Ring size={24} thickness={2} /></View>;
  if (!snapshot.entries.length) return <StateView icon="filter" title={i18n.t('library.noMatch')} message={i18n.t('library.noMatchBody')} action={i18n.t('library.clearFilters')} onAction={group.reset} />;
  return (
    <>
      {snapshot.error ? <Notice tone="warning" message={say(snapshot.error, 'library', 'load')} action={i18n.t('action.tryAgain')} onAction={() => void pages?.more()} style={{marginHorizontal: space.page, marginBottom: space.md}} /> : null}
      <RowGuide><SectionView section={section} row={row} hideTitle libraryId={libraryId} loadingMore={snapshot.loadingMore} onMore={snapshot.hasMore ? () => void pages?.more() : undefined} sequence={playsList ? groupSequence(group) : undefined} /></RowGuide>
      {/* A grid offers its own "Show more"; a list of rows gets the same button under it. */}
      {as === 'list' && snapshot.hasMore ? <View style={{alignItems: 'center', marginBottom: space.xl}}><Button variant="secondary" label={i18n.t('action.showMore')} loading={snapshot.loadingMore} onPress={() => void pages?.more()} /></View> : null}
    </>
  );
}
