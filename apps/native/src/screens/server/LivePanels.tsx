import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {lanConfirmationRoots, previewRemoteSource, remoteSourceDraft, withConfirmedLanRoots, type RefreshStatus, type RemoteSourceDraft, type RemoteSourcePreview, type SourceKind} from '../../../../../packages/client-core/src/linear-api';
import type {RecordingStorage} from '../../../../../packages/client-core/src/dvr';
import {liveSourceChoicesService, parseTunerView, type LiveSourceChoicePage} from '../../../../../packages/client-core/src/administration';
import {readLibraryChannels, readLibraryTemplates, saveLibraryChannel, type LibraryChannel, type LibraryChannelTemplate} from '../../../../../packages/client-core/src/library-channels';
import {formatBytes} from '../../../../../packages/client-core/src/presentation/content';
import {sentence} from '../../../../../packages/client-core/src/server-admin/console-words';
import {importSkipped, liveSourceState, tunerUseLine} from '../../../../../packages/client-core/src/server-admin/live-words';
import {canRefreshSource, guideOnlyPatch, normalizeHdHomerunLocator, regenerationBody} from '../../../../../packages/client-core/src/server-admin/panel-logic';
import {parseRecordingGrants, parseRecordingOwners, recordingAllowed, recordingOwnerKey, recordingOwnerLabel, recordingRulePayload, type RecordingAnchor, type RecordingGrant, type RecordingOwner, type RecordingOwnerChoice} from '../../../../../packages/client-core/src/server-admin/recording-policy';
import {createOperationIds} from '../../../../../packages/client-core/src/server-admin/server-forms';
import {useSession} from '../../app/session';
import {useI18n} from '../../app/i18n';
import {operationId, problem, saveRebased, sendFresh, useAction, useRead, useServerId} from '../../app/server-console';
import {ConfirmSheet, Field, ListRow, Menu, Notice, RowGroup, Segmented, Sheet, ToggleRow, useTheme, type MenuItem} from '../../ui';
import {PickRow, TypedRow, useInlineForm} from '../settings/ServerForms';
import {channelOverride, parseChannelMapPage, saveChannelMap, unsavedChannelEdits, withChoice, type ChannelMapEntry, type ChannelOverride} from './owner-rules';
import {dependsOn} from '../../../../../packages/client-core/src/freshness-hub';

const SOURCE_MOVES = [dependsOn.list('liveSources')];
const RULE_MOVES = [dependsOn.list('recordingGroups')];
const RECORDING_SPACE_MOVES = [dependsOn.list('recordingStorage')];
const CHANNEL_MOVES = [dependsOn.list('libraryChannels')];
const TUNER_MOVES = [dependsOn.list('tuners')];

type LiveSource = {id: string; name: string; revision: number; state: string; tunerCount: number; tunerCountMode: string; publishedAt: string; channels: number; programmes: number; /** What its last import left out, when anything was. */ diagnostics?: unknown};
type SourceList = {sources: LiveSource[]; refresh: RefreshStatus[]};
const sourcePath = (id: string, rest: string) => `/v1/admin/live-sources/${encodeURIComponent(id)}${rest}`;

/** The administration envelope without a parser: these documents name their fields and the panel reads only those. */
function useEnvelope() {
  const {api} = useSession();
  const serverId = useServerId();
  return React.useMemo(() => {
    const open = <T,>(raw: unknown): T => {
      const r = raw as {scope?: {serverId?: string}; result?: T} | null;
      if (!r || r.scope?.serverId !== serverId || r.result === undefined) throw Object.assign(new Error('invalid_response'), {code: 'invalid_response'});
      return r.result;
    };
    return {
      get: async <T,>(path: string) => open<T>(await api.request<unknown>(path)),
      send: async <T,>(path: string, method: string, body?: unknown) => open<T>(await api.request<unknown>(path, method, body)),
    };
  }, [api, serverId]);
}

/** What a guide or playlist import left out and why; nothing when it left nothing out. The rest of the import is in use either way. */
function ImportSkippedNotice({name, diagnostics}: {name?: string; diagnostics: unknown}) {
  const i18n = useI18n();
  const skipped = importSkipped(i18n.t, id => i18n.has(id), diagnostics);
  return skipped ? <Notice tone="warning" title={name} message={[skipped.summary, ...skipped.reasons].join(' ')} /> : null;
}

/** Live TV & Channels › Sources: the tuners and playlists that feed the guide. */
export function LiveSourcesPanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const read = useRead<SourceList>(() => api.request<SourceList>('/v1/admin/live-sources'), [api], {on: SOURCE_MOVES});
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [adding, setAdding] = useState(false);
  const [add, setAdd] = useState<{tuner?: string}>();
  const [discover, setDiscover] = useState(false);
  const [menu, setMenu] = useState<LiveSource>();
  const [configure, setConfigure] = useState<LiveSource>();
  const [mapping, setMapping] = useState<LiveSource>();
  const [remove, setRemove] = useState<LiveSource>();
  // A list with a source this app cannot read keeps the rest: one bad row is left out alone.
  const sources = (read.data?.sources ?? []).filter(src => !!src && typeof src.id === 'string' && !!src.id && typeof src.name === 'string');
  const status = (id: string) => read.data?.refresh.find(r => r.sourceId === id);
  // While a source refreshes, look again every few seconds until it settles.
  const refreshing = !!read.data?.refresh.some(r => r.state === 'refreshing');
  useEffect(() => { if (!refreshing) return; const timer = setInterval(read.reload, 5000); return () => clearInterval(timer); }, [refreshing, read.reload]);
  // The source as the server has it now: read before a switch, a refresh or a removal is sent again.
  const again = (id: string) => async () => (await api.request<SourceList>('/v1/admin/live-sources')).sources.find(x => x.id === id);
  const facts = (src: LiveSource) => [t('server.live.channelCount', {count: src.channels}), t('server.live.programCount', {count: src.programmes}), src.tunerCount ? t('server.live.tunerCount', {count: src.tunerCount}) : '', src.publishedAt ? t('server.live.guideUpdated', {when: new Date(src.publishedAt).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}) : '', status(src.id)?.errorCode ? t('web.console.refreshFailed') : ''].filter(Boolean).join(' · ');
  const items = (src: LiveSource): MenuItem[] => [
    {id: 'settings', label: t('web.liveTv.sourceSettings'), icon: 'settings'},
    {id: 'map', label: t('web.liveTv.channelsAndNumbers'), icon: 'list'},
    ...(canRefreshSource(src, read.data?.refresh) ? [{id: 'refresh', label: t('web.liveTv.refreshGuideNow'), icon: 'refresh'} as MenuItem] : []),
    {id: 'toggle', label: src.state === 'disabled' ? t('web.liveTv.enableSource') : t('web.liveTv.pauseSource'), icon: src.state === 'disabled' ? 'play' : 'pause'},
    {id: 'remove', label: t('web.liveTv.removeSource'), icon: 'trash', destructive: true},
  ];
  const select = (src: LiveSource, id: string) => {
    if (id === 'settings') setConfigure(src);
    else if (id === 'map') setMapping(src);
    else if (id === 'refresh') void action.run(() => sendFresh(src, x => api.request(sourcePath(x.id, '/refresh'), 'POST', {expectedRevision: x.revision}), again(src.id), now => now.state !== 'disabled')).then(ok => { if (ok) read.reload(); });
    else if (id === 'toggle') {
      const enabled = src.state === 'disabled';
      void action.run(async () => {
        await sendFresh(src, x => api.request(sourcePath(x.id, '/enabled'), 'POST', {expectedRevision: x.revision, enabled, requestId: opIds.forPayload(JSON.stringify({id: x.id, revision: x.revision, enabled}))}), again(src.id), now => ((now.state !== 'disabled') === enabled ? 'done' : true));
        opIds.release();
      }).then(ok => { if (ok) read.reload(); });
    } else setRemove(src);
  };
  return (
    <>
      {read.error && !read.data ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      {sources.map(src => <ImportSkippedNotice key={'skipped:' + src.id} name={src.name} diagnostics={src.diagnostics} />)}
      <RowGroup title={t('web.liveTv.sources')}>
        {read.data && !sources.length ? <ListRow title={t('live.noSources')} subtitle={t('web.liveTv.noSourcesHelp')} /> : null}
        {sources.map(src => <ListRow key={src.id} icon="live" title={src.name} meta={t(liveSourceState(src, status(src.id)).id)} subtitle={facts(src)} accessory="menu" onPress={() => setMenu(src)} />)}
        <ListRow tone="action" icon="plus" title={t('web.liveTv.addSource')} onPress={() => setAdding(true)} />
      </RowGroup>
      <Menu open={adding} onClose={() => setAdding(false)} title={t('web.liveTv.addSource')} items={[{id: 'remote', label: t('web.liveTv.remoteSource'), detail: t('web.liveTv.remoteSourceMeta'), icon: 'live'}, {id: 'discover', label: t('web.liveTv.discover'), detail: t('web.liveTv.discoverMeta'), icon: 'search'}]} onSelect={id => (id === 'discover' ? setDiscover(true) : setAdd({}))} />
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.name} items={menu ? items(menu) : []} onSelect={id => { if (menu) select(menu, id); }} />
      <RemoteSourceSheet open={!!add} tuner={add?.tuner} onClose={() => setAdd(undefined)} onSaved={() => { setAdd(undefined); read.reload(); }} />
      <DiscoverSheet open={discover} onClose={() => setDiscover(false)} onUse={address => { setDiscover(false); setAdd({tuner: address}); }} />
      <SourceSettingsSheet src={configure} guides={sources} onClose={() => setConfigure(undefined)} onChanged={read.reload} />
      <ChannelMapSheet src={mapping} onClose={() => { setMapping(undefined); read.reload(); }} />
      <ConfirmSheet open={!!remove} onDismiss={() => setRemove(undefined)} title={t('web.liveTv.removeTitle', {name: remove?.name ?? ''})} consequence={t('web.liveTv.removeBody')} confirmLabel={t('web.liveTv.removeSource')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const src = remove; if (!src) return; await sendFresh(src, x => api.request(sourcePath(x.id, '/remove'), 'POST', {expectedRevision: x.revision, requestId: opIds.forPayload(JSON.stringify({id: x.id, revision: x.revision}))}), again(src.id)); opIds.release(); setRemove(undefined); read.reload(); }} />
    </>
  );
}

