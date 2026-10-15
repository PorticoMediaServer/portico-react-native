import React, {useEffect, useMemo, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {MetadataRepairService, type RepairData, type RepairFieldSpec, type RepairRelationship, type RepairTarget, type RepairView} from '../../../../packages/client-core/src/metadata-repair';
import {bulkTargetLimit, type BulkFieldEdit} from '../../../../packages/client-core/src/metadata-bulk';
import {groupMetadataTargets, runBulkRequests} from '../../../../packages/client-core/src/bulk-jobs';
import {useArtwork, viewerScope} from '../app/content';
import {useMetadataEditor} from '../app/metadata-editor';
import {useSession} from '../app/session';
import {useI18n, type I18n, type MessageId} from '../app/i18n';
import {Artwork, Button, Field, Menu, Notice, Sheet, Tabs, Text, useTheme} from '../ui';
import {orderTakesOffset, readTmdbOrder, tmdbAbsoluteOrder} from '../../../../packages/client-core/src/screen-metadata';
import {say} from '../app/errors';

/**
 * The metadata editor on handheld and iPad: the same revision-fenced commands
 * as the web editor over the owner "repair" projection. Editing a field locks
 * it unless the viewer unlocked it on purpose in this session; the lock sits
 * inside the field. tvOS never opens it (no keyboard worth the trouble).
 */
type Tab = 'general' | 'artwork' | 'genres' | 'credits' | 'matching' | 'history';
const tabs: readonly {id: Tab; label: MessageId}[] = [{id: 'general', label: 'web.metadata.tabGeneral'}, {id: 'artwork', label: 'web.metadata.tabArtwork'}, {id: 'genres', label: 'web.metadata.genres'}, {id: 'credits', label: 'web.metadata.tabPeople'}, {id: 'matching', label: 'web.librarySettings.matching'}, {id: 'history', label: 'web.metadata.tabHistory'}];
type Command = Parameters<MetadataRepairService['command']>[0];
type FieldEdit = {value?: string; values?: readonly string[]; locked?: boolean; useAutomatic?: boolean};
const splitList = (v: string) => v.split(',').map(x => x.trim()).filter(Boolean);

/** CD-46: the bounds the save path enforces from the published repair schema. Integer and number
 * fields take canonical non-negative decimals only (no leading zeros, signs, fractions or
 * exponents); dates must be real YYYY-MM-DD calendar dates; text honours maxLength in code
 * points. An empty string clears a field, except the required title. */
export type RepairFieldBounds = Pick<RepairFieldSpec, 'field' | 'type' | 'maxLength' | 'min' | 'max'>;
export type RepairFieldProblem =
  | {code: 'title-required'}
  | {code: 'not-canonical'}
  | {code: 'too-small'; min: number}
  | {code: 'too-large'; max: number}
  | {code: 'too-long'; max: number}
  | {code: 'bad-date'};
export function repairFieldProblem(spec: RepairFieldBounds, raw: string, targetKind: RepairTarget['kind']): RepairFieldProblem | undefined {
  if (raw === '') return spec.field === 'title' && targetKind !== 'season' ? {code: 'title-required'} : undefined;
  const value = raw.trim();
  if (value === '' && spec.field === 'title' && targetKind !== 'season') return {code: 'title-required'};
  switch (spec.type) {
    case 'integer':
    case 'number': {
      if (!/^(0|[1-9][0-9]*)$/.test(value)) return {code: 'not-canonical'};
      const n = Number(value);
      if (!Number.isSafeInteger(n)) return spec.max === undefined ? undefined : {code: 'too-large', max: spec.max};
      if (spec.min !== undefined && n < spec.min) return {code: 'too-small', min: spec.min};
      if (spec.max !== undefined && n > spec.max) return {code: 'too-large', max: spec.max};
      return undefined;
    }
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      if (!m) return {code: 'bad-date'};
      const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
      if (month < 1 || month > 12) return {code: 'bad-date'};
      const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const last = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
      if (day < 1 || day > last) return {code: 'bad-date'};
      return undefined;
    }
    default: {
      if (spec.maxLength !== undefined && Array.from(raw).length > spec.maxLength) return {code: 'too-long', max: spec.maxLength};
      return undefined;
    }
  }
}
/** The catalogue words for a schema problem on one field. */
export function repairFieldMessage(t: I18n['t'], spec: {label: string}, problem: RepairFieldProblem): string {
  switch (problem.code) {
    case 'title-required': return t('metadataEditor.titleRequired');
    case 'not-canonical': return t('metadataEditor.wholeNumber', {label: spec.label});
    case 'too-small': return t('metadataEditor.tooSmall', {label: spec.label, min: problem.min});
    case 'too-large': return t('metadataEditor.tooLarge', {label: spec.label, max: problem.max});
    case 'too-long': return t('metadataEditor.tooLong', {label: spec.label, max: problem.max});
    case 'bad-date': return t('metadataEditor.badDate', {label: spec.label});
  }
}

function useRepair(target: RepairTarget) {
  const {api, session} = useSession();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const service = useMemo(() => new MetadataRepairService({api, scope}), [api, scope]);
  const [snapshot, setSnapshot] = useState<RepairView>(service.getSnapshot());
  useEffect(() => {
    setSnapshot(service.getSnapshot());
    const off = service.subscribe(() => setSnapshot(service.getSnapshot()));
    void service.load(target);
    return () => { off(); service.dispose(); };
  }, [service, target]);
  return {service, snapshot};
}

