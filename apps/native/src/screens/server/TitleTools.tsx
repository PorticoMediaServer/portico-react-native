import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {deletionAllowed, versionDeletionService, type VersionDeletePreview} from '../../../../../packages/client-core/src/administration';
import type {TitleFile} from '../../../../../packages/client-core/src/detail';
import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import {SearchService, type SearchSnapshot} from '../../../../../packages/client-core/src/search';
import {MERGEABLE_KINDS, SPLITTABLE_KINDS, canMergeTitles, findLibraryFile, mergeTitles, separateLibraryFile} from '../../../../../packages/client-core/src/title-identity';
import {viewerScope} from '../../app/content';
import {useI18n} from '../../app/i18n';
import type {ContentStackParams} from '../../app/routes';
import {useSession} from '../../app/session';
import {operationId, problem, useAction, useService} from '../../app/server-console';
import {ConfirmSheet, Field, ListRow, Menu, Notice, RowGroup, Sheet, Text, afterOverlaysClose, isTV, rowPaddingX, useSpecPlatform, useTheme, type MenuItem} from '../../ui';
import {fileTools, mergeOrder, mergeSearchGroup} from './owner-rules';

/** The title an owner's file tools act on. */
export type ToolTitle = Readonly<{id: string; title: string; kind: string; libraryId: string; year?: number}>;
type Chosen = {file: TitleFile; summary: string};

/**
 * The owner's tools for a title's files, on phones and tablets: split a version that was grouped
 * with the wrong title off into a title of its own, delete one version from disk, and say that
 * this title and another are one. A member, and a television, get none of them: `fileAction` and
 * `mergeRow` are then absent and the Files list is the read-only list it always was.
 */
export function useTitleTools(title: ToolTitle | undefined, files: readonly TitleFile[] | undefined, onChanged: () => void, options: {/** The title is shown inside another title's page (an episode's panel): what changes is read again in place, and nothing is opened. */ inPlace?: boolean} = {}): {fileAction?: (file: TitleFile, summary: string) => void; mergeRow?: React.ReactNode; sheets: React.ReactNode} {
  const {session} = useSession();
  const t = useI18n().t;
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const [menu, setMenu] = useState<Chosen>();
  const [splitting, setSplitting] = useState<Chosen>();
  const [deleting, setDeleting] = useState<Chosen>();
  const [merging, setMerging] = useState(false);
  const owner = session?.viewer.role === 'owner' && !isTV;
  if (!owner || !title) return {sheets: null};
  // The title that remains, or the new one, takes this page's place: the page it came from no longer says what is true.
  const open = (id: string) => { if (options.inPlace) return; requestAnimationFrame(() => afterOverlaysClose(() => (title.kind === 'show' ? navigation.replace('Show', {libraryId: title.libraryId, showId: id}) : navigation.replace('Detail', {libraryId: title.libraryId, itemId: id})))); };
  const labels: Readonly<Record<'split' | 'delete', MenuItem>> = {split: {id: 'split', label: t('title.split.action'), icon: 'link'}, delete: {id: 'delete', label: t('title.deleteVersion.action'), icon: 'trash', destructive: true}};
  const canMerge = MERGEABLE_KINDS.includes(title.kind) && !!mergeSearchGroup(title.kind);
  return {
    fileAction: (file, summary) => setMenu({file, summary}),
    mergeRow: canMerge ? <RowGroup><ListRow tone="action" icon="link" title={t('web.selection.merge')} onPress={() => setMerging(true)} /></RowGroup> : undefined,
    sheets: (
      <>
        <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.summary} subtitle={menu?.file.path}
          items={menu ? fileTools(title, menu.file, files?.length ?? 0, SPLITTABLE_KINDS).map(tool => labels[tool]) : []}
          onSelect={id => { const chosen = menu; if (!chosen) return; if (id === 'split') setSplitting(chosen); else setDeleting(chosen); }} />
        <SplitVersionSheet title={title} chosen={splitting} onClose={() => setSplitting(undefined)} onSplit={itemId => { setSplitting(undefined); onChanged(); open(itemId); }} />
        <DeleteVersionSheet title={title} chosen={deleting} onClose={() => setDeleting(undefined)} onDeleted={() => { setDeleting(undefined); onChanged(); }} />
        <MergeSheet open={merging} title={title} onClose={() => setMerging(false)} onMerged={itemId => { setMerging(false); if (itemId === title.id || options.inPlace) onChanged(); else open(itemId); }} />
      </>
    ),
  };
}

