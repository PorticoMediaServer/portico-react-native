import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {retryWhenStale} from '../../../../../packages/client-core/src/freshness-actions';
import {removeLibrary} from '../../../../../packages/client-core/src/title-identity';
import {hasAttentionList} from '../../../../../packages/client-core/src/server-admin/attention-words';
import {LibraryManagementService, fetchEpisodeIssues, type EpisodeIssue, type LibraryManagementSnapshot, type ManagedLibrary} from '../../../../../packages/client-core/src/library-management';
import {LibraryInventoryService, type LibraryInventorySnapshot, type ScanTier, type SourceSettings} from '../../../../../packages/client-core/src/library-inventory';
import {parseFilesystemPage, parseLibraryDocument, providerChoices, type FilesystemPage, type LibrarySettings} from '../../../../../packages/client-core/src/administration';
import {iconFor, metadataAgentWords, viewerScope} from '../../../../../packages/client-core/src/presentation/index';
import {sentence} from '../../../../../packages/client-core/src/server-admin/console-words';
import {isMetadataConflict, metadataAgentPath, parseMetadataAgent, saveMetadataAgent, type MetadataAgentId} from '../../../../../packages/client-core/src/server-admin/metadata-agent';
import {addSourceSettings, canAddSource, createLibraryAndScan, filesystemPath, mergeFilesystemPages} from '../../../../../packages/client-core/src/server-admin/panel-logic';
import {scanDepthHelp, scanDepthName, scanStateName} from '../../../../../packages/client-core/src/server-admin/console-catalogue';
import {createOperationIds} from '../../../../../packages/client-core/src/server-admin/server-forms';
import type {MessageId} from '../../../../../packages/i18n/src/index';
import type {ContentStackParams} from '../../app/routes';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {libraryKindLabel} from '../../app/libraries';
import {useLibrariesContext} from '../../app/libraries-context';
import {operationId, problem, unconfigured, useAction, useAdmin, useRead, useService} from '../../app/server-console';
import {Button, ConfirmSheet, Field, ListRow, Menu, Notice, RowGroup, Segmented, Sheet, ToggleRow, afterOverlaysClose, useTheme} from '../../ui';
import {PickRow, TypedRow} from '../settings/ServerForms';
import {NeedsAttentionSheet, useAttentionCounts} from './MetadataPanels';

const KINDS: readonly {id: ManagedLibrary['kind']; description: MessageId}[] = [{id: 'movie', description: 'web.libraries.typeMovies'}, {id: 'tv', description: 'web.libraries.typeTv'}, {id: 'anime', description: 'web.libraries.typeAnime'}, {id: 'music', description: 'web.libraries.typeMusic'}, {id: 'audiobook', description: 'web.libraries.typeAudiobooks'}];
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
const dateTime = (iso: string) => new Date(iso).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'});

/** A title to open from a list inside a sheet: its own page, once the sheets have closed. */
/** A title's page: a show, a playable item, or an album or book (music and audiobooks). */
type TitleTarget = {kind: 'show' | 'item' | 'album' | 'book'; id: string; libraryId: string; title?: string};