export function MetadataEditorSheet() {
  const editor = useMetadataEditor();
  const {isTV} = useTheme();
  const i18n = useI18n();
  const request = editor?.request;
  if (isTV || !request) return null;
  const single = request.targets.length === 1;
  return (
    <Sheet open onClose={editor!.close} placement="center" width={720} title={single ? (request.titles[0] ? i18n.t('web.metadata.editTitle', {title: request.titles[0]}) : i18n.t('web.metadata.editFallbackTitle')) : i18n.t('web.metadata.editCount', {count: request.targets.length})} subtitle={single ? i18n.t('web.metadata.kindOnServer', {kind: request.targets[0].kind}) : i18n.t('web.metadata.bulkDescription')} scroll={false}>
      {single ? <SingleEditor key={request.targets[0].kind + request.targets[0].id} target={request.targets[0]} onSaved={request.onSaved} onClose={editor!.close} /> : <BulkEditor key={request.targets.map(t => t.id).join(',')} targets={request.targets} onSaved={request.onSaved} onClose={editor!.close} />}
    </Sheet>
  );
}

function SingleEditor({target, onSaved, onClose}: {target: RepairTarget; onSaved?: () => void; onClose: () => void}) {
  const {service, snapshot} = useRepair(target);
  const i18n = useI18n();
  const {space, window} = useTheme();
  const [tab, setTab] = useState<Tab>('general');
  const data = snapshot.data;
  const busy = snapshot.phase === 'saving' || snapshot.phase === 'loading';
  const run = async (command: Command) => { const ok = await service.command(command); if (ok) onSaved?.(); return ok; };
  // M25-1a: a search queues async provider work; the POST returns while the
  // status is still transient. Reload with bounded backoff until it settles.
  const runMatching = async (command: Command) => {
    const ok = await run(command);
    if (ok && (command.action === 'search' || command.action === 'retry')) {
      for (const delay of [1000, 2000, 4000, 8000]) {
        const status = service.getSnapshot().data?.snapshot.identity?.status;
        if (!isTransientMatchingStatus(status)) break;
        await new Promise(r => setTimeout(r, delay));
        try { await service.load(target); } catch { break; }
      }
    }
    return ok;
  };
  return (
    <View style={{maxHeight: window.height * 0.74}}>
      <Tabs items={tabs.map(tb => ({id: tb.id, label: i18n.t(tb.label)}))} selected={tab} onSelect={id => setTab(id as Tab)} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md}}>
        {snapshot.phase === 'denied' ? <Notice tone="error" message={snapshot.error ?? i18n.t('web.metadata.accessLost')} /> : null}
        {snapshot.phase === 'conflict' || snapshot.phase === 'uncertain' || snapshot.phase === 'error' ? <Notice tone={snapshot.phase === 'error' ? 'error' : 'warning'} message={snapshot.error ?? i18n.t('web.metadata.refreshValues')} action={i18n.t('action.refresh')} onAction={() => void service.load(target)} /> : null}
        {!data && snapshot.phase === 'loading' ? <Text variant="body" tone="secondary">{i18n.t('web.metadata.loadingApple')}</Text> : null}
        {data && tab === 'general' ? <GeneralTab data={data} busy={busy} onSave={fields => run({action: 'edit', fields})} onClose={onClose} /> : null}
        {data && tab === 'artwork' ? <ArtworkTab data={data} busy={busy} run={run} target={target} /> : null}
        {data && tab === 'genres' ? <RelationshipTab data={data} busy={busy} run={run} kind="genre" /> : null}
        {data && tab === 'credits' ? <RelationshipTab data={data} busy={busy} run={run} kind="credit" /> : null}
        {data && tab === 'matching' ? <MatchingTab data={data} busy={busy} run={runMatching} /> : null}
        {data && tab === 'history' ? <HistoryTab data={data} busy={busy} run={run} /> : null}
      </ScrollView>
    </View>
  );
}

function LockButton({locked, label, busy, onPress}: {locked: boolean; label: string; busy: boolean; onPress: () => void}) {
  const i18n = useI18n();
  return <Button variant={locked ? 'secondary' : 'ghost'} round icon={locked ? 'lock' : 'shield'} selected={locked} accessibilityLabel={i18n.t(locked ? 'web.metadata.unlockField' : 'web.metadata.lockField', {label})} disabled={busy} onPress={onPress} />;
}