/**
 * Split a version off its title: for a file that was grouped with the wrong title. It becomes a
 * title of its own, nothing is deleted, and the two can be merged again.
 */
function SplitVersionSheet({title, chosen, onClose, onSplit}: {title: ToolTitle; chosen?: Chosen; onClose: () => void; onSplit: (itemId: string) => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  return (
    <ConfirmSheet open={!!chosen} onDismiss={onClose} tone="default" title={t('title.split.title')} consequence={chosen ? `${title.title} · ${chosen.summary}\n\n${t('title.split.body')}` : undefined} confirmLabel={t('title.split.confirm')}
      describeError={e => ((e as {code?: string} | null)?.code === 'file_not_listed' ? t('title.split.notFound') : problem(e, 'action') || t('title.split.failed'))}
      onConfirm={async () => {
        if (!chosen) return;
        const record = await findLibraryFile(api, title.libraryId, chosen.file.id);
        if (!record) throw Object.assign(new Error('file_not_listed'), {code: 'file_not_listed'});
        onSplit(await separateLibraryFile(api, title.libraryId, record));
      }} />
  );
}

/**
 * Delete one version of a title. The server's preview names the one file that goes and what must
 * be typed; the title and its other versions stay, with everyone's history. The file is deleted
 * from disk at once and cannot be recovered. When it is the last version, the title is left
 * marked missing, as if the file had been removed outside Portico.
 */
function DeleteVersionSheet({title, chosen, onClose, onDeleted}: {title: ToolTitle; chosen?: Chosen; onClose: () => void; onDeleted: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const pad = rowPaddingX(useSpecPlatform());
  const service = useMemo(() => versionDeletionService(<T,>(path: string, method?: string, body?: unknown) => api.request<T>(path, method, body)), [api]);
  const [preview, setPreview] = useState<VersionDeletePreview>();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // One operation for one confirmed preview: a retry of the same delete is answered with its receipt.
  const [operation, setOperation] = useState('');
  const fileId = chosen?.file.id;
  const read = () => { if (!fileId) return; setError(''); setPreview(undefined); service.preview(title.id, fileId).then(setPreview, e => setError(problem(e))); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setTyped(''); setBusy(false); setOperation(operationId()); read(); }, [service, title.id, fileId]);
  const allowed = preview ? deletionAllowed(preview) : false;
  const confirm = () => {
    if (!preview) return;
    setBusy(true); setError('');
    service.remove(preview, typed.trim(), operation).then(result => {
      const kept = result.receipts.find(r => !r.removed);
      if (kept) { setBusy(false); setError(t(kept.code === 'file_changed' ? 'deleteMedia.fileChanged' : 'deleteMedia.fileNotRemoved')); return; }
      onDeleted();
    }, e => { setBusy(false); setError(problem(e, 'action')); });
  };
  return (
    <Sheet open={!!chosen} onClose={onClose} kind="form" title={t('title.deleteVersion.title')} subtitle={chosen ? `${title.title} · ${chosen.summary}` : undefined}
      primary={{label: t('action.delete'), tone: 'destructive', loading: busy, disabled: !preview || !allowed || typed.trim() !== preview.confirmation, onPress: confirm}}>
      <View style={{gap: space.md, paddingHorizontal: pad}}>
        {error ? <Notice tone="error" message={error} action={preview ? undefined : t('action.tryAgain')} onAction={preview ? undefined : read} /> : null}
        {!preview && !error ? <Text variant="caption" tone="tertiary">{t('deleteMedia.checking')}</Text> : null}
        {preview ? <Text variant="body" tone="secondary">{t('title.deleteVersion.body', {size: preview.totalBytesText})}</Text> : null}
        {preview && chosen?.file.path ? <Text variant="caption" tone="tertiary">{chosen.file.path}</Text> : null}
        {preview && allowed ? <Field label={preview.confirmationKind === 'count' ? t('deleteMedia.typeCount', {count: preview.confirmation}) : t('deleteMedia.typeTitle')} hint={preview.confirmationKind === 'title' ? preview.confirmation : undefined} value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} /> : null}
        {preview && !allowed ? <Notice tone="info" message={t('deleteMedia.disabled')} /> : null}
      </View>
    </Sheet>
  );
}