const KINDS: readonly {id: SourceKind; label: string}[] = [{id: 'm3u', label: 'M3U'}, {id: 'xtream', label: 'Xtream'}, {id: 'hdhomerun', label: 'HDHomeRun'}]; // lint-strings-allow: format and product names, the same in every language

/** Adds a tuner or playlist: check it first, confirm any home-network addresses it uses, then add. */
function RemoteSourceSheet({open, tuner, onClose, onSaved}: {open: boolean; tuner?: string; onClose: () => void; onSaved: () => void}) {
  const {api} = useSession();
  const serverId = useServerId();
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [draft, setDraft] = useState<RemoteSourceDraft>(() => remoteSourceDraft(operationId()));
  const [preview, setPreview] = useState<RemoteSourcePreview>();
  const [confirm, setConfirm] = useState<readonly string[]>();
  useEffect(() => {
    if (!open) return;
    setDraft({...remoteSourceDraft(operationId()), viewerAccess: 'server-members', ...(tuner ? {kind: 'hdhomerun' as SourceKind, locator: tuner, name: 'HDHomeRun', useDiscoveredCapacity: true} : {})});
    setPreview(undefined); setConfirm(undefined); action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tuner]);
  const check = (next: RemoteSourceDraft) => void action.run(async () => {
    setConfirm(undefined);
    const normalized = next.kind === 'hdhomerun' ? {...next, locator: normalizeHdHomerunLocator(next.locator)} : next;
    if (normalized.locator !== next.locator) setDraft(normalized);
    try { setPreview(await previewRemoteSource(api, serverId, normalized)); }
    catch (e) { const roots = lanConfirmationRoots(e); if (roots) { setConfirm(roots); return; } throw e; }
  });
  const edit = (next: Partial<RemoteSourceDraft>, keepPreview = false) => { setDraft(d => ({...d, ...next})); if (!keepPreview) setPreview(undefined); };
  const primary = preview
    ? {label: t('web.liveTv.addSource'), loading: action.busy, onPress: () => void action.run(async () => { await api.request('/v1/admin/live-sources/remote/save', 'POST', {previewId: preview.previewId, requestId: opIds.forPayload(JSON.stringify({previewId: preview.previewId}))}); opIds.release(); }).then(ok => { if (ok) onSaved(); })}
    : confirm
      ? {label: t('web.liveTv.lanConfirm'), loading: action.busy, onPress: () => { const next = withConfirmedLanRoots(draft, confirm); setDraft(next); check(next); }}
      : {label: t('web.liveTv.checkSource'), loading: action.busy, disabled: !draft.name.trim() || !draft.locator.trim(), onPress: () => check(draft)};
  return (
    <Sheet open={open} onClose={onClose} kind="form" title={t('web.liveTv.addDialog')} subtitle={t('web.liveTv.addDialogLede')} primary={primary}>
      <View style={{gap: space.md}}>
        <Segmented accessibilityLabel={t('web.libraries.kind')} items={KINDS.map(k => ({id: k.id, label: k.label}))} selected={draft.kind} onSelect={kind => edit({kind: kind as SourceKind})} />
        <Field label={t('profile.name')} value={draft.name} onChangeText={name => edit({name}, true)} maxLength={100} />
        <Field label={draft.kind === 'hdhomerun' ? t('web.liveTv.tunerAddress') : draft.kind === 'xtream' ? t('web.liveTv.serverAddress') : t('web.liveTv.playlistUrl')} value={draft.locator} onChangeText={locator => edit({locator})} placeholder={draft.kind === 'hdhomerun' ? '192.168.1.50' : 'https://'} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        {/* A tuner sends channels and little or no guide: its listings come from an XMLTV address, matched under Channels and numbers. */}
        <Field label={t('web.liveTv.guideUrl')} hint={t(draft.kind === 'hdhomerun' ? 'server.live.guideUrlTunerHelp' : 'server.live.guideUrlHelp')} value={draft.guideUrl} onChangeText={guideUrl => edit({guideUrl})} autoCapitalize="none" autoCorrect={false} keyboardType="url" />
        {draft.kind === 'xtream' ? <Field label={t('web.direct.username')} value={draft.username} onChangeText={username => edit({username})} autoCapitalize="none" autoCorrect={false} /> : null}
        {draft.kind === 'xtream' ? <Field label={t('web.account.password')} secure value={draft.password} onChangeText={password => edit({password})} /> : null}
        <RowGroup>
          <PickRow title={t('web.liveTv.whoCanWatch')} value={draft.viewerAccess} options={[{id: 'server-members', label: t('web.liveTv.everyoneOnServer')}, {id: 'owner-only', label: t('web.together.onlyMe')}]} onChange={id => edit({viewerAccess: id as RemoteSourceDraft['viewerAccess']}, true)} />
          <PickRow title={t('web.liveTv.refreshGuide')} value={String(draft.refreshSeconds)} options={[{id: '3600', label: t('web.libraries.everyHour')}, {id: '21600', label: t('web.libraries.every6h')}, {id: '43200', label: t('web.liveTv.every12h')}, {id: '86400', label: t('web.libraries.daily')}]} onChange={id => edit({refreshSeconds: Number(id)}, true)} />
        </RowGroup>
        {preview ? <Notice tone="success" title={t('web.liveTv.previewMeta', {channels: preview.preview.channels, programs: preview.preview.programmes.toLocaleString()})} message={[preview.preview.names.slice(0, 6).join(', '), preview.discoveredCapacity ? t('web.liveTv.capacityTuners', {count: preview.discoveredCapacity}) : ''].filter(Boolean).join(' · ')} /> : null}
        {preview ? <ImportSkippedNotice diagnostics={preview.preview.diagnostics} /> : null}
        {confirm ? <Notice tone="warning" title={t('web.liveTv.lanTitle')} message={[t('web.liveTv.lanBody'), ...confirm].join('\n')} /> : null}
        {action.error ? <Notice tone="error" message={action.error} /> : null}
      </View>
    </Sheet>
  );
}