function GeneralTab({data, busy, onSave, onClose}: {data: RepairData; busy: boolean; onSave: (fields: Record<string, FieldEdit>) => Promise<boolean>; onClose: () => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  const schema = data.schema;
  const [values, setValues] = useState<Record<string, string>>({});
  const [locks, setLocks] = useState<Record<string, boolean>>({});
  const [automatic, setAutomatic] = useState<Set<string>>(new Set());
  const [unlockedOnPurpose, setUnlockedOnPurpose] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  useEffect(() => { setValues({}); setLocks({}); setAutomatic(new Set()); setUnlockedOnPurpose(new Set()); setError(undefined); }, [data.revision]);
  const saved = (spec: RepairFieldSpec) => (spec.type === 'list' ? (data.snapshot.fields[spec.field]?.values ?? []).join(', ') : data.snapshot.fields[spec.field]?.value ?? '');
  const current = (spec: RepairFieldSpec) => values[spec.field] ?? saved(spec);
  const isLocked = (f: string) => locks[f] ?? data.snapshot.fields[f]?.locked ?? false;
  const edit = (f: string, v: string) => { setValues(prev => ({...prev, [f]: v})); setAutomatic(prev => { if (!prev.has(f)) return prev; const n = new Set(prev); n.delete(f); return n; }); if (!unlockedOnPurpose.has(f)) setLocks(prev => ({...prev, [f]: true})); };
  const toggleLock = (f: string) => { const next = !isLocked(f); setLocks(prev => ({...prev, [f]: next})); setUnlockedOnPurpose(prev => { const n = new Set(prev); if (next) n.delete(f); else n.add(f); return n; }); };
  const applyAuto = (f: string) => { setValues(prev => { const n = {...prev}; delete n[f]; return n; }); setLocks(prev => ({...prev, [f]: false})); setAutomatic(prev => new Set(prev).add(f)); };
  const changes: Record<string, FieldEdit> = {};
  for (const spec of schema) {
    const f = spec.field;
    if (automatic.has(f)) { changes[f] = {useAutomatic: true}; continue; }
    const e: FieldEdit = {};
    if (values[f] !== undefined && values[f] !== saved(spec)) { if (spec.type === 'list') e.values = splitList(values[f]); else e.value = values[f]; }
    if (locks[f] !== undefined && locks[f] !== data.snapshot.fields[f]?.locked) e.locked = locks[f];
    if (e.value !== undefined || e.values !== undefined || e.locked !== undefined) changes[f] = e;
  }
  const pending = Object.keys(changes).length;
  const save = async () => {
    for (const spec of schema) {
      const v = changes[spec.field]?.value;
      if (v === undefined) continue;
      const problem = repairFieldProblem(spec, v, data.target.kind);
      if (problem) { setError(repairFieldMessage(i18n.t, spec, problem)); return; }
    }
    setError(undefined);
    if (await onSave(changes)) onClose();
  };
  return (
    <>
      {error ? <Notice tone="error" message={error} /> : null}
      {schema.map(spec => {
        const f = spec.field;
        const field = data.snapshot.fields[f];
        const value = current(spec);
        const auto = spec.type === 'list' ? '' : field?.automaticValue ?? '';
        const differs = !!field && auto !== value && spec.type !== 'list';
        const source = field?.source && field.source !== 'automatic' && field.source !== 'manual' ? field.source.replace('provider:', '') : undefined;
        return (
          <View key={f} style={{gap: 4}}>
            <Field label={spec.label} value={value} onChangeText={v => edit(f, v)} multiline={spec.type === 'multiline'} numberOfLines={spec.type === 'multiline' ? 4 : 1} keyboardType={spec.type === 'integer' || spec.type === 'number' ? 'numeric' : 'default'} placeholder={spec.type === 'list' ? i18n.t('web.metadata.commaSeparated') : spec.type === 'date' ? 'YYYY-MM-DD' : undefined} editable={!busy} autoCapitalize={spec.type === 'text' || spec.type === 'multiline' ? 'sentences' : 'none'} trailing={<LockButton locked={isLocked(f)} label={spec.label} busy={busy} onPress={() => toggleLock(f)} />} /> {/* lint-strings-allow: YYYY-MM-DD is a date format example, not copy */}
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 18}}>
              {automatic.has(f) ? <Text variant="caption" tone="tertiary">{i18n.t('web.metadata.resetAutomatic')}</Text> : differs ? <><Text variant="caption" tone="tertiary" lines={1} style={{flex: 1}}>{i18n.t(source ? 'web.metadata.automaticValueFrom' : 'web.metadata.automaticValue', {source, value: auto || '—'})}</Text><Button size="sm" variant="ghost" label={i18n.t('web.metadata.useIt')} disabled={busy} onPress={() => applyAuto(f)} /></> : source ? <Text variant="caption" tone="tertiary">{i18n.t('web.metadata.fromSource', {source})}</Text> : field?.source === 'manual' ? <Text variant="caption" tone="tertiary">{i18n.t('web.metadata.editedHere')}</Text> : null}
            </View>
          </View>
        );
      })}
      <Footer copy={pending ? i18n.t('web.metadata.pendingCount', {count: pending}) : i18n.t('web.metadata.noChanges')} busy={busy} primary={pending ? {label: i18n.t('web.metadata.saveChanges'), onPress: () => void save()} : undefined} onClose={onClose} />
    </>
  );
}

function Footer({copy, busy, primary, onClose}: {copy: string; busy: boolean; primary?: {label: string; onPress: () => void}; onClose: () => void}) {
  const {space} = useTheme();
  const i18n = useI18n();
  return (
    <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingTop: space.sm}}>
      <Text variant="caption" tone="tertiary" style={{flex: 1}}>{copy}</Text>
      <Button variant="ghost" label={primary ? i18n.t('action.cancel') : i18n.t('action.close')} onPress={onClose} />
      {primary ? <Button variant="primary" label={primary.label} loading={busy} disabled={busy} onPress={primary.onPress} /> : null}
    </View>
  );
}