type Other = Readonly<{id: string; kind: string; title: string; libraryId?: string; year?: number; subtitle?: string}>;
const named = (x: Readonly<{title: string; year?: number}>) => (x.year ? `${x.title} (${x.year})` : x.title);

/**
 * Say that this title and another are the same title. The other is found by name among the
 * titles of the same kind in this library; the owner chooses which of the two to keep, and the
 * other's files become its versions with everyone's watch history combined. Nothing on disk
 * changes.
 */
function MergeSheet({open, title, onClose, onMerged}: {open: boolean; title: ToolTitle; onClose: () => void; /** The id of the title that remains. */ onMerged: (itemId: string) => void}) {
  const {api, session} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const pad = rowPaddingX(useSpecPlatform());
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const {service, snapshot} = useService<SearchService, SearchSnapshot>(() => new SearchService({api, scope, pageSize: 12}), [api, scope]);
  const action = useAction();
  const [query, setQuery] = useState('');
  const [other, setOther] = useState<Other>();
  const [keep, setKeep] = useState(title.id);
  const group = mergeSearchGroup(title.kind);
  // A search that cannot be started (the sheet is on its way out) is simply not made; one that fails says so in the list.
  const search = (words: string) => { try { if (words) void service.select(words, {group, libraryIds: [title.libraryId]}).catch(() => {}); else service.cancel(); } catch { /* the service was let go with the page */ } };
  useEffect(() => { if (open) { setQuery(''); setOther(undefined); setKeep(title.id); action.clear(); search(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, title.id]);
  // What is typed is searched once typing pauses.
  useEffect(() => {
    if (!open || !group || other) return;
    const timer = setTimeout(() => search(query.trim()), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, group, other, query, service, title.libraryId]);
  // A show is named by its own id, as its page is; the rest by the entry's.
  const found = (snapshot.groups.find(g => g.id === group)?.items ?? []).flatMap((result): Other[] => {
    if (result.kind === 'person' || result.kind === 'channel') return [];
    const entry = result as ContentEntry;
    const candidate: Other = {id: entry.kind === 'show' ? entry.navigation?.entityId ?? entry.id : entry.id, kind: entry.kind, title: entry.title, libraryId: entry.libraryId, year: entry.year, subtitle: entry.subtitle};
    return canMergeTitles(title, candidate) ? [candidate] : [];
  });
  const order = other ? mergeOrder<Other>(title, other, keep) : undefined;
  const merge = () => void action.run(async () => { if (order) onMerged(await mergeTitles(api, order.from.id, order.into.id)); });
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={other ? t('web.merge.title') : t('web.selection.merge')} subtitle={other ? undefined : named(title)}
      primary={other ? {label: t('web.selection.merge'), loading: action.busy, onPress: merge} : undefined} leading={other ? {label: t('action.back'), onPress: () => setOther(undefined)} : undefined}>
      <View style={{gap: space.md}}>
        {action.error ? <Notice tone="error" message={action.error} /> : null}
        {!other ? (
          <>
            <Field label={t('server.attention.searchFor')} value={query} onChangeText={setQuery} maxLength={200} autoCorrect={false} autoFocus returnKeyType="search" />
            {snapshot.phase === 'error' && snapshot.error ? <Notice tone="error" message={problem(snapshot.error)} action={t('action.tryAgain')} onAction={() => void service.retry().catch(() => {})} /> : null}
            {found.length ? <RowGroup>{found.map(entry => <ListRow key={entry.id} icon={entry.kind === 'show' ? 'tv' : entry.kind === 'song' ? 'music' : 'film'} title={named(entry)} subtitle={entry.subtitle} accessory="navigation" onPress={() => { setOther(entry); setKeep(title.id); }} />)}</RowGroup> : null}
            {snapshot.phase === 'ready' && !found.length ? <RowGroup><ListRow title={t('server.live.noMatches')} /></RowGroup> : null}
          </>
        ) : (
          <>
            <RowGroup title={t('web.merge.keep')}>
              {[title, other].map(x => <ListRow key={x.id} title={named(x)} selected={keep === x.id} trailingIcon={keep === x.id ? 'check' : undefined} accessibilityState={{selected: keep === x.id}} onPress={() => setKeep(x.id)} />)}
            </RowGroup>
            <Text variant="body" tone="secondary" style={{paddingHorizontal: pad}}>{t('web.merge.body', {title: named(order!.from)})}</Text>
          </>
        )}
      </View>
    </Sheet>
  );
}

/**
 * Merging two of a page's own entries, for the kinds that have no page of their own to start
 * from: an album's songs, a book's files, a title's extras. The owner picks the two that are one
 * (as on the web, where two are selected and merged), then which stays; the other's files become
 * its versions with everyone's history combined. Owners on phones and tablets only; offered only
 * while the page shows two entries of one mergeable kind.
 */
export function useMergeTwo(entries: readonly Readonly<{id: string; kind: string; title: string; libraryId?: string; year?: number; subtitle?: string}>[], onMerged: () => void): {row?: React.ReactNode; sheet: React.ReactNode} {
  const {session} = useSession();
  const t = useI18n().t;
  const [open, setOpen] = useState(false);
  const owner = session?.viewer.role === 'owner' && !isTV;
  const mergeable = entries.filter(e => MERGEABLE_KINDS.includes(e.kind));
  const offered = owner && mergeable.some((a, i) => mergeable.some((b, j) => j > i && canMergeTitles(a, b)));
  if (!offered) return {sheet: null};
  return {
    row: <RowGroup><ListRow tone="action" icon="link" title={t('web.selection.merge')} onPress={() => setOpen(true)} /></RowGroup>,
    sheet: <MergeTwoSheet open={open} entries={mergeable} onClose={() => setOpen(false)} onMerged={() => { setOpen(false); onMerged(); }} />,
  };
}

function MergeTwoSheet({open, entries, onClose, onMerged}: {open: boolean; entries: readonly Other[]; onClose: () => void; onMerged: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const pad = rowPaddingX(useSpecPlatform());
  const action = useAction();
  const [first, setFirst] = useState<Other>();
  const [other, setOther] = useState<Other>();
  const [keep, setKeep] = useState('');
  useEffect(() => { if (open) { setFirst(undefined); setOther(undefined); setKeep(''); action.clear(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const choices = first ? entries.filter(e => canMergeTitles(first, e)) : entries;
  const order = first && other ? mergeOrder<Other>(first, other, keep || first.id) : undefined;
  const merge = () => void action.run(async () => { if (order) { await mergeTitles(api, order.from.id, order.into.id); onMerged(); } });
  const back = other ? () => setOther(undefined) : first ? () => setFirst(undefined) : undefined;
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={order ? t('web.merge.title') : t('web.selection.merge')} subtitle={first && !other ? named(first) : undefined}
      primary={order ? {label: t('web.selection.merge'), loading: action.busy, onPress: merge} : undefined} leading={back ? {label: t('action.back'), onPress: back} : undefined}>
      <View style={{gap: space.md}}>
        {action.error ? <Notice tone="error" message={action.error} /> : null}
        {!order ? (
          <RowGroup title={first ? t('title.merge.find') : undefined}>
            {choices.filter(e => e.id !== first?.id).map(e => <ListRow key={e.id} icon={e.kind === 'song' || e.kind === 'audiobook_file' ? 'music' : 'film'} title={named(e)} subtitle={e.subtitle} accessory="navigation" onPress={() => { if (first) { setOther(e); setKeep(first.id); } else setFirst(e); }} />)}
            {first && choices.length < 2 ? <ListRow title={t('title.merge.none')} /> : null}
          </RowGroup>
        ) : (
          <>
            <RowGroup title={t('web.merge.keep')}>
              {[first!, other!].map(x => <ListRow key={x.id} title={named(x)} subtitle={x.subtitle} selected={(keep || first!.id) === x.id} trailingIcon={(keep || first!.id) === x.id ? 'check' : undefined} accessibilityState={{selected: (keep || first!.id) === x.id}} onPress={() => setKeep(x.id)} />)}
            </RowGroup>
            <Text variant="body" tone="secondary" style={{paddingHorizontal: pad}}>{t('web.merge.body', {title: named(order.from)})}</Text>
          </>
        )}
      </View>
    </Sheet>
  );
}