type Tuner = {deviceId: string; model: string; friendlyName: string; address: string; baseUrl: string; tunerCount: number; configured: boolean};
type Discovery = {devices: Tuner[]; discoveryEnabled: boolean};

/** Looks for network tuners on the server's own network. Nothing is added by looking. */
function DiscoverSheet({open, onClose, onUse}: {open: boolean; onClose: () => void; onUse: (address: string) => void}) {
  const admin = useEnvelope();
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  const [result, setResult] = useState<Discovery>();
  const search = () => void action.run(async () => setResult(await admin.send<Discovery>('/v1/admin/live-sources/discover', 'POST', {windowSeconds: 5})));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setResult(undefined); search(); } }, [open]);
  return (
    <Sheet open={open} onClose={onClose} kind="form" cancelLabel={t('action.close')} title={t('web.liveSource.discoverTitle')} subtitle={t('web.liveSource.discoverLede')} primary={{label: t('web.liveSource.searchAgain'), loading: action.busy, onPress: search}}>
      <View style={{gap: space.md}}>
        {action.error ? <Notice tone="error" message={action.error} /> : null}
        {action.busy && !result ? <Notice tone="info" message={t('web.liveSource.searching')} /> : null}
        {result && !result.discoveryEnabled ? <Notice tone="info" message={t('web.liveSource.searchOff')} /> : null}
        {result && result.discoveryEnabled && !result.devices.length ? <Notice tone="info" message={t('web.liveSource.noTuners')} /> : null}
        {result?.devices.length ? <RowGroup>{result.devices.map(found => <ListRow key={found.deviceId || found.address} icon="live" title={found.friendlyName || found.model || t('web.liveSource.tunerFallback')} subtitle={[found.model, found.address, found.tunerCount ? t('server.live.tunerCount', {count: found.tunerCount}) : ''].filter(Boolean).join(' · ')} {...(found.configured ? {meta: t('web.liveSource.alreadyAdded')} : {accessory: 'navigation' as const, onPress: () => onUse(found.baseUrl || found.address)})} />)}</RowGroup> : null}
      </View>
    </Sheet>
  );
}

type FilterRule = {mode: 'include' | 'exclude'; values: string[]};
type SourceSettings = {/** Empty: every group, and every channel, comes in. What is kept is the source's own key for each, never a viewer's channel id. */ enabledGroups?: readonly string[]; enabledChannels?: readonly string[]; kind: string; streamBufferSeconds: number | null; retryWindowSeconds: number | null; userAgent: string; filters: {categories: FilterRule; countries: FilterRule; keywords: FilterRule}; logoImport: {enabled: boolean; overwriteExisting: boolean}; channelNumbering: {mode: 'source' | 'sequential'; startAt: number; step: number}; guideSourceId: string; /** This source's own import limits, lower than the server's; null keeps the server's. */ importLimits?: ImportLimits | null};
type ImportLimits = {bytes: number; channels: number; programmes: number};
type SourceDocument = {sourceId: string; sourceName: string; revision: number; settings: SourceSettings; effective: {streamBufferSeconds: number; retryWindowSeconds: number; importLimits?: ImportLimits}; availableKinds: string[]};
const MB = 1048576;
const FILTERS = [{key: 'categories', label: 'server.live.filter.categories'}, {key: 'countries', label: 'server.live.filter.countries'}, {key: 'keywords', label: 'server.live.filter.keywords'}] as const;
const KIND_LABEL: Record<string, 'server.live.kind.playlist' | 'server.live.kind.guide' | 'server.live.kind.tuner'> = {playlist: 'server.live.kind.playlist', 'xmltv-guide': 'server.live.kind.guide', hdhomerun: 'server.live.kind.tuner'};