const roleShape = (role: string): 'poster' | 'landscape' | 'square' | 'circle' => (role === 'poster' ? 'poster' : role === 'cover' || role === 'square' ? 'square' : role === 'portrait' ? 'circle' : 'landscape');

function ArtworkTab({data, busy, run}: {data: RepairData; busy: boolean; run: (c: Command) => Promise<boolean>; target: RepairTarget}) {
  const {space, window} = useTheme();
  const artwork = useArtwork();
  const i18n = useI18n();
  const roles = useMemo(() => Array.from(new Set([...data.artworkRoles, ...data.snapshot.artwork.map(a => a.role), ...data.artwork.candidates.map(c => c.role)])), [data]);
  const [role, setRole] = useState(roles[0] ?? 'poster');
  useEffect(() => { if (!roles.includes(role) && roles[0]) setRole(roles[0]); }, [roles, role]);
  const chosen = data.snapshot.artwork.find(a => a.role === role);
  const inUse = (id: string) => chosen?.candidateId === id;
  const candidates = data.artwork.candidates.filter(c => c.role === role).sort((a, b) => Number(inUse(b.id)) - Number(inUse(a.id)) || b.rank - a.rank);
  const cardWidth = Math.max(110, Math.floor((Math.min(window.width, 720) - space.lg * 2 - space.sm * 2) / 3));
  return (
    <>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.xs}}>{roles.map(r => <Button key={r} size="sm" variant="secondary" selected={r === role} label={i18n.t('web.metadata.artRole', {role: r})} onPress={() => setRole(r)} />)}</View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, alignItems: 'center'}}>
        <Text variant="caption" tone="tertiary" style={{flex: 1}}>{[i18n.t('web.metadata.candidateCount', {count: candidates.length}), chosen ? i18n.t(chosen.locked ? 'web.metadata.locked' : 'web.metadata.unlocked') : ''].filter(Boolean).join(' · ')}</Text>
        {chosen ? <Button size="sm" variant="ghost" icon={chosen.locked ? 'lock' : 'shield'} label={chosen.locked ? i18n.t('web.metadata.unlock') : i18n.t('web.metadata.lock')} disabled={busy} onPress={() => void run({action: 'artwork_lock', role, subject: chosen.subject, locked: !chosen.locked, confirm: true})} /> : null}
        <Button size="sm" variant="ghost" icon="search" label={i18n.t('web.metadata.findMore')} disabled={busy} onPress={() => void run({action: 'discover_artwork'})} />
      </View>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.sm}}>
        {candidates.map(c => (
          <View key={c.id} style={{width: cardWidth, gap: 6}}>
            {c.previewUrl || (inUse(c.id) && chosen?.url) ? <Artwork source={artwork(c.previewUrl ?? chosen!.url)} shape={roleShape(c.role)} width={cardWidth} title={c.provider} /> : <View style={{width: cardWidth, aspectRatio: roleShape(c.role) === 'poster' ? 2 / 3 : roleShape(c.role) === 'square' ? 1 : 16 / 9, alignItems: 'center', justifyContent: 'center'}}><Button size="sm" variant="secondary" label={i18n.t('builder.preview')} disabled={busy} onPress={() => void run({action: 'preview_artwork', candidateId: c.id})} /></View>}
            <Text variant="caption" tone="tertiary" lines={1}>{[c.provider, c.locale || '', c.votes != null ? i18n.t('metadataEditor.votes', {count: c.votes}) : ''].filter(Boolean).join(' · ')}</Text>
            {inUse(c.id) ? <Text variant="caption" tone="accent">{i18n.t('web.metadata.inUse')}</Text> : <Button size="sm" variant="secondary" label={i18n.t('web.liveSource.useThis')} disabled={busy} onPress={() => void run({action: 'select_artwork', candidateId: c.id, confirm: true})} />}
          </View>
        ))}
      </View>
    </>
  );
}