/** Libraries: the list in the owner's order, and one library's folders, scans, metadata source, titles that need a match, and removal. */
export function LibrariesPanel() {
  const {api, session} = useSession();
  const {t, has} = useI18n();
  const {viewerId, serverId} = viewerScope(session, api);
  const {service, snapshot} = useService<LibraryManagementService, LibraryManagementSnapshot>(() => new LibraryManagementService({api, scope: {viewerId, serverId}}), [api, viewerId, serverId]);
  useEffect(() => { void service.loadLibraries().catch(() => {}); }, [service]);
  // The list is in the owner's order, the one every client shows.
  const order = useLibrariesContext();
  const rank = new Map(order.items.map((l, i) => [l.id, i]));
  const libraries = [...(snapshot.directory.data?.items ?? [])].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
  const action = useAction();
  const [adding, setAdding] = useState(false);
  const [ordering, setOrdering] = useState(false);
  const [open, setOpen] = useState<string>();
  // How many titles wait for a match in each library: the server's exact count, on the library's row.
  const attention = useAttentionCounts(libraries);
  const navigation = useNavigation<NativeStackNavigationProp<ContentStackParams>>();
  const reload = () => { order.reload(); attention.reload(); void service.loadLibraries().catch(() => {}); };
  const openTitle = (target: TitleTarget) => {
    setOpen(undefined);
    // The sheets close from the inside out, and the title's page is pushed once they are gone: a page under a closing sheet is not shown.
    requestAnimationFrame(() => afterOverlaysClose(() => (target.kind === 'show' ? navigation.push('Show', {libraryId: target.libraryId, showId: target.id}) : target.kind === 'album' || target.kind === 'book' ? navigation.push('Entity', {libraryId: target.libraryId, view: target.kind, entityId: target.id, title: target.title ?? ''}) : navigation.push('Detail', {libraryId: target.libraryId, itemId: target.id}))));
  };
  const move = (index: number, by: -1 | 1) => {
    const ids = libraries.map(l => l.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    void action.run(() => api.request('/v1/admin/libraries/order', 'PUT', {libraryIds: ids})).then(ok => { if (ok) reload(); });
  };
  const status = (l: ManagedLibrary) => (l.source.availability === 'unavailable' ? t('web.libraries.sourceUnavailable') : attention.counts[l.id] ? t('server.attention.badge', {count: attention.counts[l.id]!}) : l.attention ? t('server.libraries.needAttention', {count: l.attention.files}) : l.lastScan?.warnings ? t('server.libraries.warnings', {count: l.lastScan.warnings}) : l.lastScan ? scanStateName(t, has, l.lastScan.status) : undefined);
  return (
    <>
      {snapshot.directory.phase === 'error' ? <Notice tone="error" message={snapshot.directory.error ? problem(snapshot.directory.error) : t('web.libraries.loadFailed')} action={t('action.tryAgain')} onAction={() => void service.loadLibraries().catch(() => {})} /> : null}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      <RowGroup footer={t('web.console.nav.librariesLede')}>
        {snapshot.directory.phase === 'ready' && !libraries.length ? <ListRow title={t('web.shell.noLibraries')} subtitle={t('web.libraries.emptyLede')} /> : null}
        {libraries.map(l => <ListRow key={l.id} icon={iconFor(l.kind)} title={l.name} meta={status(l)} subtitle={[l.name === libraryKindLabel(l.kind) ? '' : libraryKindLabel(l.kind), l.source.path, l.lastScan?.finishedAt ? t('server.libraries.scanned', {when: day(l.lastScan.finishedAt)}) : ''].filter(Boolean).join(' · ')} accessory="navigation" onPress={() => setOpen(l.id)} />)}
        <ListRow tone="action" icon="plus" title={t('web.empty.addLibrary')} onPress={() => setAdding(true)} />
        {libraries.length > 1 ? <ListRow tone="action" title={t('server.libraries.changeOrder')} onPress={() => setOrdering(true)} /> : null}
      </RowGroup>
      <Sheet open={ordering} onClose={() => setOrdering(false)} kind="form" cancelLabel={t('action.done')} title={t('server.libraries.changeOrder')} subtitle={t('server.libraries.orderHelp')}>
        <RowGroup>
          {libraries.map((l, i) => <ListRow key={l.id} icon={iconFor(l.kind)} title={l.name} trailing={<View style={{flexDirection: 'row'}}><Button size="sm" variant="ghost" icon="chevronUp" label="" accessibilityLabel={t('server.libraries.moveUp')} disabled={i === 0 || action.busy} onPress={() => move(i, -1)} /><Button size="sm" variant="ghost" icon="chevronDown" label="" accessibilityLabel={t('server.libraries.moveDown')} disabled={i === libraries.length - 1 || action.busy} onPress={() => move(i, 1)} /></View>} />)}
        </RowGroup>
      </Sheet>
      <AddLibrarySheet open={adding} service={service} onClose={() => setAdding(false)} onCreated={id => { setAdding(false); reload(); if (id) setOpen(id); }} />
      <LibrarySheet libraryId={open} service={service} snapshot={snapshot} waiting={open ? attention.counts[open] ?? 0 : 0} onClose={() => { setOpen(undefined); reload(); }} onOpenTitle={openTitle} onAttentionChanged={attention.reload} />
    </>
  );
}

/** Browse folders on the server's own disks, so an owner picks a folder instead of typing a path the server may not be able to read. */
function FolderSheet({open, start, onClose, onPick}: {open: boolean; start: string; onClose: () => void; onPick: (path: string) => void}) {
  const admin = useAdmin();
  const t = useI18n().t;
  const {space} = useTheme();
  const [path, setPath] = useState(start);
  const [page, setPage] = useState<FilesystemPage>();
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  useEffect(() => { if (open) setPath(start); }, [open, start]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError('');
    admin.get(filesystemPath(path), parseFilesystemPage).then(next => { if (active) setPage(next); }, e => { if (active) setError(problem(e)); });
    return () => { active = false; };
  }, [open, path, admin]);
  const loadMore = () => {
    const current = page;
    if (!current?.nextCursor || more) return;
    setMore(true);
    admin.get(filesystemPath(path, current.nextCursor), parseFilesystemPage).then(next => setPage(p => (p === current && next.path === current.path ? mergeFilesystemPages(current, next) : p)), e => setError(problem(e))).finally(() => setMore(false));
  };
  const folders = page?.entries.filter(e => e.kind === 'directory') ?? [];
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={t('server.chooseFolder')} subtitle={page?.path || undefined} primary={{label: t('server.libraries.useFolder'), disabled: !page?.path, onPress: () => { if (page?.path) { onPick(page.path); onClose(); } }}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="error" message={error} action={t('action.back')} onAction={() => setPath(page?.parent ?? '')} /> : null}
        <RowGroup>
          {page?.parent && page.parent !== page.path ? <ListRow icon="back" title={t('web.folderPicker.up')} onPress={() => setPath(page.parent)} /> : null}
          {!page?.path ? page?.roots.map(r => <ListRow key={r.path} icon="storage" title={r.name || r.path} accessory="navigation" onPress={() => setPath(r.path)} />) : null}
          {folders.map(f => <ListRow key={f.path} icon="folder" title={f.name} meta={!f.readable ? t('web.folderPicker.noAccess') : undefined} {...(f.readable ? {accessory: 'navigation' as const, onPress: () => setPath(f.path)} : {})} />)}
          {page?.nextCursor ? <ListRow tone="action" title={t('web.folderPicker.more')} disabled={more} onPress={loadMore} /> : null}
        </RowGroup>
      </View>
    </Sheet>
  );
}