/** One source's own settings: what it provides, where its guide comes from, which channels are wanted and how they are numbered. */
function SourceSettingsSheet({src, guides, onClose, onChanged}: {src?: {id: string; name: string}; guides: readonly {id: string; name: string}[]; onClose: () => void; onChanged: () => void}) {
  const admin = useEnvelope();
  const t = useI18n().t;
  const {space} = useTheme();
  const read = useRead(() => (src ? admin.get<SourceDocument>(sourcePath(src.id, '/configuration')) : Promise.resolve(undefined)), [admin, src?.id]);
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [draft, setDraft] = useState<SourceSettings>();
  // What the draft is compared with, and the revision it is saved against.
  const [base, setBase] = useState<{settings: SourceSettings; revision: number}>();
  useEffect(() => { setDraft(read.data?.settings); setBase(read.data ? {settings: read.data.settings, revision: read.data.revision} : undefined); }, [read.data]);
  const doc = read.data;
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base.settings);
  const guideOnly = draft?.kind === 'xmltv-guide';
  const patch = (p: Partial<SourceSettings>) => setDraft(d => (d ? {...d, ...p} : d));
  // The source's settings may have moved (a channel was renumbered, or they were saved elsewhere): these edits are carried onto them and saved again.
  const save = () => void action.run(async () => {
    if (!src || !draft || !base) return;
    await saveRebased({
      base: base.settings, revision: base.revision, draft,
      put: (revision, settings) => admin.send(sourcePath(src.id, '/configuration'), 'PUT', {expectedRevision: revision, operationId: opIds.forPayload(JSON.stringify({revision, settings})), settings}),
      reread: async () => { const fresh = await admin.get<SourceDocument>(sourcePath(src.id, '/configuration')); return {revision: fresh.revision, value: fresh.settings}; },
      onRebased: (fresh, merged, revision) => { setBase({settings: fresh, revision}); setDraft(merged); },
    });
    opIds.release(); onChanged();
  }).then(ok => { if (ok) onClose(); });
  const seconds = (value: number | null, fallback: number) => (value === null ? t('web.liveSource.serverDefault', {value: fallback}) : `${value} ${t('settings.unit.seconds')}`);
  return (
    <Sheet open={!!src} onClose={onClose} kind="form" title={src?.name} subtitle={t('web.liveSource.settingsLede')} primary={{label: t('action.save'), loading: action.busy, disabled: !dirty, onPress: save}}>
      <View style={{gap: space.md}}>
        {read.error ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
        {action.error ? <Notice tone="error" message={action.error} /> : null}
        {draft && doc ? (
          <>
            <RowGroup footer={guideOnly ? t('web.liveSource.guideOnlyNote') : undefined}>
              <PickRow title={t('web.liveSource.provides')} value={draft.kind} options={doc.availableKinds.map(k => ({id: k, label: KIND_LABEL[k] ? t(KIND_LABEL[k]!) : k}))} onChange={kind => patch(guideOnlyPatch(kind) as Partial<SourceSettings>)} />
              {!guideOnly ? <PickRow title={t('web.liveSource.guideFrom')} help={t('web.liveSource.guideFromHelp')} value={draft.guideSourceId || 'own'} options={[{id: 'own', label: t('web.liveSource.ownGuide')}, ...guides.filter(g => g.id !== src?.id).map(g => ({id: g.id, label: g.name}))]} onChange={id => patch({guideSourceId: id === 'own' ? '' : id})} /> : null}
            </RowGroup>
            {/* Bringing in only part of a large line-up: chosen from what the source really has. Nothing chosen means all of it. */}
            {!guideOnly && src ? <SourceChoiceRows sourceId={src.id} kind="groups" title={t('server.live.onlyGroups')} help={t('server.live.pickGroupsHelp')} value={draft.enabledGroups ?? []} onChange={enabledGroups => patch({enabledGroups})} /> : null}
            {!guideOnly && src ? <SourceChoiceRows sourceId={src.id} kind="channels" title={t('server.live.onlyChannels')} help={t('server.live.pickChannelsHelp')} value={draft.enabledChannels ?? []} onChange={enabledChannels => patch({enabledChannels})} /> : null}
            {!guideOnly ? (
              <RowGroup title={t('web.liveSource.keepChannels')}>
                {FILTERS.map(f => (
                  <React.Fragment key={f.key}>
                    <TypedRow title={t(f.label)} value={draft.filters[f.key].values.join(', ')} placeholder={t('web.liveSource.filterPlaceholder')} onDone={text => patch({filters: {...draft.filters, [f.key]: {...draft.filters[f.key], values: text.split(',').map(v => v.trim()).filter(Boolean)}}})} />
                    {draft.filters[f.key].values.length ? <PickRow title={t('server.live.filter.mode')} value={draft.filters[f.key].mode} options={[{id: 'include', label: t('web.liveSource.onlyThese')}, {id: 'exclude', label: t('web.liveSource.allButThese')}]} onChange={mode => patch({filters: {...draft.filters, [f.key]: {...draft.filters[f.key], mode: mode as FilterRule['mode']}}})} /> : null}
                  </React.Fragment>
                ))}
              </RowGroup>
            ) : null}
            {!guideOnly ? (
              <RowGroup title={t('web.liveSource.channelNumbers')}>
                <PickRow title={t('web.liveSource.numbering')} value={draft.channelNumbering.mode} options={[{id: 'source', label: t('web.liveSource.asSent')}, {id: 'sequential', label: t('web.liveSource.inOrder')}]} onChange={mode => patch({channelNumbering: {...draft.channelNumbering, mode: mode as 'source' | 'sequential'}})} />
                {draft.channelNumbering.mode === 'sequential' ? <TypedRow numeric title={t('web.liveSource.startAt')} value={String(draft.channelNumbering.startAt)} onDone={text => patch({channelNumbering: {...draft.channelNumbering, startAt: Math.max(1, Number(text) || 1)}})} /> : null}
                {draft.channelNumbering.mode === 'sequential' ? <TypedRow numeric title={t('web.liveSource.countBy')} value={String(draft.channelNumbering.step)} onDone={text => patch({channelNumbering: {...draft.channelNumbering, step: Math.max(1, Number(text) || 1)}})} /> : null}
              </RowGroup>
            ) : null}
            {!guideOnly ? (
              <RowGroup title={t('web.liveSource.channelLogos')}>
                <ToggleRow title={t('web.liveSource.bringLogos')} value={draft.logoImport.enabled} onChange={enabled => patch({logoImport: {...draft.logoImport, enabled}})} />
                {draft.logoImport.enabled ? <ToggleRow title={t('web.liveSource.replaceLogos')} value={draft.logoImport.overwriteExisting} onChange={overwriteExisting => patch({logoImport: {...draft.logoImport, overwriteExisting}})} /> : null}
              </RowGroup>
            ) : null}
            {!guideOnly ? (
              <RowGroup>
                <TypedRow numeric title={t('web.liveSource.streamBuffer')} value={draft.streamBufferSeconds === null ? '' : String(draft.streamBufferSeconds)} shown={seconds(draft.streamBufferSeconds, doc.effective.streamBufferSeconds)} onDone={text => patch({streamBufferSeconds: text.trim() === '' ? null : Math.max(0, Number(text) || 0)})} />
                <TypedRow numeric title={t('web.liveSource.retryFor')} value={draft.retryWindowSeconds === null ? '' : String(draft.retryWindowSeconds)} shown={seconds(draft.retryWindowSeconds, doc.effective.retryWindowSeconds)} onDone={text => patch({retryWindowSeconds: text.trim() === '' ? null : Math.max(0, Number(text) || 0)})} />
              </RowGroup>
            ) : null}
            {/* This source's own import limits: lower than the server's, never higher; an empty field is the server's. */}
            <RowGroup title={t('server.liveSource.limits')} footer={t('server.liveSource.limitsHelp')}>
              {(['channels', 'programmes', 'bytes'] as const).map(field => {
                const own = draft.importLimits?.[field] ?? 0;
                const scale = field === 'bytes' ? MB : 1;
                const server = doc.effective.importLimits?.[field];
                const title = field === 'channels' ? t('server.live.limitChannels') : field === 'programmes' ? t('server.live.limitProgrammes') : `${t('server.live.limitSize')} (${t('settings.unit.mb')})`;
                const set = (text: string) => {
                  const value = text.trim() === '' ? 0 : Math.max(0, Math.round((Number(text) || 0) * scale));
                  const next = {...(draft.importLimits ?? {bytes: 0, channels: 0, programmes: 0}), [field]: value};
                  patch({importLimits: next.bytes || next.channels || next.programmes ? next : null});
                };
                return <TypedRow key={field} numeric title={title} value={own ? String(Math.round(own / scale)) : ''} shown={own ? String(Math.round(own / scale)) : server ? t('server.liveSource.limitDefault', {value: Math.round(server / scale)}) : ''} onDone={set} />;
              })}
            </RowGroup>
          </>
        ) : null}
      </View>
    </Sheet>
  );
}

type SourceChoice = LiveSourceChoicePage['items'][number];

/**
 * Choose some of a source's groups or channels from what it really has: a row that says how
 * many are chosen and opens a searchable list, a page at a time. Something chosen earlier that
 * the source no longer lists stays chosen until it is turned off. Saved with the source's settings.
 */