function RelationshipTab({data, busy, run, kind}: {data: RepairData; busy: boolean; run: (c: Command) => Promise<boolean>; kind: 'genre' | 'credit'}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const saved = useMemo(() => data.snapshot.relationships.filter(r => r.kind === kind).sort((a, b) => a.ordinal - b.ordinal), [data, kind]);
  const [rows, setRows] = useState<RepairRelationship[]>(saved);
  const [draft, setDraft] = useState('');
  useEffect(() => setRows(saved), [saved]);
  const locked = data.snapshot.relationshipLocks[kind] ?? false;
  const dirty = JSON.stringify(rows.map(r => [r.label, r.role, r.department])) !== JSON.stringify(saved.map(r => [r.label, r.role, r.department]));
  if (data.target.kind !== 'item') return <Text variant="body" tone="secondary">{i18n.t(kind === 'genre' ? 'web.metadata.genresOnlyItems' : 'web.metadata.creditsOnlyItems')}</Text>;
  const add = () => { const name = draft.trim(); if (!name) return; setRows(prev => [...prev, kind === 'genre' ? {kind: 'genre', targetKind: 'genre', targetId: '', label: name, ordinal: prev.length, source: 'manual', locked: true} : {kind: 'credit', targetKind: 'scoped_credit', targetId: '', label: name, role: '', department: 'Acting', ordinal: prev.length, source: 'manual', locked: true}]); setDraft(''); };
  const update = (i: number, patch: Partial<RepairRelationship>) => setRows(prev => prev.map((r, n) => (n === i ? {...r, ...patch} : r)));
  return (
    <>
      <View style={{flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between'}}>
        <Text variant="heading">{kind === 'genre' ? i18n.t('web.metadata.genres') : i18n.t('web.metadata.tabPeople')}</Text>
        <Button size="sm" variant="ghost" icon={locked ? 'lock' : 'shield'} label={locked ? i18n.t('web.metadata.locked') : i18n.t('web.metadata.unlocked')} disabled={busy} onPress={() => void run({action: 'relationship_lock', role: kind, locked: !locked, confirm: true})} />
      </View>
      {rows.map((r, i) => (
        <View key={`${r.recordId ?? 'new'}:${i}`} style={{gap: space.xs}}>
          {kind === 'genre' ? (
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}><Text variant="body" style={{flex: 1}}>{r.label}</Text><Button size="sm" variant="ghost" round icon="close" accessibilityLabel={i18n.t('web.metadata.removeLabel', {label: r.label})} disabled={busy} onPress={() => setRows(prev => prev.filter((_, n) => n !== i))} /></View>
          ) : (
            <View style={{gap: space.xs}}>
              <Field label={i18n.t('profile.name')} value={r.label} onChangeText={v => update(i, {label: v})} editable={!busy} trailing={<Button size="sm" variant="ghost" round icon="trash" accessibilityLabel={i18n.t('web.metadata.removeLabel', {label: r.label || 'row'})} disabled={busy} onPress={() => setRows(prev => prev.filter((_, n) => n !== i))} />} />
              <View style={{flexDirection: 'row', gap: space.sm}}><Field label={i18n.t('web.metadata.department')} value={r.department ?? ''} onChangeText={v => update(i, {department: v})} editable={!busy} style={{flex: 1}} /><Field label={r.department?.toLowerCase() === 'acting' ? i18n.t('web.metadata.characterLabel') : i18n.t('web.metadata.roleLabel')} value={r.role ?? ''} onChangeText={v => update(i, {role: v})} editable={!busy} style={{flex: 1}} /></View>
            </View>
          )}
        </View>
      ))}
      <Field label={kind === 'genre' ? i18n.t('web.metadata.addGenre') : i18n.t('web.metadata.addPerson')} value={draft} onChangeText={setDraft} onSubmitEditing={add} returnKeyType="done" editable={!busy} trailing={<Button size="sm" variant="secondary" icon="plus" accessibilityLabel={i18n.t('player.opt.add')} disabled={busy || !draft.trim()} onPress={add} />} />
      <Footer copy={i18n.t(kind === 'genre' ? (dirty ? 'web.metadata.genresChanged' : locked ? 'web.metadata.genresLocked' : 'web.metadata.genresUnlocked') : dirty ? 'web.metadata.creditsChanged' : locked ? 'web.metadata.lockedTip' : 'web.metadata.unlockedTip')} busy={busy} primary={dirty ? {label: i18n.t(kind === 'genre' ? 'web.metadata.saveGenres' : 'web.metadata.saveCredits'), onPress: () => void run({action: 'edit_relationships', role: kind, relationships: rows.filter(r => r.label.trim()).map((r, n) => ({...r, label: r.label.trim(), ordinal: n})), confirm: true})} : undefined} onClose={() => setRows(saved)} />
    </>
  );
}

/** CD-48: only the screen engine takes an owner-supplied query/year. MusicBrainz
 * search/retry omits both and uses scanned metadata; artists/books without a
 * remote matcher offer no working search. */
export function matchingSearchCommand(identity: RepairData['snapshot']['identity'], query: string): {action: 'search'; query?: string} {
  const trimmed = query.trim() || undefined;
  if (identity?.engine === 'screen') return trimmed ? {action: 'search', query: trimmed} : {action: 'search'};
  return {action: 'search'};
}

/** M25-1b: every identity status maps to catalogue copy, never a raw internal value. */
export function matchingStatusKey(status: string | undefined): MessageId {
  switch (status) {
    case 'searching': return 'web.metadata.matchStatus.searching';
    case 'pending': return 'web.metadata.matchStatus.pending';
    case 'pending_search': return 'web.metadata.matchStatus.pendingSearch';
    case 'pending_episodes': return 'web.metadata.matchStatus.pendingEpisodes';
    case 'pending_children': return 'web.metadata.matchStatus.pendingChildren';
    case 'pending_apply': return 'web.metadata.matchStatus.pendingApply';
    case 'matched': return 'web.metadata.matchStatus.matched';
    case 'matched_work': return 'web.metadata.matchStatus.matchedWork';
    case 'accepted': return 'web.metadata.matchStatus.accepted';
    case 'published': return 'web.metadata.matchStatus.published';
    case 'complete': return 'web.metadata.matchStatus.complete';
    case 'needs_selection': return 'web.metadata.matchStatus.needsSelection';
    case 'needs_order': return 'web.metadata.matchStatus.needsOrder';
    case 'needs_parent_match': return 'web.metadata.matchStatus.needsParentMatch';
    case 'needs_consent': return 'web.metadata.matchStatus.needsConsent';
    case 'needs_season_mapping': return 'web.metadata.matchStatus.needsSeasonMapping';
    case 'unmatched': return 'web.metadata.matchStatus.unmatched';
    case 'unresolved': return 'web.metadata.matchStatus.unresolved';
    case 'unavailable': return 'web.metadata.matchStatus.unavailable';
    case 'source_unavailable': return 'web.metadata.matchStatus.sourceUnavailable';
    case 'provider_disabled': return 'web.metadata.matchStatus.providerDisabled';
    case 'provider_unavailable': return 'web.metadata.matchStatus.providerUnavailable';
    case 'manual_preserved': return 'web.metadata.matchStatus.manualPreserved';
    case 'delegated_tvdb': return 'web.metadata.matchStatus.delegatedTvdb';
    case 'identity_conflict': return 'web.metadata.matchStatus.identityConflict';
    default: return 'web.metadata.matchStatus.unknown';
  }
}

/** M25-1a: transient provider-work states that settle without another owner action. */
export function isTransientMatchingStatus(status: string | undefined): boolean {
  return status === 'searching' || status === 'pending' || status === 'pending_search' || status === 'pending_episodes' || status === 'pending_children' || status === 'pending_apply';
}

function MatchingTab({data, busy, run}: {data: RepairData; busy: boolean; run: (c: Command) => Promise<boolean>}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const identity = data.snapshot.identity;
  const [query, setQuery] = useState('');
  const identityLocked = data.snapshot.relationshipLocks.identity ?? identity?.locked ?? false;
  const isScreen = identity?.engine === 'screen';
  const providerName = (p: string) => ({tmdb: 'TMDB', tvdb: 'TheTVDB', musicbrainz: 'MusicBrainz', anilist: 'AniList'} as Record<string, string>)[p] ?? p;
  // Which episode order each match would use, and the number added to each file's episode number (as on the web).
  const [orders, setOrders] = useState<Record<string, {order: string; offset: number}>>({});
  const [offsetText, setOffsetText] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<{key: string; offered: readonly {id: string; name: string}[]; chosen: string; pick: (id: string) => void}>();
  const stored = readTmdbOrder(identity?.order ?? '');
  const storedName = data.candidates.flatMap(c => c.orders ?? []).find(o => o.id === stored.base)?.name ?? '';
  const orderLine = storedName ? (stored.offset ? i18n.t('web.metadata.orderWithOffset', {order: storedName, offset: stored.offset}) : storedName) : '';
  return (
    <>
      <Text variant="heading">{i18n.t('web.metadata.currentMatch')}</Text>
      {identity ? <Text variant="body" tone="secondary">{providerName(identity.provider)} {identity.type ? `${identity.type} ` : ''}{identity.id || i18n.t('web.metadata.notMatched')}{orderLine ? ` · ${orderLine}` : ''} · {i18n.t(matchingStatusKey(identity.status))}</Text> : <Text variant="body" tone="secondary">{i18n.t('web.metadata.noIdentityFor', {kind: data.target.kind})}</Text>}
      {identity ? <Button size="sm" variant="ghost" icon={identityLocked ? 'lock' : 'shield'} label={i18n.t(identityLocked ? 'web.metadata.identityLocked' : 'web.metadata.identityUnlocked')} disabled={busy} onPress={() => void run({action: 'relationship_lock', role: 'identity', locked: !identityLocked, confirm: true})} style={{alignSelf: 'flex-start'}} /> : null}
      <Field label={i18n.t('web.metadata.searchProvider')} placeholder={i18n.t(isScreen ? 'web.metadata.searchProviderHelp' : 'web.metadata.searchProviderHelpAuto')} value={query} onChangeText={setQuery} onSubmitEditing={() => void run(matchingSearchCommand(identity, query))} returnKeyType="search" editable={!busy && isScreen} trailing={<Button size="sm" variant="secondary" icon="search" accessibilityLabel={i18n.t('web.search.title')} disabled={busy || !identity} onPress={() => void run(matchingSearchCommand(identity, query))} />} />
      <Button size="sm" variant="ghost" icon="refresh" label={i18n.t('action.tryAgain')} disabled={busy || !identity} onPress={() => void run({action: 'retry'})} style={{alignSelf: 'flex-start'}} />
      {data.candidates.map(c => {
        const current = identity?.id === c.id && identity.provider === c.provider;
        const key = `${c.provider}:${c.id}`;
        const offered = c.orders ?? [];
        // The order a match starts with: the one it already has when it is the current match, otherwise the provider's first.
        const chosen = orders[key] ?? (current && offered.some(o => o.id === stored.base) ? {order: stored.base, offset: stored.offset} : {order: offered[0]?.id ?? '', offset: 0});
        const takesOffset = c.provider === 'tmdb' && orderTakesOffset(chosen.order);
        const order = chosen.order ? (takesOffset ? tmdbAbsoluteOrder(chosen.order, chosen.offset) : chosen.order) : '';
        const set = (next: Partial<{order: string; offset: number}>) => setOrders(prev => ({...prev, [key]: {...chosen, ...next}}));
        const identify = () => void run({action: 'identify', provider: c.provider, candidateId: c.id, ...(order ? {order} : {}), confirm: true});
        return (
          <View key={key} style={{gap: space.xs}}>
            <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
              <View style={{flex: 1, minWidth: 0}}><Text variant="bodyStrong" lines={1}>{c.title || c.id}</Text><Text variant="caption" tone="tertiary" lines={2}>{[providerName(c.provider), c.subtitle].filter(Boolean).join(' · ')}</Text></View>
              {current
                ? (order && order !== identity?.order && offered.length ? <Button size="sm" variant="secondary" label={i18n.t('web.metadata.useOrder')} disabled={busy} onPress={identify} /> : <Text variant="caption" tone="accent">{i18n.t('profile.current')}</Text>)
                : <Button size="sm" variant="secondary" label={i18n.t('web.metadata.useOne')} disabled={busy} onPress={identify} />}
            </View>
            {/* Which episode order the match uses, and what is added to each file's own number when the files are numbered straight through. */}
            {offered.length > 1 ? <Button size="sm" variant="ghost" icon="list" label={`${i18n.t('web.metadata.episodeOrder')}: ${offered.find(o => o.id === chosen.order)?.name ?? chosen.order}`} disabled={busy} onPress={() => setPicking({key, offered, chosen: chosen.order, pick: id => set({order: id})})} style={{alignSelf: 'flex-start'}} />
              : offered.length ? <Text variant="caption" tone="tertiary">{i18n.t('web.metadata.orders', {names: offered[0]!.name})}</Text> : null}
            {takesOffset ? <Field label={i18n.t('web.metadata.numberOffset')} hint={i18n.t('web.metadata.numberOffsetHelp')} keyboardType="numbers-and-punctuation" value={offsetText[key] ?? String(chosen.offset)} editable={!busy}
              onChangeText={text => { setOffsetText(prev => ({...prev, [key]: text})); const n = Math.trunc(Number(text)); if (text.trim() !== '' && Number.isSafeInteger(n) && Math.abs(n) <= 1000000) set({offset: n}); }} /> : null}
          </View>
        );
      })}
      <Menu open={!!picking} onClose={() => setPicking(undefined)} title={i18n.t('web.metadata.episodeOrder')}
        items={(picking?.offered ?? []).map(o => ({id: o.id, label: o.name, selected: o.id === picking?.chosen}))}
        onSelect={id => { picking?.pick(id); setPicking(undefined); }} />
      {!data.candidates.length ? <Text variant="body" tone="secondary">{i18n.t(isScreen ? 'web.metadata.noCandidatesMatch' : 'web.metadata.noCandidatesMatchAuto')}</Text> : null}
    </>
  );
}

function HistoryTab({data, busy, run}: {data: RepairData; busy: boolean; run: (c: Command) => Promise<boolean>}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const label = (trigger: string) => i18n.t('web.metadata.history', {trigger});
  return (
    <>
      <Text variant="heading">{i18n.t('web.metadata.recentChanges')}</Text>
      {data.history.map(h => (
        <View key={h.id} style={{flexDirection: 'row', alignItems: 'center', gap: space.sm}}>
          <View style={{flex: 1}}><Text variant="body">{label(h.trigger)}</Text><Text variant="caption" tone="tertiary">{new Date(h.observedAt).toLocaleString()}</Text></View>
          <Button size="sm" variant="ghost" icon="back" label={i18n.t('action.undo')} disabled={busy} onPress={() => void run({action: 'undo', historyId: h.id, confirm: true})} />
        </View>
      ))}
      {!data.history.length ? <Text variant="body" tone="secondary">{i18n.t('web.metadata.noHistory')}</Text> : null}
      <View style={{flexDirection: 'row', gap: space.xs}}>
        <Button size="sm" variant="ghost" icon="lock" label={i18n.t('web.metadata.lockAll')} disabled={busy} onPress={() => void run({action: 'lock_all', confirm: true})} />
        <Button size="sm" variant="ghost" icon="shield" label={i18n.t('web.metadata.unlockAll')} disabled={busy} onPress={() => void run({action: 'unlock_all', confirm: true})} />
      </View>
    </>
  );
}

/* ---------- Bulk ---------- */

/** CD-44: chunk explicit metadata targets at the shared bulk limit. */
export function chunkBulkTargets<T>(targets: readonly T[]): readonly (readonly T[])[] {
  const out: (readonly T[])[] = [];
  for (let i = 0; i < targets.length; i += bulkTargetLimit) out.push(targets.slice(i, i + bulkTargetLimit));
  return out;
}

function BulkEditor({targets, onSaved, onClose}: {targets: readonly RepairTarget[]; onSaved?: () => void; onClose: () => void}) {
  const {api, session} = useSession();
  const {space, window} = useTheme();
  const i18n = useI18n();
  const scope = useMemo(() => viewerScope(session, api), [session, api]);
  const kinds = new Set(targets.map(t => t.kind));
  const [values, setValues] = useState<Record<string, string>>({});
  const [lockEdited, setLockEdited] = useState(true);
  const [genresAdd, setGenresAdd] = useState('');
  const [genresRemove, setGenresRemove] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<{ok: number; failed: number; messages: string[]}>();
  const [schema, setSchema] = useState<readonly RepairFieldSpec[]>();
  useEffect(() => {
    let cancelled = false;
    const probe = new MetadataRepairService({api, scope});
    void probe.load(targets[0]).then(() => { const d = probe.getSnapshot().data; if (!cancelled && d) setSchema(d.schema.filter(f => f.bulk)); probe.dispose(); });
    return () => { cancelled = true; probe.dispose(); };
  }, [api, scope, targets]);
  if (kinds.size > 1) return <View style={{padding: space.lg, gap: space.md}}><Notice tone="warning" message={i18n.t('web.metadata.bulkOneKind')} /><Footer copy="" busy={false} onClose={onClose} /></View>;
  const fieldChanges = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== ''));
  const adds = splitList(genresAdd), removes = splitList(genresRemove);
  const pending = Object.keys(fieldChanges).length + (adds.length || removes.length ? 1 : 0);
  const apply = async () => {
    setBusy(true);
    setError(undefined);
    // CD-46: bulk edits meet the same schema bounds as single edits, before anything is sent.
    if (schema) for (const spec of schema) {
      const v = fieldChanges[spec.field];
      if (v === undefined || spec.type === 'list') continue;
      const problem = repairFieldProblem(spec, v, targets[0].kind);
      if (problem) { setError(repairFieldMessage(i18n.t, spec, problem)); setBusy(false); return; }
    }
    // M25-4 (mirror of web BulkEditor @ 1d681f6a): one metadata-edit job per
    // selector group. Item targets go out as an items selector (200 per job);
    // each container target (show, season, album, artist, book) is its own
    // container selector. No client enumeration or per-item revisions: the
    // server captures revision fences with membership, and a later edit
    // surfaces as a metadata_conflict per-item failure. The failures page maps
    // to per-target outcomes, aggregated to this sheet's summary.
    type Outcome = {id: string; ok: boolean; message?: string};
    const outcomes: Outcome[] = [];
    setError(undefined);
    setBusy(true);
    try {
      const fields: Record<string, BulkFieldEdit> = {};
      for (const [f, v] of Object.entries(fieldChanges)) fields[f] = schema?.find(x => x.field === f)?.type === 'list' ? {values: splitList(v)} : {value: v};
      const genres = adds.length || removes.length ? {genres: {...(adds.length ? {add: adds} : {}), ...(removes.length ? {remove: removes} : {})}} : {};
      const args = {...(Object.keys(fields).length ? {fields} : {}), ...genres, lockEdited};
      const groups = groupMetadataTargets(targets, () => `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      for (const group of groups) {
        const ids = [...group.ids];
        try {
          const outcome = await runBulkRequests(api, 'metadata-edit', args, [group]);
          const failedById = new Map(outcome.failed.map(f => [f.itemId, f.code]));
          for (const id of ids) {
            const code = failedById.get(id);
            outcomes.push(code ? {id, ok: false, message: say({code}, 'generic', 'save')} : {id, ok: true});
          }
        } catch (e) {
          const message = say(e, 'generic', 'save');
          for (const id of ids) if (!outcomes.some(o => o.id === id)) outcomes.push({id, ok: false, message});
        }
      }
    } catch (e) {
      const message = say(e, 'generic', 'save');
      for (const t of targets) if (!outcomes.some(o => o.id === t.id)) outcomes.push({id: t.id, ok: false, message});
    }
    {
      const failed = outcomes.filter(o => !o.ok);
      const messages = [...new Set(failed.map(f => f.message).filter((m): m is string => !!m))];
      setDone({ok: outcomes.length - failed.length, failed: failed.length, messages});
    }
    setBusy(false);
    onSaved?.();
  };
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{maxHeight: window.height * 0.74}} contentContainerStyle={{paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.md}}>
      {done ? <><Notice tone={done.failed ? 'warning' : 'success'} title={i18n.t('web.metadata.bulkTitle', {ok: done.ok, failed: done.failed})} message={done.messages.join(' ') || i18n.t('web.metadata.bulkAllUpdated')} /><Footer copy="" busy={false} onClose={onClose} /></> : (
        <>
          {error ? <Notice tone="danger" message={error} /> : null}
          {!schema ? <Text variant="body" tone="secondary">{i18n.t('web.metadata.loadingFieldsApple')}</Text> : schema.map(spec => <Field key={spec.field} label={spec.label} value={values[spec.field] ?? ''} onChangeText={v => setValues(p => ({...p, [spec.field]: v}))} placeholder={i18n.t('web.metadata.mixedLeave')} multiline={spec.type === 'multiline'} keyboardType={spec.type === 'integer' ? 'numeric' : 'default'} editable={!busy} />)}
          {targets[0].kind === 'item' ? <><Field label={i18n.t('web.metadata.addGenres')} placeholder={i18n.t('web.metadata.commaSeparated')} value={genresAdd} onChangeText={setGenresAdd} editable={!busy} /><Field label={i18n.t('web.metadata.removeGenres')} placeholder={i18n.t('web.metadata.commaSeparated')} value={genresRemove} onChangeText={setGenresRemove} editable={!busy} /></> : null}
          <Button size="sm" variant={lockEdited ? 'secondary' : 'ghost'} icon={lockEdited ? 'lock' : 'shield'} selected={lockEdited} label={lockEdited ? i18n.t('web.metadata.lockEditedOn') : i18n.t('web.metadata.lockEditedOff')} disabled={busy} onPress={() => setLockEdited(v => !v)} style={{alignSelf: 'flex-start'}} />
          <Footer copy={pending ? i18n.t('web.metadata.pendingChanges', {pending, count: targets.length}) : i18n.t('web.metadata.fillHint')} busy={busy} primary={pending ? {label: i18n.t('web.metadata.applyToCount', {count: targets.length}), onPress: () => void apply()} : undefined} onClose={onClose} />
        </>
      )}
    </ScrollView>
  );
}