function AddLibrarySheet({open, service, onClose, onCreated}: {open: boolean; service: LibraryManagementService; onClose: () => void; onCreated: (id?: string) => void}) {
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  const [kind, setKind] = useState<ManagedLibrary['kind']>('movie');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [path, setPath] = useState('');
  const [online, setOnline] = useState(true);
  const [picking, setPicking] = useState(false);
  useEffect(() => { if (open) { setKind('movie'); setName(libraryKindLabel('movie')); setTouched(false); setPath(''); setOnline(true); action.clear(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const create = () => { let created: string | undefined; void action.run(async () => { created = await createLibraryAndScan(service, {name: name.trim(), kind, path: path.trim(), metadataAgent: online ? 'online' : 'local'}); }).then(ok => { if (ok) onCreated(created); }); };
  return (
    <>
      <Sheet open={open && !picking} onClose={onClose} kind="form" title={t('web.libraries.addTitle')} subtitle={t('web.libraries.addLede')} primary={{label: t('web.empty.addLibrary'), loading: action.busy, disabled: !name.trim() || !path.trim(), onPress: create}}>
        <View style={{gap: space.md}}>
          {action.error ? <Notice tone="error" message={action.error} /> : null}
          <RowGroup title={t('web.libraries.type')} footer={t(KINDS.find(k => k.id === kind)!.description)}>
            <PickRow title={t('web.libraries.type')} value={kind} options={KINDS.map(k => ({id: k.id, label: libraryKindLabel(k.id)}))} onChange={id => { setKind(id as ManagedLibrary['kind']); if (!touched) setName(libraryKindLabel(id)); }} />
          </RowGroup>
          <Field label={t('profile.name')} value={name} onChangeText={v => { setName(v); setTouched(true); }} maxLength={100} />
          <RowGroup title={t('web.libraries.serverFolder')} footer={t('web.libraries.serverFolderHelp')}>
            <ListRow icon="folder" title={path || t('server.chooseFolder')} accessory="navigation" onPress={() => setPicking(true)} />
          </RowGroup>
          <RowGroup footer={t('web.metadataSource.addHelper')}>
            <ToggleRow title={t('server.libraries.lookUpOnline')} value={online} onChange={setOnline} />
          </RowGroup>
        </View>
      </Sheet>
      <FolderSheet open={picking} start={path} onClose={() => setPicking(false)} onPick={setPath} />
    </>
  );
}

type Section = 'general' | 'metadata' | 'scanning' | 'advanced';
const RESCAN: readonly {id: string; label: MessageId}[] = [{id: '900', label: 'web.libraries.every15m'}, {id: '3600', label: 'web.libraries.everyHour'}, {id: '21600', label: 'web.libraries.every6h'}, {id: '86400', label: 'web.libraries.daily'}, {id: '0', label: 'web.libraries.onlyWhenAsked'}];

/** One library: General · Metadata · Scanning · Advanced, as on the web. What is typed here is saved with the sheet's Save. */
function LibrarySheet({libraryId, service, snapshot, waiting, onClose, onOpenTitle, onAttentionChanged}: {libraryId?: string; service: LibraryManagementService; snapshot: LibraryManagementSnapshot; /** Titles waiting for a match in this library. */ waiting: number; onClose: () => void; onOpenTitle: (target: TitleTarget) => void; onAttentionChanged: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const [section, setSection] = useState<Section>('general');
  useEffect(() => { if (libraryId) { setSection('general'); void service.selectLibrary(libraryId).catch(() => {}); } }, [service, libraryId]);
  const library = libraryId && snapshot.selected.data?.library.id === libraryId ? snapshot.selected.data.library : undefined;
  return (
    <Sheet open={!!libraryId} onClose={onClose} kind="form" cancelLabel={t('action.done')} title={library?.name} subtitle={library ? libraryKindLabel(library.kind) : undefined}>
      <View style={{gap: space.lg}}>
        {!library && snapshot.selected.error ? <Notice tone="error" message={problem(snapshot.selected.error)} action={t('action.tryAgain')} onAction={() => { if (libraryId) void service.selectLibrary(libraryId).catch(() => {}); }} /> : null}
        {library ? (
          <>
            <Segmented accessibilityLabel={library.name} selected={section} onSelect={id => setSection(id as Section)} items={[{id: 'general', label: t('server.library.tab.general')}, {id: 'metadata', label: t('server.library.tab.metadata')}, {id: 'scanning', label: t('server.library.tab.scanning')}, {id: 'advanced', label: t('settings.section.advanced')}]} />
            <LibraryBody key={library.id} api={api} library={library} section={section} service={service} waiting={waiting} onOpenTitle={onOpenTitle} onAttentionChanged={onAttentionChanged} onRemoved={onClose} />
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

function LibraryBody({api, library, section, service, waiting, onOpenTitle, onAttentionChanged, onRemoved}: {api: ReturnType<typeof useSession>['api']; library: ManagedLibrary; section: Section; service: LibraryManagementService; waiting: number; onOpenTitle: (target: TitleTarget) => void; onAttentionChanged: () => void; onRemoved: () => void}) {
  const {session} = useSession();
  const i18n = useI18n();
  const {t, has} = i18n;
  const admin = useAdmin();
  const {viewerId, serverId} = viewerScope(session, api);
  const inventory = useService<LibraryInventoryService, LibraryInventorySnapshot>(() => new LibraryInventoryService({api, scope: {viewerId, serverId}, libraryId: library.id}), [api, viewerId, serverId, library.id]);
  useEffect(() => { void inventory.service.refresh(); }, [inventory.service]);
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const config = inventory.snapshot.config;
  const scan = library.lastScan;
  const [folder, setFolder] = useState<{id: string; name: string}>();
  const [removing, setRemoving] = useState<{id: string; name: string; revision: number}>();
  const [adding, setAdding] = useState(false);
  const [issues, setIssues] = useState(false);
  const [matching, setMatching] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Removing the whole library, against its configuration as the server has it. A scan or a setting that
  // moved it while its name was being typed changes nothing about which library was named: it is read
  // again and removed as asked.
  const removeWhole = async () => {
    let revision = config?.revision;
    if (revision === undefined) return;
    await retryWhenStale(() => removeLibrary(api, library.id, library.name, revision!), {
      attempts: 1,
      reread: async () => { await inventory.service.refresh(); const now = inventory.service.getSnapshot().config; if (!now) throw new Error('library_configuration_unavailable'); revision = now.revision; },
    });
    setLeaving(false); onRemoved();
  };
  // Metadata source: online or local only, its own resource with its own revision.
  const agent = useRead(async () => { const raw = await unconfigured(api.request<unknown>(metadataAgentPath(library.id))); return raw === null ? null : parseMetadataAgent(raw); }, [api, library.id]);
  const [pending, setPending] = useState<MetadataAgentId>();
  // Deleting: the library's settings document.
  const settings = useRead(() => admin.get(`/v1/admin/libraries/${encodeURIComponent(library.id)}/settings`, parseLibraryDocument), [admin, library.id]);
  const [draft, setDraft] = useState<LibrarySettings>();
  useEffect(() => { setDraft(settings.data?.settings); }, [settings.data]);
  const dirty = !!draft && !!settings.data && JSON.stringify(draft) !== JSON.stringify(settings.data.settings);
  const saveSettings = () => void action.run(async () => {
    const doc = settings.data;
    if (!doc || !draft) return;
    const body = {...draft, providers: draft.providers.map(p => ({...p, apiKey: ''}))};
    await api.request(`/v1/admin/libraries/${encodeURIComponent(library.id)}/settings`, 'PUT', {expectedRevision: doc.revision, operationId: opIds.forPayload(JSON.stringify({revision: doc.revision, settings: body})), settings: body});
    opIds.release(); settings.reload();
  });
  // The library's one online provider, saved as it is picked.
  const setProvider = (index: number, provider: string) => void action.run(async () => {
    const doc = settings.data;
    if (!doc) return;
    const body = {...doc.settings, providers: doc.settings.providers.map((p, n) => ({...p, ...(n === index ? {provider: provider as typeof p.provider} : {}), apiKey: ''}))};
    await api.request(`/v1/admin/libraries/${encodeURIComponent(library.id)}/settings`, 'PUT', {expectedRevision: doc.revision, operationId: opIds.forPayload(JSON.stringify({revision: doc.revision, settings: body})), settings: body});
    opIds.release(); settings.reload(); agent.reload();
  });
  const sourceOf = (src: NonNullable<typeof config>['sources'][number], patch: Partial<SourceSettings> = {}): SourceSettings => ({name: src.name, path: src.path, classification: src.classification, followSymlinks: src.followSymlinks, intervalSeconds: src.intervalSeconds, expectedRevision: config!.revision, acceptReplacement: false, ...patch});
  const refresh = () => void inventory.service.refresh();
  const running = scan?.status === 'running';
  return (
    <>
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      {section === 'general' ? (
        <>
          <RowGroup>
            <TypedRow title={t('profile.name')} value={library.name} maxLength={100} onDone={text => { const name = text.trim(); if (name && name !== library.name) void action.run(() => service.rename(name, library.revision)); }} />
            <ListRow title={t('server.library.type')} meta={libraryKindLabel(library.kind)} />
          </RowGroup>
          {inventory.snapshot.error ? <Notice tone="error" message={problem(inventory.snapshot.error)} action={t('action.tryAgain')} onAction={refresh} /> : null}
          <RowGroup title={t('web.libraries.folders')} footer={t('web.libraries.foldersLede')}>
            {config && !config.sources.length ? <ListRow title={t('web.libraries.noFolders')} subtitle={t('web.libraries.noFoldersHelp')} /> : null}
            {config?.sources.map(src => <ListRow key={src.id} icon="folder" title={src.name || src.path} meta={sentence(src.health || 'unknown')} subtitle={[src.path, src.lastCompleteAt ? t('server.libraries.scanned', {when: day(src.lastCompleteAt)}) : ''].filter(Boolean).join(' · ')} accessory="menu" onPress={() => setFolder({id: src.id, name: src.name || src.path})} />)}
            {canAddSource(config?.revision) ? <ListRow tone="action" icon="plus" title={t('web.libraries.addFolder')} onPress={() => setAdding(true)} /> : null}
          </RowGroup>
          <RowGroup title={t('server.library.remove')} footer={t('server.library.removeHelp')}>
            <ListRow tone="destructive" icon="trash" title={t('server.library.removeRow')} disabled={!config} onPress={() => setLeaving(true)} />
          </RowGroup>
        </>
      ) : null}
      {section === 'metadata' ? (
        <>
          {hasAttentionList(library.kind) ? (
            <RowGroup footer={t('server.attention.lede')}>
              <ListRow icon={waiting ? 'warning' : 'check'} title={t('metadata.attention.title')} meta={waiting ? t('server.attention.badge', {count: waiting}) : t('server.attention.none')} accessory="navigation" onPress={() => setMatching(true)} />
            </RowGroup>
          ) : null}
          {agent.error ? <Notice tone="error" message={agent.error} action={t('action.tryAgain')} onAction={agent.reload} /> : null}
          {agent.data ? (
            <RowGroup title={t('web.metadataSource.title')} footer={(c => (c ? metadataAgentWords(i18n, c, library.kind).description : undefined))(agent.data.agents.find(a => a.id === agent.data!.agent))}>
              <PickRow title={t('web.metadataSource.title')} value={agent.data.agent} options={agent.data.agents.map(a => ({id: a.id, label: metadataAgentWords(i18n, a, library.kind).name}))} onChange={id => { if (id !== agent.data!.agent) setPending(id); }} />
            </RowGroup>
          ) : null}
          {agent.data?.agent !== 'local' && settings.data?.settings.providers.length ? (
            <RowGroup title={t('web.librarySettings.matching')} footer={t('web.librarySettings.matchingLede')}>
              {settings.data.settings.providers.map((p, i) => <PickRow key={p.mediaKind} title={t('web.librarySettings.source')} value={p.provider} options={providerChoices(settings.data!.availableProviders, p).map(a => ({id: a.id, label: a.name}))} onChange={id => { if (id !== p.provider) setProvider(i, id); }} />)}
            </RowGroup>
          ) : null}
          <ConfirmSheet open={!!pending} onDismiss={() => setPending(undefined)} tone="default" title={t(pending === 'local' ? 'web.metadataSource.toLocalTitle' : 'web.metadataSource.toOnlineTitle')} consequence={t(pending === 'local' ? 'web.metadataSource.toLocalBody' : 'web.metadataSource.toOnlineBody')} confirmLabel={t(pending === 'local' ? 'web.metadataSource.toLocalConfirm' : 'web.metadataSource.toOnlineConfirm')}
            describeError={e => (isMetadataConflict(e) ? t('web.metadataSource.changed') : problem(e, 'action'))}
            onConfirm={async () => { const current = agent.data; if (!current || !pending) return; try { await saveMetadataAgent((path, method, body) => api.request(path, method, body), current, library.id, pending); } finally { agent.reload(); } setPending(undefined); }} />
        </>
      ) : null}
      {section === 'scanning' ? (
        <RowGroup title={t('web.libraries.scan')} footer={config ? scanDepthHelp(t, has, config.policy.tier) : t('web.libraries.scanLede')}>
          <ListRow title={t('web.libraries.lastScan')} meta={scan ? scanStateName(t, has, scan.status) : undefined} subtitle={scan ? [t('server.libraries.files', {count: scan.processed}), scan.warnings ? t('server.libraries.warnings', {count: scan.warnings}) : '', scan.finishedAt ? dateTime(scan.finishedAt) : ''].filter(Boolean).join(' · ') : t('web.libraries.notScannedYet')} />
          {library.actions.includes('scan') ? <ListRow tone="action" icon="refresh" title={running ? t('web.libraries.scanningNow') : t('web.libraries.scanNow')} disabled={running || action.busy} onPress={() => void action.run(() => service.scan())} /> : null}
          {library.actions.includes('scan') && !running ? <ListRow tone="action" title={t('web.libraries.scanAllFiles')} disabled={action.busy} onPress={() => void action.run(() => service.scan('full'))} /> : null}
          {running && scan?.actions.includes('cancel') ? <ListRow tone="destructive" title={t('web.libraries.cancelScan')} onPress={() => void action.run(() => service.cancelJob(scan.id))} /> : null}
          {library.attention ? <ListRow icon="warning" title={t('server.libraries.needAttention', {count: library.attention.files})} subtitle={t('web.libraries.attentionHelp')} accessory="navigation" onPress={() => setIssues(true)} /> : null}
          {config ? <PickRow title={t('web.libraries.scanDepth')} value={config.policy.tier} options={(['file_list_only', 'basic', 'complete'] as ScanTier[]).concat(config.policy.tier === 'custom' ? ['custom'] : []).map(x => ({id: x, label: scanDepthName(t, has, x)}))} onChange={tier => { if (tier !== config.policy.tier) void action.run(() => inventory.service.setPolicy({tier: tier as ScanTier, operations: config.policy.operations, expectedRevision: config.revision})).then(refresh); }} /> : null}
          {config?.sources.map(src => <PickRow key={src.id} icon="folder" title={t('server.library.rescan', {folder: src.name || src.path})} value={String(src.intervalSeconds)} options={[...(RESCAN.some(r => r.id === String(src.intervalSeconds)) ? [] : [{id: String(src.intervalSeconds), label: t('server.library.everyMinutes', {count: Math.round(src.intervalSeconds / 60)})}]), ...RESCAN.map(r => ({id: r.id, label: t(r.label)}))]} onChange={id => void action.run(() => inventory.service.saveSource(src.id, sourceOf(src, {intervalSeconds: Number(id)}))).then(refresh)} />)}
        </RowGroup>
      ) : null}
      {section === 'advanced' ? (
        <>
          {settings.error ? <Notice tone="error" message={settings.error} action={t('action.tryAgain')} onAction={settings.reload} /> : null}
          {draft ? (
            <RowGroup title={t('web.librarySettings.deleting')} footer={t('web.librarySettings.deletingLede')}>
              <ToggleRow title={t('web.librarySettings.allowDelete')} value={draft.allowMediaDeletion} onChange={allowMediaDeletion => setDraft({...draft, allowMediaDeletion})} />
              {dirty ? <ListRow tone="action" title={t('action.save')} disabled={action.busy} onPress={saveSettings} /> : null}
              {dirty ? <ListRow title={t('action.discard')} onPress={() => setDraft(settings.data?.settings)} /> : null}
            </RowGroup>
          ) : null}
        </>
      ) : null}
      <Menu open={!!folder} onClose={() => setFolder(undefined)} title={folder?.name} items={[{id: 'scan', label: t('web.libraries.scanFolder'), icon: 'refresh'}, {id: 'check', label: t('web.libraries.checkAvailability'), icon: 'info'}, {id: 'remove', label: t('web.libraries.removeFolder'), icon: 'trash', destructive: true}]}
        onSelect={id => { const f = folder; if (!f) return; if (id === 'scan') void action.run(() => inventory.service.scanSource(f.id)); else if (id === 'check') void action.run(() => inventory.service.checkSource(f.id)).then(refresh); else if (config) setRemoving({...f, revision: config.revision}); }} />
      <ConfirmSheet open={!!removing} onDismiss={() => setRemoving(undefined)} title={t('web.libraries.removeFolderTitle', {name: removing?.name ?? ''})} consequence={t('web.libraries.removeFolderBody')} confirmLabel={t('web.libraries.removeFolder')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const f = removing; if (!f) return; await inventory.service.removeSource(f.id, f.revision); setRemoving(undefined); refresh(); }} />
      <FolderSheet open={adding} start="" onClose={() => setAdding(false)} onPick={path => { if (config) void action.run(() => inventory.service.saveSource(undefined, {...addSourceSettings(config.revision), name: path, path})).then(refresh); }} />
      <IssuesSheet open={issues} libraryId={library.id} onClose={() => setIssues(false)} />
      <NeedsAttentionSheet libraryId={matching ? library.id : undefined} onClose={() => setMatching(false)} onChanged={onAttentionChanged} onOpenTitle={target => { setMatching(false); requestAnimationFrame(() => afterOverlaysClose(() => onOpenTitle(target))); }} />
      <ConfirmSheet open={leaving} onDismiss={() => setLeaving(false)} title={t('server.library.removeTitle', {name: library.name})} consequence={`${t('server.library.removeGoes')}\n\n${t('server.library.removeKept')}`} confirmLabel={t('server.library.remove')} confirmToken={library.name} describeError={e => problem(e, 'action')} onConfirm={removeWhole} />
    </>
  );
}

/** The files a scan couldn't place, a page at a time. */
function IssuesSheet({open, libraryId, onClose}: {open: boolean; libraryId: string; onClose: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const [issues, setIssues] = useState<readonly EpisodeIssue[]>([]);
  const [cursor, setCursor] = useState<string | null>('');
  const [error, setError] = useState('');
  const load = (from: string) => { setError(''); fetchEpisodeIssues(api, libraryId, from).then(page => { setIssues(prev => (from ? [...prev, ...page.issues] : page.issues)); setCursor(page.nextCursor || null); }, e => setError(problem(e))); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) load(''); }, [open, api, libraryId]);
  return (
    <Sheet open={open} onClose={onClose} kind="form" cancelLabel={t('action.close')} title={t('web.libraries.attentionTitle')} subtitle={t('web.libraries.attentionHelp')}>
      {error ? <Notice tone="error" message={error} action={t('action.tryAgain')} onAction={() => load('')} /> : null}
      <RowGroup>
        {issues.map(x => <ListRow key={x.assetId} title={x.sourceName} subtitleLines={3} />)}
        {!issues.length && !error ? <ListRow title={t('web.libraries.attentionEmpty')} /> : null}
        {cursor && issues.length ? <ListRow tone="action" title={t('server.showMore')} onPress={() => load(cursor)} /> : null}
      </RowGroup>
    </Sheet>
  );
}
