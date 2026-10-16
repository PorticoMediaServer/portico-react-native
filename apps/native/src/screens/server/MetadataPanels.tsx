import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {dependsOn} from '../../../../../packages/client-core/src/freshness-hub';
import {isStaleAnswer} from '../../../../../packages/client-core/src/freshness-actions';
import {metadataAttentionService, serverMetadataAttentionService, type AttentionEntry} from '../../../../../packages/client-core/src/metadata-attention';
import {artworkLimitBytes, artworkLimitText, metadataSettingsService, type MetadataSettings} from '../../../../../packages/client-core/src/metadata-settings';
import {attentionInProgress, attentionOffers, attentionReason, candidateFacts, candidateLine, hasAttentionList, providerName, typedProviderId} from '../../../../../packages/client-core/src/server-admin/attention-words';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {findInPages, problem, sendFresh, useAction, usePagedList, useRead} from '../../app/server-console';
import {Field, ListRow, Menu, Notice, RowGroup, Sheet, ToggleRow, useTheme, type MenuItem} from '../../ui';
import {PickRow, TypedRow, useInlineForm} from '../settings/ServerForms';
import {attentionChoices, keyChange, keyUntouched, metadataSave, subtitleChanges, type AttentionChoice, type KeyEdit} from './owner-rules';

type Api = ReturnType<typeof useSession>['api'];
const requestOf = (api: Api) => <T,>(path: string, method?: string, body?: unknown) => api.request<T>(path, method, body);

/**
 * Metadata: what every library shares when it looks titles up. The owner's own provider keys
 * (never shown back; the page says only whether one is set), whether adult titles are searched,
 * and how much local artwork is kept. Which provider a library uses is that library's choice.
 * One document, saved with the page's Save.
 */