function SourceChoiceRows({sourceId, kind, title, help, value, onChange}: {sourceId: string; kind: 'groups' | 'channels'; title: string; help: string; value: readonly string[]; onChange: (next: readonly string[]) => void}) {
  const t = useI18n().t;
  const {api} = useSession();
  const {space} = useTheme();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<readonly SourceChoice[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState('');
  const service = React.useMemo(() => liveSourceChoicesService(<T,>(path: string, method?: string, body?: unknown) => api.request<T>(path, method, body), sourceId), [api, sourceId]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    // What is typed is searched once typing pauses; a new search starts the list again.
    const timer = setTimeout(() => {
      setLoading(true); setFailed('');
      service.list(kind, '', 50, query.trim()).then(page => { if (live) { setItems(page.items); setTotal(page.total); setCursor(page.nextCursor); } }, e => { if (live) setFailed(problem(e)); }).finally(() => { if (live) setLoading(false); });
    }, query ? 300 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [open, service, kind, query]);
  const more = () => {
    setLoading(true);
    service.list(kind, cursor, 50, query.trim()).then(page => { setItems(prev => [...prev, ...page.items.filter(x => !prev.some(p => p.id === x.id))]); setCursor(page.nextCursor); }, e => setFailed(problem(e))).finally(() => setLoading(false));
  };
  // Chosen before and not in this list (another search, or no longer in the source): still shown, so it can be turned off.
  const gone = value.filter(id => !items.some(x => x.id === id));
  return (
    <>
      <RowGroup title={title} footer={help}>
        <ListRow title={value.length ? t('server.live.chosenCount', {count: value.length}) : t('server.live.chosenAll')} meta={t('server.live.choose')} accessory="navigation" onPress={() => { setQuery(''); setOpen(true); }} />
        {value.length ? <ListRow tone="action" title={t('server.live.chooseAll')} onPress={() => onChange([])} /> : null}
      </RowGroup>
      <Sheet open={open} onClose={() => setOpen(false)} kind="form" cancelLabel={t('action.done')} title={title} subtitle={total ? `${t('server.live.choiceTotal', {count: total})} ${help}` : help}>
        <View style={{gap: space.md}}>
          <Field accessibilityLabel={t(kind === 'groups' ? 'server.live.searchGroups' : 'server.live.searchChannels')} placeholder={t(kind === 'groups' ? 'server.live.searchGroups' : 'server.live.searchChannels')} value={query} onChangeText={setQuery} autoCapitalize="none" autoCorrect={false} returnKeyType="search" />
          {failed ? <Notice tone="error" message={failed} /> : null}
          <RowGroup>
            {items.map(x => <ToggleRow key={x.id} title={x.name || x.id} subtitle={kind === 'groups' ? t('server.live.channelCount', {count: x.channels}) : x.group || undefined} value={value.includes(x.id)} onChange={on => onChange(withChoice(value, x.id, on))} />)}
            {gone.map(id => <ToggleRow key={'chosen:' + id} title={id} value onChange={() => onChange(withChoice(value, id, false))} />)}
            {!items.length && !gone.length && !loading && !failed ? <ListRow title={t('server.live.noMatches')} /> : null}
            {cursor ? <ListRow tone="action" title={t('server.showMore')} disabled={loading} onPress={more} /> : null}
          </RowGroup>
        </View>
      </Sheet>
    </>
  );
}

/**
 * Channels and numbers: give a channel its own number, hide it, or match it to a guide listing
 * (how a tuner's channels get their program listings). Each row says what the source sent and
 * what is in force. Only the channels that were touched are sent, in batches the server accepts.
 */
function ChannelMapSheet({src, onClose}: {src?: {id: string; name: string}; onClose: () => void}) {
  const admin = useEnvelope();
  const t = useI18n().t;
  const {space} = useTheme();
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [channels, setChannels] = useState<readonly ChannelMapEntry[]>([]);
  const [cursor, setCursor] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [edits, setEdits] = useState<Readonly<Record<string, ChannelOverride>>>({});
  const [filter, setFilter] = useState('');
  const [partial, setPartial] = useState<{saved: number; total: number}>();
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState<ChannelMapEntry>();
  const [form, setForm] = useState<ChannelOverride>({number: '', guideChannelId: '', hidden: false});
  const id = src?.id;
  const more = async (from: string) => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const page = parseChannelMapPage(await admin.get<unknown>(sourcePath(id, `/channel-map?limit=100${from ? '&cursor=' + encodeURIComponent(from) : ''}`)));
      setChannels(prev => (from ? [...prev, ...page.items.filter(c => !prev.some(p => p.channelId === c.channelId))] : page.items));
      setCursor(page.nextCursor);
    } catch (e) { setError(problem(e)); } finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setChannels([]); setCursor(''); setEdits({}); setFilter(''); setPartial(undefined); setSaved(false); action.clear(); if (id) void more(''); }, [id]);
  const changed = Object.keys(edits).length;
  const needle = filter.trim().toLowerCase();
  const shown = needle ? channels.filter(c => `${c.name} ${c.number} ${c.group}`.toLowerCase().includes(needle)) : channels;
  const save = () => void action.run(async () => {
    if (!id) return;
    setPartial(undefined); setSaved(false);
    const result = await saveChannelMap(edits, {
      revision: async () => (await admin.get<{revision: number}>(sourcePath(id, '/configuration'))).revision,
      put: (revision, batch) => admin.send(sourcePath(id, '/channel-map'), 'PUT', {expectedRevision: revision, operationId: opIds.forPayload(JSON.stringify({revision, batch})), overrides: batch}),
    });
    await more('');
    if (result.error !== undefined) {
      // What went through is saved; the rest stays on screen to be saved again.
      setEdits(unsavedChannelEdits(edits, result.saved));
      if (result.saved) setPartial({saved: result.saved, total: result.total});
      throw result.error;
    }
    setEdits({}); opIds.release(); setSaved(true);
  });
  const line = (c: ChannelMapEntry) => {
    const v = channelOverride(c, edits);
    return [c.group, `${t('server.live.map.fromSource')}: ${c.sourceNumber || '—'}`, v.guideChannelId ? `${t('server.live.map.guideId')}: ${v.guideChannelId}` : ''].filter(Boolean).join(' · ');
  };
  return (
    <>
      <Sheet open={!!src && !editing} onClose={onClose} kind="form" cancelLabel={t('action.close')} title={t('web.liveSource.channelMapTitle', {name: src?.name ?? ''})} subtitle={t('web.liveSource.channelMapLede')}
        primary={{label: changed ? t('web.liveSource.saveMapChanges', {changed}) : t('action.save'), loading: action.busy, disabled: !changed, onPress: save}}>
        <View style={{gap: space.md}}>
          {error ? <Notice tone="error" message={error} action={t('action.tryAgain')} onAction={() => void more('')} /> : null}
          {action.error ? <Notice tone="error" message={action.error} /> : null}
          {partial ? <Notice tone="warning" message={t('web.liveSource.channelMapPartial', {saved: partial.saved, total: partial.total})} /> : null}
          {saved ? <Notice tone="success" message={t('server.live.saved')} /> : null}
          <Field accessibilityLabel={t('web.live.findChannel')} placeholder={t('web.live.findChannel')} value={filter} onChangeText={setFilter} autoCapitalize="none" autoCorrect={false} />
          <RowGroup>
            {shown.map(c => {
              const v = channelOverride(c, edits);
              return <ListRow key={c.channelId} title={c.name} subtitle={line(c)} subtitleLines={3} meta={v.hidden ? t('server.live.map.hidden') : v.number || c.number || undefined} selected={!!edits[c.channelId]} accessory="navigation" onPress={() => { setForm(v); setEditing(c); }} />;
            })}
            {!loading && !channels.length && !error ? <ListRow title={t('web.liveSource.noChannels')} /> : null}
            {loading && !channels.length ? <ListRow title={t('web.liveSource.loadingChannels')} /> : null}
            {cursor ? <ListRow tone="action" title={t('action.showMoreChannels')} disabled={loading} onPress={() => void more(cursor)} /> : null}
          </RowGroup>
        </View>
      </Sheet>
      {/* One channel: its number here, the guide listing it takes its programs from, and whether it is shown. Kept until the list's Save. */}
      <Sheet open={!!editing} onClose={() => setEditing(undefined)} kind="form" title={editing?.name} subtitle={editing ? `${t('server.live.map.fromSource')}: ${editing.sourceNumber || '—'}` : undefined}
        primary={{label: t('action.done'), onPress: () => { const c = editing; if (c) { setSaved(false); setEdits(prev => ({...prev, [c.channelId]: form})); } setEditing(undefined); }}}>
        <View style={{gap: space.md}}>
          <Field label={t('server.live.map.number')} placeholder={editing?.number || undefined} value={form.number} onChangeText={number => setForm(f => ({...f, number}))} maxLength={12} autoCapitalize="none" autoCorrect={false} />
          <Field label={t('server.live.map.guideId')} placeholder={t('player.quality.automatic')} value={form.guideChannelId} onChangeText={guideChannelId => setForm(f => ({...f, guideChannelId}))} maxLength={200} autoCapitalize="none" autoCorrect={false} />
          <RowGroup><ToggleRow title={t('server.live.map.hidden')} value={form.hidden} onChange={hidden => setForm(f => ({...f, hidden}))} /></RowGroup>
        </View>
      </Sheet>
    </>
  );
}

