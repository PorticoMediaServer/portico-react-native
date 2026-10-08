import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {PLAY_HISTORY_PERIODS, fetchPlayHistory, playHistoryPeriodLabel, playHistoryPlatform, playHistoryPlayed, playHistoryTitle, playHistoryType, playHistoryUser, type PlayHistoryEntry, type PlayHistoryFilters, type PlayHistoryPeriod} from '../../../../../packages/client-core/src/play-history';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {useLibrariesContext} from '../../app/libraries-context';
import {problem, useConsole, useRead} from '../../app/server-console';
import {ListRow, Menu, Notice, RowGroup} from '../../ui';

type Filter = 'library' | 'user' | 'period';

/**
 * Settings › Server › Play history: every play on the server, newest first, filtered by person,
 * library and time. The filters and every line of a row are client-core's (`play-history.ts`),
 * the same facts the web shows as table columns. Pages are appended as they are asked for.
 */
export function PlayHistoryPanel() {
  const i18n = useI18n();
  const {t} = i18n;
  const {api} = useSession();
  const client = useConsole();
  const libraries = useLibrariesContext();
  const accounts = useRead(() => client.accountOptions(), [client]);
  const [filters, setFilters] = useState<PlayHistoryFilters>({period: 'all'});
  const [choosing, setChoosing] = useState<Filter>();
  const [state, setState] = useState<{entries: readonly PlayHistoryEntry[]; total?: number; next: string; loading: boolean; error?: string}>({entries: [], next: '', loading: true});
  const run = useRef(0);
  const load = useCallback((cursor: string) => {
    const n = ++run.current;
    setState(prev => ({...(cursor ? prev : {entries: [], next: ''}), loading: true}));
    fetchPlayHistory(api, filters, cursor).then(
      page => { if (n === run.current) setState(prev => ({entries: cursor ? [...prev.entries, ...page.entries] : page.entries, total: page.total ?? prev.total, next: page.nextCursor, loading: false})); },
      error => { if (n === run.current) setState(prev => ({...prev, loading: false, error: problem(error)})); },
    );
  }, [api, filters]);
  useEffect(() => load(''), [load]);
  const libraryName = useMemo(() => new Map(libraries.items.map(l => [l.id, l.name])), [libraries.items]);
  const accountName = accounts.data?.find(a => a.id === filters.accountId)?.label;
  const played = (entry: PlayHistoryEntry) => { const p = playHistoryPlayed(entry, i18n); return [p.date, p.time, p.note].filter(Boolean).join(' · '); };
  const filtered = !!filters.accountId || !!filters.libraryId || filters.period !== 'all';
  const options = choosing === 'library' ? [{id: '', label: t('server.plays.allLibraries')}, ...libraries.items.map(l => ({id: l.id, label: l.name}))]
    : choosing === 'user' ? [{id: '', label: t('server.plays.allUsers')}, ...(accounts.data ?? []).map(a => ({id: a.id, label: a.label}))]
    : PLAY_HISTORY_PERIODS.map(p => ({id: p, label: t(playHistoryPeriodLabel(p))}));
  const current = choosing === 'library' ? filters.libraryId ?? '' : choosing === 'user' ? filters.accountId ?? '' : filters.period;
  const choose = (id: string) => {
    if (choosing === 'library') setFilters(f => ({...f, libraryId: id || undefined}));
    else if (choosing === 'user') setFilters(f => ({...f, accountId: id || undefined}));
    else if (choosing === 'period') setFilters(f => ({...f, period: id as PlayHistoryPeriod}));
    setChoosing(undefined);
  };
  return (
    <>
      {state.error ? <Notice tone={state.entries.length ? 'warning' : 'error'} message={state.error} action={t('action.tryAgain')} onAction={() => load(state.entries.length ? state.next : '')} /> : null}
      <RowGroup>
        <ListRow title={t('server.plays.filterLibrary')} meta={filters.libraryId ? libraryName.get(filters.libraryId) ?? t('server.plays.removedLibrary') : t('server.plays.allLibraries')} accessory="value" onPress={() => setChoosing('library')} />
        <ListRow title={t('server.plays.filterUser')} meta={accountName ?? t('server.plays.allUsers')} accessory="value" onPress={() => setChoosing('user')} />
        <ListRow title={t('server.plays.filterPeriod')} meta={t(playHistoryPeriodLabel(filters.period))} accessory="value" onPress={() => setChoosing('period')} />
      </RowGroup>
      <RowGroup title={state.total !== undefined ? t('server.plays.total', {count: state.total}) : undefined}>
        {state.entries.map(entry => (
          <ListRow
            key={entry.id}
            title={playHistoryTitle(entry, i18n)}
            subtitle={[playHistoryUser(entry), playHistoryType(entry, i18n), entry.device || playHistoryPlatform(entry, i18n)].filter(Boolean).join(' · ') + '\n' + played(entry)}
            subtitleLines={2}
          />
        ))}
        {!state.entries.length && !state.loading && !state.error ? <ListRow title={t(filtered ? 'server.plays.emptyFiltered' : 'server.plays.empty')} /> : null}
        {state.next ? <ListRow tone="action" title={t('server.plays.more')} disabled={state.loading} onPress={() => load(state.next)} /> : null}
      </RowGroup>
      <Menu open={!!choosing} onClose={() => setChoosing(undefined)} title={choosing ? t(choosing === 'library' ? 'server.plays.filterLibrary' : choosing === 'user' ? 'server.plays.filterUser' : 'server.plays.filterPeriod') : undefined}
        items={options.map(o => ({id: o.id || 'all', label: o.label, selected: o.id === current}))} onSelect={id => choose(id === 'all' ? '' : id)} />
    </>
  );
}