export function MetadataSettingsPanel() {
  const i18n = useI18n();
  const t = i18n.t;
  const {api} = useSession();
  const service = useMemo(() => metadataSettingsService(requestOf(api)), [api]);
  const read = useRead(() => service.read(), [service]);
  const doc = read.data;
  const [limit, setLimit] = useState('');
  const [adult, setAdult] = useState(false);
  const [tmdb, setTmdb] = useState<KeyEdit>(keyUntouched);
  const [tvdb, setTvdb] = useState<KeyEdit>(keyUntouched);
  // OpenSubtitles: a key like the others, and an account (a name shown back, a password never).
  const [subtitleKey, setSubtitleKey] = useState<KeyEdit>(keyUntouched);
  const [subtitleUser, setSubtitleUser] = useState('');
  const [subtitlePassword, setSubtitlePassword] = useState('');
  const reset = (d: MetadataSettings) => { setLimit(artworkLimitText(d.localArtworkLimitBytes)); setAdult(d.includeAdult); setTmdb(keyUntouched); setTvdb(keyUntouched); setSubtitleKey(keyUntouched); setSubtitleUser(d.openSubtitlesUsername); setSubtitlePassword(''); };
  useEffect(() => { if (doc) reset(doc); }, [doc]);
  const bytes = artworkLimitBytes(limit);
  const subtitles = {key: subtitleKey, username: subtitleUser, password: subtitlePassword};
  const dirty = !!doc && (bytes !== doc.localArtworkLimitBytes || adult !== doc.includeAdult || keyChange(tmdb) !== undefined || keyChange(tvdb) !== undefined || Object.keys(subtitleChanges(doc, subtitles)).length > 0);
  const inline = useInlineForm('metadata-settings', {
    dirty,
    problem: bytes === undefined ? 'server.metadata.limitProblem' : undefined,
    discard: () => { if (doc) reset(doc); },
    save: async () => {
      if (!doc || bytes === undefined) return;
      const draft = {limitBytes: bytes, includeAdult: adult, tmdb, tvdb, subtitles};
      const first = metadataSave(doc, draft);
      if (first === 'conflict') return;
      try { await service.save(first); } catch (e) {
        if (!isStaleAnswer(e)) throw e;
        // These settings moved on the server: what was not changed here takes the server's value, and it is saved again, unless the same setting was changed there too.
        const fresh = await service.read().catch(() => { throw e; });
        const again = metadataSave(doc, draft, fresh);
        if (again === 'conflict') { read.reload(); throw e; }
        await service.save(again);
      }
      read.reload();
    },
  });
  // One provider key: a row that says whose key is in use and opens a field to paste the owner's
  // own, and, while theirs is set, a row to go back to Portico's. A key is never shown back.
  const keyRows = (id: string, label: string, set: boolean, edit: KeyEdit, change: (next: KeyEdit) => void) => [
    <TypedRow key={id} secure title={label} help={edit.remove ? t('server.metadata.keyRemoving') : keyChange(edit) !== undefined ? t('server.metadata.keyUnsaved') : set ? t('server.metadata.keySet') : t('server.metadata.keyOurs')} value={edit.typed} shown="" placeholder={set ? t('server.metadata.keyReplace') : t('server.metadata.keyPaste')} maxLength={2048} onDone={typed => change({typed, remove: false})} />,
    ...(set ? [<ListRow key={id + ':own'} tone="action" title={edit.remove ? t('server.metadata.keyKeep') : t('server.metadata.keyRemove')} onPress={() => change({typed: '', remove: !edit.remove})} />] : []),
  ];
  if (!doc) return read.error ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null;
  return (
    <>
      {read.error ? <Notice tone="warning" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {inline.error ? <Notice tone="error" message={problem(inline.error, 'action')} /> : null}
      <RowGroup title={t('server.metadata.lookups')} footer={`${t('server.metadata.lookupsLede')} ${t('server.metadata.keyHelp')}`}>
        <ListRow title={t('server.metadata.perLibrary')} subtitle={t('server.metadata.perLibraryHelp')} subtitleLines={4} />
        {keyRows('tmdb', t('metadata.settings.tmdbToken'), doc.tmdbCredentialConfigured, tmdb, setTmdb)}
        {keyRows('tvdb', t('metadata.settings.tvdbKey'), doc.tvdbCredentialConfigured, tvdb, setTvdb)}
        <ToggleRow title={t('metadata.settings.includeAdult')} subtitle={t('server.metadata.adultHelp')} value={adult} onChange={setAdult} />
      </RowGroup>
      <RowGroup title={t('server.metadata.subtitles')} footer={t('server.metadata.subtitlesLede')}>
        <TypedRow secure title={t('server.metadata.openSubtitlesKey')} help={subtitleKey.remove ? t('server.metadata.keyRemoving') : keyChange(subtitleKey) !== undefined ? t('server.metadata.keyUnsaved') : doc.openSubtitlesKeyConfigured ? t('server.metadata.openSubtitlesKeyOwn') : t('server.metadata.openSubtitlesKeyServer')} value={subtitleKey.typed} shown="" placeholder={doc.openSubtitlesKeyConfigured ? t('server.metadata.keyReplace') : t('server.metadata.keyPaste')} maxLength={2048} onDone={typed => setSubtitleKey({typed, remove: false})} />
        {doc.openSubtitlesKeyConfigured ? <ListRow tone="action" title={subtitleKey.remove ? t('server.metadata.keyKeep') : t('server.metadata.openSubtitlesUseServer')} onPress={() => setSubtitleKey({typed: '', remove: !subtitleKey.remove})} /> : null}
        <TypedRow title={t('server.metadata.openSubtitlesUser')} value={subtitleUser} shown={subtitleUser} maxLength={512} onDone={setSubtitleUser} />
        {subtitleUser.trim() ? <TypedRow secure title={t('server.metadata.openSubtitlesPassword')} help={doc.openSubtitlesPasswordConfigured && !subtitlePassword && subtitleUser.trim() === doc.openSubtitlesUsername ? t('server.metadata.openSubtitlesPasswordSaved') : undefined} value={subtitlePassword} shown="" maxLength={512} onDone={setSubtitlePassword} /> : null}
        {doc.openSubtitlesUsername ? <ListRow tone="action" title={t('server.metadata.openSubtitlesSignOut')} onPress={() => { setSubtitleUser(''); setSubtitlePassword(''); }} /> : null}
      </RowGroup>
      <RowGroup title={t('server.metadata.artwork')} footer={t('server.metadata.artworkHelp')}>
        <TypedRow decimal title={t('metadata.settings.artworkLimit')} help={bytes === undefined ? t('server.metadata.limitProblem') : t('server.metadata.artworkUsed', {used: i18n.bytes(doc.localArtworkUsedBytes), limit: i18n.bytes(doc.localArtworkLimitBytes)})} value={limit} shown={`${limit} ${t('settings.unit.gb')}`} onDone={setLimit} />
      </RowGroup>
    </>
  );
}

// Titles matched or added elsewhere move the counts without a reload.
const ATTENTION_MOVES = [dependsOn.content()];

/**
 * How many titles wait for the owner in each library: the server's own exact totals, in one
 * request for every library. Work the server is still doing by itself is not counted. When they
 * cannot be read there is no count.
 */
export function useAttentionCounts(libraries: readonly {id: string; kind: string}[]): Readonly<{counts: Readonly<Record<string, number>>; reload: () => void}> {
  const {api} = useSession();
  const wanted = libraries.some(l => hasAttentionList(l.kind));
  const read = useRead(async () => Object.fromEntries((await serverMetadataAttentionService(requestOf(api)).counts()).libraries.map(l => [l.libraryId, l.total])), [api], {auto: wanted, on: ATTENTION_MOVES});
  return {counts: read.data ?? {}, reload: read.reload};
}

const ATTENTION_PAGE = 25;
const ATTENTION_POLL_MS = 4000;
const ID_PROVIDERS = ['tmdb', 'tvdb', 'anilist'] as const;
type IdProvider = (typeof ID_PROVIDERS)[number];

/**
 * A library › Needs attention: the titles Portico could not match with confidence, each with
 * why, the closest matches, and what the owner can do: use a match, search by hand, give the
 * title's ID at a provider, or dismiss it. The server says which of those a title allows.
 */
export function NeedsAttentionSheet({libraryId, onClose, onOpenTitle, onChanged}: {/** Absent: closed. */ libraryId?: string; onClose: () => void; /** Open a title's own page (the sheets close first). */ onOpenTitle: (target: {kind: 'show' | 'item'; id: string; libraryId: string}) => void; onChanged?: () => void}) {
  const i18n = useI18n();
  const t = i18n.t;
  const {space} = useTheme();
  const {api} = useSession();
  const service = useMemo(() => (libraryId ? metadataAttentionService(requestOf(api), libraryId) : undefined), [api, libraryId]);
  const page = async (cursor: string) => { const out = await service!.list(cursor, ATTENTION_PAGE); return {items: [...out.entries], nextCursor: out.nextCursor ?? ''}; };
  // A match settling, or a scan, changes the list: the feed says so, and every page shown is read again.
  const read = usePagedList(page, [service], {auto: !!service, on: ATTENTION_MOVES});
  const action = useAction();
  const [notice, setNotice] = useState('');
  const [menu, setMenu] = useState<AttentionEntry>();
  const [searching, setSearching] = useState<AttentionEntry>();
  const [identifying, setIdentifying] = useState<AttentionEntry>();
  useEffect(() => { setNotice(''); action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [libraryId]);
  const entries = service ? read.items : undefined;
  // A search or a match the owner just asked for settles on the server; the list follows it.
  const settling = !!entries?.some(e => attentionInProgress(e.reason));
  useEffect(() => { if (!settling) return; const timer = setInterval(read.reload, ATTENTION_POLL_MS); return () => clearInterval(timer); }, [settling, read.reload]);
  const has = (id: string) => i18n.has(id);
  const send = (entry: AttentionEntry, command: Omit<Parameters<NonNullable<typeof service>['act']>[0], 'kind' | 'entityId' | 'expectedRevision'>, done: string) => {
    setNotice('');
    return action.run(async () => {
      if (!service) return;
      // A scan or a search moved the title since the list was read: the same answer is sent again for the title as it is now, while it is still on the list.
      await sendFresh(entry, e => service.act({kind: e.kind, entityId: e.entityId, expectedRevision: e.revision, ...command}), () => findInPages(page, e => e.entityId === entry.entityId && e.kind === entry.kind));
    }).then(ok => { if (ok) setNotice(done); read.reload(); onChanged?.(); return ok; });
  };
  const labels: Readonly<Record<AttentionChoice, {label: string; icon: MenuItem['icon']}>> = {search: {label: t('server.attention.search'), icon: 'search'}, id: {label: t('server.attention.enterId'), icon: 'link'}, parent: {label: t('server.attention.openShow'), icon: 'tv'}, dismiss: {label: t('metadata.attention.dismiss'), icon: 'close'}};
  const choose = (entry: AttentionEntry, id: AttentionChoice) => {
    action.clear();
    if (id === 'search') setSearching(entry);
    else if (id === 'id') setIdentifying(entry);
    else if (id === 'parent') onOpenTitle({kind: 'show', id: entry.parentId, libraryId: entry.libraryId});
    else void send(entry, {action: 'dismiss'}, t('server.attention.dismissed'));
  };
  return (
    <Sheet open={!!libraryId} onClose={onClose} kind="form" cancelLabel={t('action.done')} title={t('metadata.attention.title')} subtitle={t('server.attention.lede')}>
      <View style={{gap: space.md}}>
        {read.error ? <Notice tone={entries ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
        {action.error && !searching && !identifying ? <Notice tone="error" message={action.error} /> : null}
        {notice ? <Notice tone="success" message={notice} /> : null}
        {entries?.map(entry => {
          const offered = attentionOffers(entry, 'accept') ? entry.candidates : [];
          const more = attentionChoices(entry);
          return (
            <RowGroup key={`${entry.kind}:${entry.entityId}`}>
              <ListRow icon={entry.kind === 'show' ? 'tv' : 'film'} title={entry.title || t('server.attention.untitled')} subtitle={attentionReason(t, has, entry.reason)} subtitleLines={3} accessory="navigation" onPress={() => onOpenTitle({kind: entry.kind, id: entry.entityId, libraryId: entry.libraryId})} />
              {offered.map(candidate => <ListRow key={candidate.key} title={candidateLine(candidate)} subtitle={candidateFacts(t, has, candidate).join(' · ') || undefined} meta={t('web.liveSource.useThis')} accessibilityLabel={t('server.attention.useNamed', {title: candidate.title})} disabled={action.busy}
                onPress={() => void send(entry, {action: 'accept', candidateKey: candidate.key, ...(candidate.orders[0] ? {order: candidate.orders[0].id} : {})}, t('server.attention.matched', {title: candidate.title}))} />)}
              {more.length ? <ListRow tone="action" title={offered.length ? t('server.attention.somethingElse') : t('server.attention.choose')} accessibilityLabel={t('server.attention.actions', {title: entry.title})} onPress={() => setMenu(entry)} /> : null}
            </RowGroup>
          );
        })}
        {entries && !entries.length ? <RowGroup><ListRow title={t('server.attention.none')} /></RowGroup> : null}
        {read.more ? <RowGroup><ListRow tone="action" title={t('server.showMore')} disabled={read.loading} onPress={read.loadMore} /></RowGroup> : null}
      </View>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.title || t('server.attention.untitled')} items={(menu ? attentionChoices(menu) : []).map<MenuItem>(id => ({id, ...labels[id]}))} onSelect={id => { if (menu) choose(menu, id as AttentionChoice); }} />
      <SearchSheet entry={searching} busy={action.busy} error={action.error} onClose={() => setSearching(undefined)}
        onSearch={query => { if (searching) void send(searching, {action: 'search', query}, t('server.attention.searchStarted')).then(ok => { if (ok) setSearching(undefined); }); }} />
      <IdentifySheet entry={identifying} busy={action.busy} error={action.error} onClose={() => setIdentifying(undefined)}
        onIdentify={(provider, providerId) => { if (identifying) void send(identifying, {action: 'id', providerId, ...(provider ? {provider} : {})}, t('server.attention.idSaved')).then(ok => { if (ok) setIdentifying(undefined); }); }} />
    </Sheet>
  );
}

/** Search by hand: the words to look for; the matches arrive in the list a moment later. */
function SearchSheet({entry, busy, error, onClose, onSearch}: {entry?: AttentionEntry; busy: boolean; error: string; onClose: () => void; onSearch: (query: string) => void}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const [query, setQuery] = useState('');
  useEffect(() => { if (entry) setQuery(entry.title); }, [entry]);
  const ready = query.trim().length >= 2;
  return (
    <Sheet open={!!entry} onClose={onClose} kind="form" title={t('server.attention.searchTitle')} subtitle={t('server.attention.searchBody')} primary={{label: t('web.search.title'), loading: busy, disabled: !ready, onPress: () => onSearch(query.trim())}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        <Field label={t('server.attention.searchFor')} value={query} onChangeText={setQuery} maxLength={200} autoFocus returnKeyType="search" onSubmitEditing={() => { if (ready && !busy) onSearch(query.trim()); }} />
      </View>
    </Sheet>
  );
}

/** Enter a provider ID: an address or an IMDb ID says whose it is; a bare number needs to be told. */
function IdentifySheet({entry, busy, error, onClose, onIdentify}: {entry?: AttentionEntry; busy: boolean; error: string; onClose: () => void; onIdentify: (provider: IdProvider | undefined, providerId: string) => void}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const [typed, setTyped] = useState('');
  const [provider, setProvider] = useState<IdProvider>('tmdb');
  useEffect(() => { if (entry) { setTyped(''); setProvider('tmdb'); } }, [entry]);
  const id = typedProviderId(typed);
  const bare = !!id && /^\d+$/.test(id);
  return (
    <Sheet open={!!entry} onClose={onClose} kind="form" title={t('metadata.attention.enterId')} subtitle={entry?.title} primary={{label: t('server.attention.useId'), loading: busy, disabled: !id, onPress: () => { if (id) onIdentify(bare ? provider : undefined, id); }}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} /> : null}
        <Field label={t('server.attention.idLabel')} hint={t('server.attention.idHelp')} value={typed} onChangeText={setTyped} maxLength={2048} autoCapitalize="none" autoCorrect={false} autoFocus />
        {bare ? <RowGroup><PickRow title={t('server.attention.idProvider')} value={provider} options={ID_PROVIDERS.map(p => ({id: p, label: providerName(p)}))} onChange={p => setProvider(p as IdProvider)} /></RowGroup> : null}
      </View>
    </Sheet>
  );
}
