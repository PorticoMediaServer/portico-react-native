import React, {useCallback, useEffect, useMemo, useSyncExternalStore} from 'react';
import {View} from 'react-native';
import {useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {ContentEntry} from '../../../../packages/client-core/src/library-content';
import {createWindowedCollection, type PageResult, type WindowedCollection} from '../../../../packages/client-core/src/collections/index';
import {readPerson, type PersonCredit, type PersonPage, type PersonRole} from '../../../../packages/client-core/src/people';
import {captionFor, iconFor, progressFor, shapeFor, useArtwork, viewerScope} from '../app/content';
import {say} from '../app/errors';
import {useI18n} from '../app/i18n';
import {useOpenEntry} from '../app/open';
import type {ContentStackParams} from '../app/routes';
import {useSession} from '../app/session';
import {Card, Notice, Page, Ring, Segmented, Shelf, Skeleton, StateView, Text, WindowedGrid, useTheme} from '../ui';
import {StatusBarScrim, TitleHero} from './title/TitleHero';
import {usePullToRefresh} from '../app/refresh';

/** Credits per windowed page (the person's first page seeds page 0). */
const CREDIT_PAGE = 40;

type Seed = {credits: readonly PersonCredit[]; nextCursor: string; total: number};

/**
 * PERF-S17: a person's credits as a windowed collection (never the whole filmography up front).
 * The people route pages by cursor, not offset, so page k needs page k−1's cursor: the source
 * remembers every cursor it has seen and walks forward from the nearest one (as the episode
 * source in `app/episodes.ts` does). The store keeps only the pages near the viewport
 * (`maxResidentPages` × 40 credits, whatever the filmography size).
 */
function creditSource(api: Parameters<typeof readPerson>[0], scope: Parameters<typeof readPerson>[1], personId: string, role: PersonRole, seed?: Seed) {
  const cursors = new Map<number, string | null>([[0, null]]);
  let total = seed?.total;
  if (seed) cursors.set(1, seed.nextCursor || null);
  const request = async (page: number, signal: AbortSignal): Promise<readonly PersonCredit[]> => {
    const cursor = cursors.get(page);
    const fetched = await readPerson(api, scope, personId, {role, limit: CREDIT_PAGE, cursor: cursor ?? undefined, signal});
    cursors.set(page + 1, fetched.pageInfo.nextCursor || null);
    total = fetched.pageInfo.total;
    return fetched.credits;
  };
  const reads = new Map<number, Promise<readonly PersonCredit[]>>();
  const once = (page: number, signal: AbortSignal) => {
    let read = reads.get(page);
    if (!read) {
      read = request(page, signal);
      reads.set(page, read);
      read.catch(() => reads.delete(page));
      while (reads.size > 8) reads.delete(reads.keys().next().value!);
    }
    return read;
  };
  return async (start: number, count: number, signal: AbortSignal): Promise<PageResult<PersonCredit>> => {
    const page = Math.floor(start / count);
    if (page === 0 && seed) return {items: seed.credits, total: seed.total};
    let known = page;
    while (!cursors.has(known)) known--;
    for (let k = known; k < page; k++) {
      if (k > 0 && cursors.get(k) === null) return {items: [], total: total ?? start};
      await once(k, signal);
    }
    if (page > 0 && cursors.get(page) === null) return {items: [], total: total ?? start};
    const items = await once(page, signal);
    return {items, total: total ?? items.length};
  };
}

const idleSnapshot = Object.freeze({generation: 0, total: undefined, status: 'idle' as const, error: undefined as unknown, positionIndex: undefined, refreshing: false});

/**
 * A person on the shared hero (Spec — Title Pages §1): circular portrait, "known for" roles, life
 * dates and the biography, then every credit on this server. The server resolves the identity and
 * pages the credits; the role filter is a request parameter, never a client-side split. The
 * credits are a windowed grid that is itself the page scroller (the hero, "known for" and the
 * role filter are its header), so at most ~300 cards mount at any depth, whatever the filmography.
 */
export function PersonScreen({route}: {route: RouteProp<ContentStackParams, 'Person'>}) {
  const {personId, name} = route.params;
  const {api, session} = useSession();
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const {space, metrics} = useTheme();
  const i18n = useI18n();
  const artwork = useArtwork();
  const open = useOpenEntry();
  const [role, setRole] = React.useState<PersonRole>('all');
  const [first, setFirst] = React.useState<{phase: 'loading' | 'ready' | 'error'; page?: PersonPage; error?: string}>({phase: 'loading'});
  useEffect(() => {
    let cancelled = false;
    setFirst({phase: 'loading'});
    readPerson(api, scope, personId, {role, limit: CREDIT_PAGE}).then(
      page => { if (!cancelled) setFirst({phase: 'ready', page}); },
      e => { if (!cancelled) setFirst({phase: 'error', error: say(e, 'person', 'load')}); },
    );
    return () => { cancelled = true; };
  }, [api, scope, personId, role]);
  const seed: Seed | undefined = first.page ? {credits: first.page.credits, nextCursor: first.page.pageInfo.nextCursor, total: first.page.pageInfo.total} : undefined;
  const list = useMemo<WindowedCollection<PersonCredit> | null>(
    () => (seed ? createWindowedCollection<PersonCredit>({fetchPage: creditSource(api, scope, personId, role, seed), pageSize: CREDIT_PAGE, maxResidentPages: 5, keyOf: c => `${c.media.id}:${c.role}:${c.character}`}) : null),
    // A new role (or person) is a new collection, seeded by its own first page: one request total.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, scope, personId, role, first.page],
  );
  useEffect(() => () => list?.dispose(), [list]);
  const subscribe = useCallback((listener: () => void) => list?.subscribe(listener) ?? (() => {}), [list]);
  const snapshot = useSyncExternalStore(subscribe, () => list?.getSnapshot() ?? idleSnapshot);
  const reload = useCallback(() => {
    if (list) list.retry();
    setFirst(prev => (prev.page ? {phase: 'ready', page: prev.page} : {phase: 'loading'}));
    readPerson(api, scope, personId, {role, limit: CREDIT_PAGE}).then(
      page => {
        setFirst({phase: 'ready', page});
        list?.invalidate(creditSource(api, scope, personId, role, {credits: page.credits, nextCursor: page.pageInfo.nextCursor, total: page.pageInfo.total}));
      },
      e => setFirst(prev => ({...prev, phase: 'error', error: say(e, 'person', 'load')})),
    );
  }, [api, scope, personId, role, list]);
  const pull = usePullToRefresh(reload, {busy: first.phase === 'loading' && !first.page});
  // APL-PERSON-01: "Known for" only when it adds something the credits below don't already show.
  const person = first.page?.person;
  const born = person?.birthDate ? i18n.date(person.birthDate, 'long') : undefined;
  const died = person?.deathDate ? i18n.date(person.deathDate, 'long') : undefined;
  const dates = born && died ? i18n.t('title.lifespan', {born, died}) : born ? i18n.t('title.born', {date: born}) : undefined;
  const knownFor = person && first.page && first.page.pageInfo.total > person.knownFor.length ? person.knownFor : [];
  const renderEntry = (entry: ContentEntry, w?: number, caption?: string) => (
    <Card title={entry.title} subtitle={caption ?? captionFor(entry)} source={artwork(entry.posterUrl ?? entry.backdropUrl)} shape={shapeFor(entry.kind)} width={w} progress={progressFor(entry)} icon={entry.posterUrl || entry.backdropUrl ? undefined : iconFor(entry.kind)} onPress={() => open(entry)} onLongPress={() => open(entry, 'more')} />
  );
  const roles = [
    {id: 'all', label: i18n.t('title.creditsAll')},
    {id: 'cast', label: i18n.t('title.creditsCast')},
    {id: 'crew', label: i18n.t('title.creditsCrew')},
  ];
  const firstCredit = seed?.credits[0] ?? list?.itemAt(0);
  const firstShape = firstCredit ? shapeFor(firstCredit.media.kind) : 'poster';
  const aspect = firstShape === 'landscape' ? 9 / 16 : firstShape === 'square' || firstShape === 'circle' ? 1 : 1.5;
  const header = (
    <>
      <TitleHero
        loading={!person && first.phase === 'loading'}
        art={{source: artwork(person?.portraitUrl || undefined), shape: 'circle', icon: person?.portraitUrl ? undefined : 'person'}}
        eyebrow={person?.roles.length ? person.roles.join(' · ') : undefined}
        title={person?.name ?? name}
        facts={[dates]}
        synopsis={person?.biography || undefined}
      />
      {first.phase === 'error' && !person ? <StateView icon="warning" title={i18n.t('error.title.load', {subject: 'person'})} message={first.error} action={i18n.t('action.tryAgain')} onAction={reload} /> : null}
      {knownFor.length ? <Shelf title={i18n.t('title.knownFor')} data={knownFor} itemWidth={metrics.posterWidth} keyExtractor={e => e.id} renderItem={({item}) => renderEntry(item)} /> : null}
      <View style={{paddingHorizontal: space.page, gap: space.sm, marginBottom: space.md}}>
        <View style={{flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between'}}>
          <Text variant="heading">{i18n.t('title.credits')}</Text>
          {first.page && first.page.pageInfo.total > 0 ? <Text variant="caption" tone="tertiary">{i18n.t('count.titles', {count: first.page.pageInfo.total})}</Text> : null}
        </View>
        <Segmented items={roles} selected={role} onSelect={id => setRole(id as PersonRole)} accessibilityLabel={i18n.t('title.credits')} />
      </View>
      {first.phase === 'error' && person ? <Notice tone="error" message={first.error ?? ''} action={i18n.t('title.retry')} onAction={reload} style={{marginHorizontal: space.page, marginBottom: space.lg}} /> : null}
    </>
  );
  const footer = !list || (snapshot.status === 'loading' && snapshot.total === undefined) ? (
    <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.md, paddingHorizontal: space.page}}>{Array.from({length: 6}).map((_, i) => <Skeleton key={i} width={metrics.posterWidth} height={metrics.posterWidth * 1.5} />)}</View>
  ) : snapshot.status === 'error' && snapshot.total === undefined ? (
    <StateView icon="people" title={i18n.t('title.noCredits')} message={snapshot.error ? say(snapshot.error, 'person', 'load') : ''} />
  ) : snapshot.total === 0 ? (
    <StateView icon="people" title={i18n.t('title.noCredits')} message={role === 'all' ? i18n.t('title.noCreditsBody') : i18n.t('title.noRoleCredits', {role})} />
  ) : snapshot.status === 'loading' ? (
    <View style={{alignItems: 'center', paddingVertical: space.lg}}><Ring size={24} thickness={2} /></View>
  ) : null;
  return (
    <View style={{flex: 1}}>
      {list ? (
        <WindowedGrid
          list={list}
          total={snapshot.total}
          itemWidth={metrics.posterWidth}
          aspect={aspect}
          renderItem={(c, w) => renderEntry(c.media, w, c.creditKind === 'cast' ? (c.character ? i18n.t('title.creditAs', {character: c.character}) : c.role) : c.role || c.department)}
          header={header}
          footer={footer}
          generation={snapshot.generation}
          refreshControl={pull}
        />
      ) : (
        <Page refreshControl={pull}>{header}{footer}</Page>
      )}
      <StatusBarScrim onBack={() => navigation.goBack()} title={person?.name ?? name} />
    </View>
  );
}