/** Recording › Tuners: which tuner is doing what, now and soon, and where two recordings will collide. */
export function TunersPanel() {
  const {api} = useSession();
  const serverId = useServerId();
  const t = useI18n().t;
  const read = useRead(async () => { const raw = await api.request<{scope?: {serverId?: string}; result?: unknown}>('/v1/admin/dvr/tuners'); if (raw?.scope?.serverId !== serverId) throw Object.assign(new Error('invalid_response'), {code: 'invalid_response'}); return parseTunerView(raw.result); }, [api, serverId], {on: TUNER_MOVES});
  const view = read.data;
  const time = (iso: string) => new Date(iso).toLocaleString(undefined, {weekday: 'short', hour: 'numeric', minute: '2-digit'});
  return (
    <>
      {read.error ? <Notice tone={view ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {view ? (
        <RowGroup title={t('web.dvrSettings.tuners')} footer={t('web.dvrSettings.tunersLede', {hours: view.upcomingWindowHours})}>
          {view.sources.map(src => <ListRow key={src.sourceId} icon="live" title={src.sourceName} subtitleLines={6} meta={src.conflicts ? t('server.live.clashes', {count: src.conflicts}) : t('server.live.inUse', {used: src.inUse, total: src.tunerCount})}
            subtitle={src.active.length || src.upcoming.length ? [...src.active, ...src.upcoming.slice(0, 6)].map(a => tunerUseLine(t, a, time)).join('\n') : t('web.dvrSettings.nothingScheduled')} />)}
          {!view.sources.length ? <ListRow title={t('web.dvrSettings.noTuners')} /> : null}
        </RowGroup>
      ) : null}
    </>
  );
}

type Keep = {mode: 'keep-all' | 'keep-count' | 'keep-days'; keepCount: number; keepDays: number; keepUntilWatched: boolean};
type Group = {owner: RecordingOwner; anchor?: RecordingAnchor; status?: string; id: string; kind: 'series' | 'keyword'; name: string; match: string; sourceId: string; enabled: boolean; revision: number; options: {prePaddingSeconds: number | null; postPaddingSeconds: number | null; keepPolicy: Keep | null; newEpisodesOnly: boolean; priority: number; folderTemplate: string}};

/** Recording › who may record, and the standing rules. A rule is made from the guide; here it is paused, resumed or removed. */
export function RecordingRulesPanel() {
  const admin = useEnvelope();
  const {api} = useSession();
  const t = useI18n().t;
  const sources = useRead<SourceList>(() => api.request<SourceList>('/v1/admin/live-sources'), [api]);
  const policy = useRead(async () => {
    const grants = parseRecordingGrants(await admin.get<unknown>('/v1/admin/dvr/recording-permissions'));
    const owners: RecordingOwnerChoice[] = [];
    const seen = new Set<string>();
    let cursor = '';
    do {
      const page = parseRecordingOwners(await admin.get<unknown>('/v1/admin/dvr/recording-owners?limit=200' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : '')));
      owners.push(...page.items);
      cursor = page.nextCursor;
      if (cursor && seen.has(cursor)) break;
      seen.add(cursor);
    } while (cursor);
    return {owners, grants};
  }, [admin]);
  const read = useRead(() => admin.get<{items: Group[]}>('/v1/admin/dvr/recording-groups?limit=100'), [admin], {on: RULE_MOVES});
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [menu, setMenu] = useState<Group>();
  const [remove, setRemove] = useState<Group>();
  const grants = policy.data?.grants ?? [];
  const groups = read.data?.items ?? [];
  const legacy = (g: Group) => g.status === 'needs-owner-and-guide-selection' || !g.owner?.accountId || !g.owner?.profileId || g.kind !== 'series';
  const toggle = (g: Group) => void action.run(async () => {
    const next = {...g, enabled: !g.enabled};
    const key = JSON.stringify({id: g.id, revision: g.revision, enabled: next.enabled});
    await admin.send(`/v1/admin/dvr/recording-groups/${encodeURIComponent(g.id)}`, 'PUT', recordingRulePayload(next, grants, opIds.forPayload(key)));
    opIds.release(); read.reload();
  });
  return (
    <>
      {policy.error ? <Notice tone="error" message={policy.error} action={t('action.tryAgain')} onAction={policy.reload} /> : null}
      {policy.data ? <RecordingPermissions owners={policy.data.owners} grants={grants} onSaved={policy.reload} /> : null}
      {read.error ? <Notice tone={read.data ? 'warning' : 'error'} message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      <RowGroup title={t('web.recordingRules.title')} footer={t('server.live.rulesFromGuide')}>
        {read.data && !groups.length ? <ListRow title={t('web.recordingRules.noRules')} /> : null}
        {groups.map(g => <ListRow key={g.id} icon="dvr" title={g.name} meta={legacy(g) ? t('web.recordingRules.chooseOwner') : g.enabled ? undefined : t('web.recordingRules.pausedRule')} accessory="menu" onPress={() => setMenu(g)}
          subtitle={[g.kind === 'series' ? t('web.recordingRules.seriesKind') : t('web.recordingRules.matchTitles', {match: g.match}), g.options.newEpisodesOnly ? t('web.recordingRules.newOnly') : '', g.sourceId ? sources.data?.sources.find(s => s.id === g.sourceId)?.name ?? '' : t('web.recordingRules.anySource')].filter(Boolean).join(' · ')} />)}
      </RowGroup>
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.name}
        items={menu ? [{id: 'toggle', label: menu.enabled ? t('web.recordingRules.pauseRule') : t('web.recordingRules.resumeRule'), icon: menu.enabled ? 'pause' : 'play', disabled: legacy(menu) || !recordingAllowed(menu.owner, grants)}, {id: 'remove', label: t('web.recordingRules.remove'), icon: 'trash', destructive: true}] : []}
        onSelect={id => { const g = menu; if (!g) return; if (id === 'toggle') toggle(g); else setRemove(g); }} />
      <ConfirmSheet open={!!remove} onDismiss={() => setRemove(undefined)} title={t('web.recordingRules.removeTitle', {name: remove?.name ?? ''})} consequence={t('web.recordingRules.removeBody')} confirmLabel={t('web.recordingRules.remove')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const g = remove; if (!g) return; await admin.send(`/v1/admin/dvr/recording-groups/${encodeURIComponent(g.id)}?expectedRevision=${g.revision}&operationId=${opIds.forPayload(JSON.stringify({id: g.id, revision: g.revision}))}`, 'DELETE'); opIds.release(); setRemove(undefined); read.reload(); }} />
    </>
  );
}

/** Who may record: a profile is chosen and allowed. Server administration alone grants no recording access. Saved with the page. */
function RecordingPermissions({owners, grants, onSaved}: {owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]; onSaved: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const [selected, setSelected] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [inherit, setInherit] = useState(false);
  const choices = [...owners];
  for (const grant of grants) if (!choices.some(c => recordingOwnerKey(c.owner) === recordingOwnerKey(grant.owner))) choices.push({owner: grant.owner, accountName: t('server.live.accountGone'), profileName: grant.owner.profileId});
  const choice = choices.find(c => recordingOwnerKey(c.owner) === selected);
  const existing = grants.find(g => recordingOwnerKey(g.owner) === selected);
  const member = owners.some(c => recordingOwnerKey(c.owner) === selected);
  const reset = () => { setEnabled(existing?.enabled ?? false); setInherit(existing?.inheritProfiles ?? false); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [selected, existing?.revision]);
  const dirty = !!choice && (enabled !== (existing?.enabled ?? false) || inherit !== (existing?.inheritProfiles ?? false)) && !(enabled && !member);
  const inline = useInlineForm('recording-permission', {dirty, discard: reset, save: async () => { if (!choice) return; await api.request('/v1/admin/dvr/recording-permissions', 'PUT', {owner: choice.owner, enabled, inheritProfiles: inherit, revision: existing?.revision ?? 0}); onSaved(); }});
  return (
    <>
      {inline.error ? <Notice tone="error" message={problem(inline.error, 'action')} /> : null}
      <RowGroup title={t('web.dvrSettings.whoCanRecord')} footer={t('web.dvrSettings.whoCanRecordLede')}>
        <PickRow title={t('web.shell.profile')} value={selected} options={[{id: '', label: t('web.dvrSettings.chooseProfile')}, ...choices.map(c => ({id: recordingOwnerKey(c.owner), label: `${recordingOwnerLabel(c)}${grants.some(g => g.enabled && recordingOwnerKey(g.owner) === recordingOwnerKey(c.owner)) ? ' ✓' : ''}`}))]} onChange={setSelected} />
        {choice ? <ToggleRow title={t('web.dvrSettings.allowRecording')} subtitle={!member ? t('web.dvrSettings.goneHelp') : undefined} value={enabled} disabled={!member && !enabled} onChange={setEnabled} /> : null}
        {choice ? <ToggleRow title={t('web.dvrSettings.inheritRow')} subtitle={t('web.dvrSettings.inheritHelp')} value={inherit} disabled={!enabled || !member} onChange={setInherit} /> : null}
      </RowGroup>
    </>
  );
}

/** Recording › space: what recordings use, and the limits that keep the disk from filling. Saved with the page. */
export function RecordingStoragePanel() {
  const {api} = useSession();
  const t = useI18n().t;
  const read = useRead<{result?: RecordingStorage} & Partial<RecordingStorage>>(() => api.request('/v1/dvr/storage'), [api], {on: RECORDING_SPACE_MOVES});
  const [opIds] = useState(() => createOperationIds(operationId));
  const data = (read.data?.result ?? read.data) as RecordingStorage | undefined;
  const [draft, setDraft] = useState<RecordingStorage['policy']>();
  useEffect(() => { if (data?.policy) setDraft(data.policy); }, [data?.policy]);
  const inline = useInlineForm('recording-storage', {
    dirty: !!data?.policy && !!draft && JSON.stringify(draft) !== JSON.stringify(data.policy),
    discard: () => setDraft(data?.policy),
    save: async () => { if (!data || !draft) return; await api.request('/v1/dvr/storage', 'PUT', {requestId: opIds.forPayload(JSON.stringify({revision: data.policy.revision, policy: draft})), expectedRevision: data.policy.revision, policy: draft}); opIds.release(); read.reload(); },
  });
  if (read.error && !data) return <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} />;
  if (!data?.measurement || !draft) return null;
  const gb = (b: number) => Math.round(b / 1e9);
  const none = t('settings.server.unlimited');
  return (
    <>
      {!data.measurement.writeHealthy ? <Notice tone="warning" message={t('web.liveTv.notWritable')} /> : null}
      {inline.error ? <Notice tone="error" message={problem(inline.error, 'action')} /> : null}
      <RowGroup title={t('channels.recordings')} footer={data.forecastDescription || t('web.liveTv.recordingsLede')}>
        <ListRow title={t('server.live.usedByRecordings')} meta={formatBytes(data.measurement.usedBytes)} />
        <ListRow title={t('server.live.freeOnVolume')} meta={formatBytes(data.measurement.freeBytes)} />
        <TypedRow numeric title={t('web.liveTv.keepRecordings')} help={t('web.liveTv.keepRecordingsHelp')} value={String(draft.retentionDays)} shown={draft.retentionDays ? `${draft.retentionDays} ${t('settings.unit.days')}` : none} onDone={text => setDraft({...draft, retentionDays: Math.min(3650, Math.max(0, Number(text) || 0))})} />
        <TypedRow numeric title={t('web.liveTv.episodesPerSeries')} help={t('web.liveTv.episodesPerSeriesHelp')} value={String(draft.episodeLimit)} shown={draft.episodeLimit ? String(draft.episodeLimit) : none} onDone={text => setDraft({...draft, episodeLimit: Math.max(0, Number(text) || 0)})} />
        <TypedRow numeric title={t('web.liveTv.leaveFree')} help={t('web.liveTv.leaveFreeHelp')} value={String(gb(draft.floorBytes))} shown={`${gb(draft.floorBytes)} ${t('web.liveTv.gbUnit')}`} onDone={text => setDraft({...draft, floorBytes: Math.max(0, Number(text) || 0) * 1e9})} />
        <TypedRow numeric title={t('web.liveTv.capUpTo')} help={t('web.liveTv.capUpToHelp')} value={String(gb(draft.capBytes))} shown={draft.capBytes ? `${gb(draft.capBytes)} ${t('web.liveTv.gbUnit')}` : none} onDone={text => setDraft({...draft, capBytes: Math.max(0, Number(text) || 0) * 1e9})} />
      </RowGroup>
    </>
  );
}

type Health = {healthy: boolean; state: string; message: string; generatedThrough: string; scheduledEntries: number; candidates: number; unresolved: number; pendingGeneration: boolean};
const localZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** Live TV & Channels › Library Channels: always-on channels made from the owner's media, started from a template. */
export function LibraryChannelsPanel() {
  const {api} = useSession();
  const serverId = useServerId();
  const t = useI18n().t;
  const read = useRead<LibraryChannel[]>(() => readLibraryChannels(api, serverId), [api, serverId], {on: CHANNEL_MOVES});
  const templates = useRead<LibraryChannelTemplate[]>(() => readLibraryTemplates(api, serverId), [api, serverId]);
  const action = useAction();
  const [opIds] = useState(() => createOperationIds(operationId));
  const [menu, setMenu] = useState<{channel: LibraryChannel; index: number}>();
  const [creating, setCreating] = useState(false);
  const [template, setTemplate] = useState<LibraryChannelTemplate>();
  const [remove, setRemove] = useState<LibraryChannel>();
  const [healthFor, setHealthFor] = useState<LibraryChannel>();
  const channels = [...(read.data ?? [])].sort((a, b) => a.config.position - b.config.position);
  const mutate = (fn: () => Promise<unknown>) => void action.run(fn).then(ok => { if (ok) read.reload(); });
  const move = (index: number, dir: -1 | 1) => {
    const next = [...channels];
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    const payload = {channels: next.map(c => ({id: c.config.id, expectedRevision: c.revision}))};
    mutate(async () => { await api.request('/v1/admin/library-channels/reorder', 'POST', {requestId: opIds.forPayload(JSON.stringify(payload)), ...payload}); opIds.release(); });
  };
  const select = (c: LibraryChannel, index: number, id: string) => {
    if (id === 'toggle') mutate(async () => { const next = {...c.config, enabled: !c.config.enabled}; try { await saveLibraryChannel(api, serverId, next, c.revision, opIds.forPayload(JSON.stringify({config: next, revision: c.revision}))); } finally { opIds.release(); } });
    else if (id === 'regen') mutate(async () => { try { await api.request(`/v1/admin/library-channels/${encodeURIComponent(c.config.id)}/regenerate`, 'POST', regenerationBody(c, opIds.forPayload(JSON.stringify({id: c.config.id, revision: c.revision, boundary: c.replacementBoundary})))); } finally { opIds.release(); } });
    else if (id === 'health') setHealthFor(c);
    else if (id === 'up') move(index, -1);
    else if (id === 'down') move(index, 1);
    else setRemove(c);
  };
  const facts = (c: LibraryChannel) => [c.config.description, t('server.channels.titles', {count: c.candidateCount}), c.generatedThrough ? t('server.channels.through', {when: new Date(c.generatedThrough).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}) : '', c.healthCode ? sentence(c.healthCode) : ''].filter(Boolean).join(' · ');
  return (
    <>
      {read.error && !read.data ? <Notice tone="error" message={read.error} action={t('action.tryAgain')} onAction={read.reload} /> : null}
      {action.error ? <Notice tone="error" message={action.error} /> : null}
      <RowGroup title={t('settings.server.libraryChannels')} footer={t('web.console.nav.channelsLede')}>
        {read.data && !channels.length ? <ListRow title={t('builder.empty.title')} subtitle={t('builder.empty.body')} subtitleLines={4} /> : null}
        {channels.map((c, i) => <ListRow key={c.config.id} icon="live" title={c.config.name} meta={!c.config.enabled ? t('web.libraryChannels.offState') : sentence(c.state)} subtitle={facts(c)} accessory="menu" onPress={() => setMenu({channel: c, index: i})} />)}
        {templates.data?.length ? <ListRow tone="action" icon="plus" title={t('builder.newTitle')} onPress={() => setCreating(true)} /> : null}
      </RowGroup>
      <Menu open={creating} onClose={() => setCreating(false)} title={t('builder.newTitle')} items={(templates.data ?? []).map<MenuItem>(x => ({id: x.id, label: x.name, detail: x.applicable ? x.description : sentence(x.reason || 'not enough media'), disabled: !x.applicable}))} onSelect={id => setTemplate(templates.data?.find(x => x.id === id))} />
      <Menu open={!!menu} onClose={() => setMenu(undefined)} title={menu?.channel.config.name}
        items={menu ? [{id: 'toggle', label: menu.channel.config.enabled ? t('web.libraryChannels.turnOff') : t('web.libraryChannels.turnOn'), icon: menu.channel.config.enabled ? 'pause' : 'play'}, {id: 'regen', label: t('web.libraryChannels.regenSchedule'), icon: 'refresh', disabled: !menu.channel.replacementBoundary}, {id: 'health', label: t('web.libraryChannels.checkHealth'), icon: 'info'}, {id: 'up', label: t('web.profile.moveUp'), icon: 'chevronUp', disabled: menu.index === 0}, {id: 'down', label: t('web.profile.moveDown'), icon: 'chevronDown', disabled: menu.index === channels.length - 1}, {id: 'remove', label: t('web.libraryChannels.delete'), icon: 'trash', destructive: true}] : []}
        onSelect={id => { if (menu) select(menu.channel, menu.index, id); }} />
      {/* A template is created as it stands; its rules are edited in the builder on the web. */}
      <ConfirmSheet open={!!template} onDismiss={() => setTemplate(undefined)} tone="default" title={t('server.channels.createTitle', {name: template?.name ?? ''})} consequence={template?.description} confirmLabel={t('builder.empty.create')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const x = template; if (!x) return; const config = {...JSON.parse(JSON.stringify(x.config)), id: 'lc-' + operationId().slice(0, 24), timezone: localZone(), templateId: x.id}; try { await saveLibraryChannel(api, serverId, config, 0, opIds.forPayload(JSON.stringify({template: x.id}))); } finally { opIds.release(); } setTemplate(undefined); read.reload(); }} />
      <ConfirmSheet open={!!remove} onDismiss={() => setRemove(undefined)} title={t('web.libraryChannels.deleteTitle', {name: remove?.config.name ?? ''})} consequence={t('web.libraryChannels.deleteBody')} confirmLabel={t('web.libraryChannels.delete')} describeError={e => problem(e, 'action')}
        onConfirm={async () => { const c = remove; if (!c) return; const payload = {expectedRevision: c.revision}; await api.request(`/v1/admin/library-channels/${encodeURIComponent(c.config.id)}/delete`, 'POST', {requestId: opIds.forPayload(JSON.stringify({id: c.config.id, ...payload})), ...payload}); opIds.release(); setRemove(undefined); read.reload(); }} />
      <ChannelHealthSheet channel={healthFor} onClose={() => setHealthFor(undefined)} />
    </>
  );
}

/** Whether a channel is actually on the air, and in a sentence what is wrong if it is not. */
function ChannelHealthSheet({channel, onClose}: {channel?: LibraryChannel; onClose: () => void}) {
  const {api} = useSession();
  const t = useI18n().t;
  const {space} = useTheme();
  const id = channel?.config.id;
  const read = useRead(async () => { if (!id) return undefined; const raw = await api.request<{result?: Health} & Health>(`/v1/admin/library-channels/${encodeURIComponent(id)}/health`); return (raw.result ?? raw) as Health; }, [api, id]);
  const h = read.data;
  return (
    <Sheet open={!!channel} onClose={onClose} kind="form" cancelLabel={t('action.done')} title={channel?.config.name} subtitle={t('web.libraryChannels.healthLede')} primary={{label: t('device.approval.checkAgain'), loading: read.loading, onPress: read.reload}}>
      <View style={{gap: space.md}}>
        {read.error ? <Notice tone="error" message={read.error} /> : null}
        {h ? <Notice tone={h.healthy ? 'success' : 'warning'} message={h.message || (h.healthy ? t('web.libraryChannels.onAir') : t('web.libraryChannels.offAir'))} /> : null}
        {h ? (
          <RowGroup>
            <ListRow title={t('web.libraryChannels.healthSchedule')} meta={h.generatedThrough ? new Date(h.generatedThrough).toLocaleString(undefined, {weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : t('web.libraryChannels.healthNotGenerated')} />
            <ListRow title={t('web.libraryChannels.healthPrograms')} meta={h.scheduledEntries.toLocaleString()} />
            <ListRow title={t('web.libraryChannels.healthCandidates')} meta={h.candidates.toLocaleString()} />
            {h.unresolved ? <ListRow title={t('web.libraryChannels.healthUnresolved')} meta={h.unresolved.toLocaleString()} /> : null}
            <ListRow title={t('web.libraryChannels.healthNewSchedule')} meta={h.pendingGeneration ? t('web.libraryChannels.healthBeingMade') : t('web.libraryChannels.healthUpToDate')} />
          </RowGroup>
        ) : null}
      </View>
    </Sheet>
  );
}
