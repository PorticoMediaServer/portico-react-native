import React, {useEffect, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {recordingAllowed, recordingGuideRoute, recordingOwnerKey, recordingOwnerLabel, type RecordingGrant, type RecordingOwner, type RecordingOwnerChoice, type RecordingSeries} from '../../../../../packages/client-core/src/server-admin/recording-policy';
import {tunerStatus, tunerUseLine} from '../../../../../packages/client-core/src/server-admin/live-words';
import type {RecordingStorage, StoragePolicy} from '../../../../../packages/client-core/src/dvr';
import {Button, Focusable, Select, Switch, TextField} from '../../kit/controls';
import {Dialog, Menu} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeLiveOwnerController} from './live-owner-controller';
import type {NativeRecordingsController} from './recordings-controller';
import type {AdminRule, DVRDefaults, DVRDocument, TunerAllocation, TunerView} from './recording-owner-model';
import type {LiveSource} from './live-owner-model';
import type {KeepPolicy} from './recording-owner-model';

const paddingChoices = [0, 60, 120, 300, 600, 900];
const keepModes: readonly DVRDefaults['keepPolicy']['mode'][] = ['keep-all', 'keep-count', 'keep-days'];

/** Recording › tuners, who may record, standing rules, defaults and space. */
export function NativeRecordingOwner({controller, recordings, runtime, sources}: {controller: NativeLiveOwnerController; recordings: NativeRecordingsController; runtime: NativeShellRuntime; sources: readonly LiveSource[]}) {
  const theme = useTheme(), t = runtime.text.t;
  const [tuners, setTuners] = useState<TunerView>(), [policy, setPolicy] = useState<Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>>();
  const [rules, setRules] = useState<readonly AdminRule[]>(), [settings, setSettings] = useState<DVRDocument>(), [storage, setStorage] = useState<RecordingStorage>();
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(''), [ruleMenu, setRuleMenu] = useState<AdminRule>(), [ruleRemove, setRuleRemove] = useState<AdminRule>(), [newRule, setNewRule] = useState(false);
  const [permissionDraft, setPermissionDraft] = useState<Readonly<Record<string, Readonly<{enabled: boolean; inheritProfiles: boolean}>>>>({});
  const [defaultsDraft, setDefaultsDraft] = useState<DVRDefaults>(), [storageDraft, setStorageDraft] = useState<StoragePolicy>();
  const ruleOpeners = useRef(new Map<string, View>()), ruleMenuOpener = useRef<View | null>(null);
  const reload = async () => {
    setError(undefined);
    try {
      const [nextTuners, nextPolicy, nextRules, nextSettings, nextStorage] = await Promise.all([controller.tuners(), controller.policy(), controller.rules(), controller.dvrSettings(), recordings.storage()]);
      if (!controller.lifetime.current()) return;
      setTuners(nextTuners); setPolicy(nextPolicy); setRules(nextRules); setSettings(nextSettings); setStorage(nextStorage);
      setDefaultsDraft(current => current ?? nextSettings.settings); setStorageDraft(current => current ?? nextStorage.policy);
    } catch (failure) {if (controller.lifetime.current()) setError(failure);}
  };
  useEffect(() => {void reload();}, [controller, recordings]); // eslint-disable-line react-hooks/exhaustive-deps
  const write = async (key: string, work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key); setError(undefined);
    try {await work(); await reload();}
    catch (failure) {if (controller.lifetime.current()) setError(failure);}
    finally {if (controller.lifetime.current()) setBusy('');}
  };
  const saveAll = async () => {
    if (busy || !policy) return;
    setBusy('save'); setError(undefined);
    try {
      for (const [key, change] of Object.entries(permissionDraft)) {
        const choice = policy.owners.find(value => recordingOwnerKey(value.owner) === key), grant = policy.grants.find(value => recordingOwnerKey(value.owner) === key);
        if (choice) await controller.setPermission(choice.owner, change.enabled, change.inheritProfiles, grant?.revision ?? 0);
      }
      if (settings && defaultsDraft && JSON.stringify(defaultsDraft) !== JSON.stringify(settings.settings)) await controller.saveDvrSettings(settings.revision, defaultsDraft);
      if (storage && storageDraft && JSON.stringify(storageDraft) !== JSON.stringify(storage.policy)) await recordings.saveStorage(storageDraft);
      setPermissionDraft({}); setDefaultsDraft(undefined); setStorageDraft(undefined);
      await reload();
    } catch (failure) {if (controller.lifetime.current()) setError(failure);}
    finally {if (controller.lifetime.current()) setBusy('');}
  };
  if (error !== undefined && !tuners && !policy) return <View style={{paddingHorizontal: 20, paddingTop: 20}}><StateView testID="live-owner-recording-error" {...runtime.error(error, () => void reload())}/></View>;
  return <View style={{paddingHorizontal: 20, paddingTop: 18, gap: 26}}>
    {error !== undefined && <StateView testID="live-owner-recording-error" {...runtime.error(error, () => void reload())}/>}
    <Section title={t('web.dvrSettings.tuners')} description={tuners ? t('web.dvrSettings.tunersLede', {hours: tuners.upcomingWindowHours}) : undefined}>
      {tuners?.sources.map(source => <TunerCard key={source.sourceId} source={source} runtime={runtime}/>)}
      {tuners && !tuners.sources.length && <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.dvrSettings.noTuners')}</Text>}
      {!tuners && error === undefined && <Text style={[shellType(13), {color: theme.colors.textTertiary}]}>{t('web.librarySettings.loading')}</Text>}
    </Section>
    {policy && <Permissions policy={policy} draft={permissionDraft} runtime={runtime} onChange={(owner, change) => setPermissionDraft(current => ({...current, [recordingOwnerKey(owner)]: change}))}/>}
    <Section title={t('web.recordingRules.title')} description={t('web.recordingRules.lede')} action={policy && <Button testID="live-owner-new-rule" icon="i-plus" size="small" onPress={() => setNewRule(true)}>{t('web.recordingRules.newRule')}</Button>}>
      {rules?.map(rule => <Focusable key={rule.id} ref={node => {if (node) ruleOpeners.current.set(rule.id, node); else ruleOpeners.current.delete(rule.id);}} testID={`live-owner-rule-${rule.id}`} focusKind="row"
        onPress={() => {ruleMenuOpener.current = ruleOpeners.current.get(rule.id) ?? null; setRuleMenu(rule);}} style={{flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14}}>
        <View style={{flex: 1, gap: 4}}>
          <Text style={[shellType(15, 700), {color: theme.colors.text}]} numberOfLines={1}>{rule.name || rule.match}</Text>
          <Text style={[shellType(12.5), {color: theme.colors.textSecondary}]} numberOfLines={2}>{[t('web.recordingRules.seriesKind'), rule.options.newEpisodesOnly ? t('web.recordingRules.newOnly') : '', ownerName(policy?.owners, rule.owner) ?? ''].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text style={[shellType(12.5, 700), {color: rule.enabled ? theme.colors.healthy : theme.colors.textTertiary}]}>{rule.enabled ? t('recordings.on') : t('web.recordingRules.pausedRule')}</Text>
      </Focusable>)}
      {rules && !rules.length && <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.recordingRules.noRules')} {t('web.recordingRules.noRulesHelp')}</Text>}
    </Section>
    {settings && defaultsDraft && <Defaults document={settings} draft={defaultsDraft} runtime={runtime} onChange={value => setDefaultsDraft(value)}/>}
    {storage && storageDraft && <Storage storage={storage} draft={storageDraft} runtime={runtime} onChange={value => setStorageDraft(value)}/>}
    {settings && storage && <PendingBar count={Object.keys(permissionDraft).length + (JSON.stringify(defaultsDraft) !== JSON.stringify(settings.settings) ? 1 : 0) + (JSON.stringify(storageDraft) !== JSON.stringify(storage.policy) ? 1 : 0)}
      busy={busy === 'save'} onDiscard={() => {setPermissionDraft({}); setDefaultsDraft(settings.settings); setStorageDraft(storage.policy);}}
      onSave={() => void saveAll()} runtime={runtime}/>}
    <Menu open={ruleMenu !== undefined} onOpenChange={value => {if (!value) setRuleMenu(undefined);}} title={ruleMenu?.name} anchorRef={ruleMenuOpener} presentation="sheet" testID="live-owner-rule-menu" items={ruleMenu ? [
      ...(policy ? [{id: 'toggle', icon: ruleMenu.enabled ? 'i-pause' as const : 'i-play' as const, label: t(ruleMenu.enabled ? 'web.recordingRules.pauseRule' : 'web.recordingRules.resumeRule'), onSelect: () => void write(`rule:${ruleMenu.id}`, () => controller.saveRuleEnabled(ruleMenu, policy.grants, !ruleMenu.enabled))}] : []),
      {id: 'separator', separator: true as const},
      {id: 'remove', icon: 'i-trash' as const, label: t('web.recordingRules.remove'), destructive: true, onSelect: () => setRuleRemove(ruleMenu)},
    ] : []}/>
    {policy && <NewRuleSheet controller={controller} runtime={runtime} policy={policy} sources={sources} open={newRule} onOpenChange={setNewRule}
      onSaved={() => {setNewRule(false); void reload();}}/>}
    <Dialog open={ruleRemove !== undefined} onOpenChange={value => {if (!value && !busy) setRuleRemove(undefined);}} title={t('web.recordingRules.removeTitle', {name: ruleRemove?.name ?? ''})} description={t('web.recordingRules.removeBody')} testID="live-owner-rule-remove"
      footer={<View style={{flexDirection: 'row', gap: 10}}><Button variant="glass" textStyle={{color: theme.colors.record}} style={{backgroundColor: `${theme.colors.record}29`}} loading={busy.startsWith('rule')} onPress={() => {const rule = ruleRemove; if (!rule) return; void write(`rule:${rule.id}`, () => controller.deleteRule(rule)).then(() => {if (controller.lifetime.current()) setRuleRemove(undefined);});}}>{t('web.recordingRules.remove')}</Button><Button variant="glass" disabled={!!busy} onPress={() => setRuleRemove(undefined)}>{t('action.cancel')}</Button></View>}>
      <View/>
    </Dialog>
  </View>;
}

function Section({title, description, children, action}: {title: string; description?: string; children: React.ReactNode; action?: React.ReactNode}) {
  const theme = useTheme();
  return <View style={{gap: 10}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}><Text style={[shellType(13, 700), {color: theme.colors.textTertiary, flex: 1}]}>{title}</Text>{action}</View>
    {description && <Text style={[shellType(13), {color: theme.colors.textSecondary, lineHeight: 20}]}>{description}</Text>}
    {children}
  </View>;
}
function ownerName(owners: readonly RecordingOwnerChoice[] | undefined, owner: RecordingOwner): string | undefined {
  const choice = owners?.find(value => recordingOwnerKey(value.owner) === recordingOwnerKey(owner));
  return choice ? recordingOwnerLabel(choice) : undefined;
}
function TunerCard({source, runtime}: {source: TunerAllocation; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t, status = tunerStatus(t, source), uses = [...source.active, ...source.upcoming.slice(0, 6)];
  const when = (iso: string) => defaultI18n.formatDate(iso, {weekday: 'short', hour: 'numeric', minute: '2-digit'});
  return <View testID={`live-owner-tuner-${source.sourceId}`} style={{backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14, gap: 8}}>
    <View style={{flexDirection: 'row', alignItems: 'center', gap: 10}}>
      <Text style={[shellType(15, 700), {color: theme.colors.text, flex: 1}]} numberOfLines={1}>{source.sourceName}</Text>
      <Text style={[shellType(12.5, 700), {color: status.tone === 'danger' ? theme.colors.record : status.tone === 'warning' ? theme.colors.amber : theme.colors.healthy}]}>{status.text}</Text>
    </View>
    {uses.length ? uses.map((use, index) => <Text key={use.recordingId || index} style={[shellType(12.5), {color: theme.colors.textSecondary}]} numberOfLines={1}>{tunerUseLine(t, use, when)}</Text>)
      : <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{t('web.dvrSettings.nothingScheduled')}</Text>}
  </View>;
}

/** Every profile the server lists, with its effective grant; an inherited profile reads as such.
 * A switch edits the page's draft; nothing is written until the bar's Save. */
function Permissions({policy, draft, runtime, onChange}: {policy: Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>; draft: Readonly<Record<string, Readonly<{enabled: boolean; inheritProfiles: boolean}>>>; runtime: NativeShellRuntime; onChange: (owner: RecordingOwner, change: Readonly<{enabled: boolean; inheritProfiles: boolean}>) => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const accounts = new Map<string, RecordingOwnerChoice[]>();
  for (const choice of policy.owners) {const key = choice.owner.accountId; accounts.set(key, [...(accounts.get(key) ?? []), choice]);}
  return <Section title={t('web.dvrSettings.whoCanRecord')} description={t('web.dvrSettings.whoCanRecordLede')}>
    {[...accounts.entries()].map(([accountId, profiles]) => {
      const primary = profiles[0]!, primaryKey = recordingOwnerKey(primary.owner), primaryGrant = policy.grants.find(grant => recordingOwnerKey(grant.owner) === primaryKey);
      const primaryValue = draft[primaryKey] ?? {enabled: recordingAllowed(primary.owner, policy.grants), inheritProfiles: primaryGrant?.inheritProfiles ?? false};
      return <View key={accountId} style={{gap: 4, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 10}}>
        <Text style={[shellType(12.5, 700), {color: theme.colors.textTertiary, paddingHorizontal: 6}]}>{primary.accountName}</Text>
        {profiles.map(choice => {
          const key = recordingOwnerKey(choice.owner), exact = policy.grants.find(grant => recordingOwnerKey(grant.owner) === key);
          const value = draft[key] ?? {enabled: recordingAllowed(choice.owner, policy.grants), inheritProfiles: exact?.inheritProfiles ?? false};
          return <View key={key} style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, minHeight: 44}}>
            <View style={{flex: 1}}>
              <Text style={[shellType(15, 600), {color: theme.colors.text}]} numberOfLines={1}>{choice.profileName}</Text>
              <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{exact ? t(exact.enabled ? 'recordings.on' : 'recordings.paused') : t('web.dvrSettings.inheritedFromAccount')}</Text>
            </View>
            <Switch testID={`live-owner-permission-${choice.owner.profileId}`} accessibilityLabel={choice.profileName} checked={value.enabled}
              onCheckedChange={enabled => onChange(choice.owner, {...value, enabled})}/>
          </View>;
        })}
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingLeft: 18, minHeight: 40}}>
          <Text style={[shellType(13), {color: theme.colors.textSecondary, flex: 1}]}>{t('web.dvrSettings.inheritRow')}</Text>
          <Switch testID={`live-owner-inherit-${accountId}`} accessibilityLabel={t('web.dvrSettings.inheritSwitch')} checked={primaryValue.inheritProfiles} disabled={!primaryValue.enabled}
            onCheckedChange={inheritProfiles => onChange(primary.owner, {...primaryValue, inheritProfiles})}/>
        </View>
      </View>;
    })}
  </Section>;
}

function Defaults({document, draft, runtime, onChange}: {document: DVRDocument; draft: DVRDefaults; runtime: NativeShellRuntime; onChange: (value: DVRDefaults) => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const patch = (value: Partial<DVRDefaults>) => onChange({...draft, ...value});
  const minutes = (ms: number | null) => String(Math.round((ms ?? 0) / 60000));
  return <Section title={t('web.dvrSettings.defaults')} description={t('web.dvrSettings.defaultsLede')}>
    <View style={{gap: 12, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14}}>
      <Select testID="live-owner-padding-before" label={t('web.dvrSettings.startEarly')} description={t('web.dvrSettings.startEarlyHelp')} value={minutes(draft.prePaddingMs)} options={paddingChoices.map(value => ({value: minutes(value), label: value ? t('recordings.minutes', {count: value / 60}) : t('recordings.none')}))} onValueChange={value => patch({prePaddingMs: Number(value) * 60000})}/>
      <Select testID="live-owner-padding-after" label={t('web.dvrSettings.finishLate')} description={t('web.dvrSettings.finishLateHelp')} value={minutes(draft.postPaddingMs)} options={paddingChoices.map(value => ({value: minutes(value), label: value ? t('recordings.minutes', {count: value / 60}) : t('recordings.none')}))} onValueChange={value => patch({postPaddingMs: Number(value) * 60000})}/>
      <Select testID="live-owner-tuner-conflict" label={t('server.live.tunerConflict')} description={t('server.live.tunerConflictHelp')} value={draft.liveTunerConflict} options={[{value: 'keep-watching', label: t('server.live.tunerConflict.keep')}, {value: 'stop-watching', label: t('server.live.tunerConflict.stop')}]} onValueChange={liveTunerConflict => patch({liveTunerConflict})}/>
      <Select testID="live-owner-keep-mode" label={t('recordings.keepLabel')} value={draft.keepPolicy.mode} options={keepModes.map(mode => ({value: mode, label: t(mode === 'keep-all' ? 'web.logs.everything' : mode === 'keep-count' ? 'web.dvrSettings.keepNewest' : 'web.dvrSettings.keepDays')}))}
        onValueChange={mode => patch({keepPolicy: {...draft.keepPolicy, mode: mode as DVRDefaults['keepPolicy']['mode']}})}/>
      {draft.keepPolicy.mode === 'keep-count' && <Select testID="live-owner-keep-count" label={t('web.dvrSettings.howMany')} value={String(draft.keepPolicy.keepCount)} options={[1, 3, 5, 10, 20].map(value => ({value: String(value), label: String(value)}))} onValueChange={value => patch({keepPolicy: {...draft.keepPolicy, keepCount: Number(value)}})}/>}
      {draft.keepPolicy.mode === 'keep-days' && <Select testID="live-owner-keep-days" label={t('web.dvrSettings.howManyDays')} value={String(draft.keepPolicy.keepDays)} options={[7, 14, 30, 60, 90].map(value => ({value: String(value), label: String(value)}))} onValueChange={value => patch({keepPolicy: {...draft.keepPolicy, keepDays: Number(value)}})}/>}
      <Select testID="live-owner-after-recording" label={t('web.dvrSettings.afterRecording')} value={draft.conversion.mode} options={[{value: 'none', label: t('web.dvrSettings.leaveRecorded')}]} onValueChange={mode => patch({conversion: {...draft.conversion, mode}})}/>
      {draft.folderTemplate ? <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.dvrSettings.folderShows')}: {draft.folderTemplate}</Text> : null}
      {draft.movieFolderTemplate ? <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.dvrSettings.folderMovies')}: {draft.movieFolderTemplate}</Text> : null}
    </View>
  </Section>;
}

function Storage({storage, draft, runtime, onChange}: {storage: RecordingStorage; draft: StoragePolicy; runtime: NativeShellRuntime; onChange: (value: StoragePolicy) => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const gb = (bytes: number) => Math.round(bytes / 1e9);
  const total = storage.measurement.usedBytes + storage.measurement.freeBytes;
  const facts: readonly [string, string][] = [
    [t('server.live.usedByRecordings'), defaultI18n.bytes(storage.measurement.usedBytes)],
    [t('server.live.freeOnVolume'), defaultI18n.bytes(storage.measurement.freeBytes)],
    [t('web.liveTv.space.reserved'), defaultI18n.bytes(storage.measurement.reservedBytes)],
    [t('web.liveTv.space.waitingDelete'), defaultI18n.bytes(storage.pendingDeleteBytes)],
    [t('web.liveTv.space.forecast'), storage.forecastDescription || t('web.liveTv.space.forecastOver', {size: defaultI18n.bytes(storage.forecastBytes), hours: storage.forecastHours})],
  ];
  return <Section title={t('channels.recordings')} description={t('web.liveTv.recordingsLede')}>
    <View style={{backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14, gap: 8}} testID="live-owner-storage">
      {facts.map(([label, value]) => <View key={label} style={{flexDirection: 'row', gap: 12}}><Text style={[shellType(13), {color: theme.colors.textTertiary, flex: 1}]}>{label}</Text><Text style={[shellType(13, 700), {color: theme.colors.text}]}>{value}</Text></View>)}
      <View style={{height: 6, borderRadius: 4, backgroundColor: theme.colors.line, overflow: 'hidden', marginTop: 6}}><View style={{height: '100%', width: `${total > 0 ? Math.min(100, storage.measurement.usedBytes / total * 100) : 0}%`, backgroundColor: theme.colors.accentStrong}}/></View>
      <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{t('recordings.hoursLeft', {count: storage.forecastHours})}</Text>
      {!storage.measurement.writeHealthy && <Text style={[shellType(12.5), {color: theme.colors.amber}]}>{t('web.liveTv.notWritable')}</Text>}
    </View>
    <View style={{gap: 12, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14}}>
      <Select testID="live-owner-storage-retention" label={t('web.liveTv.keepRecordings')} description={t('web.liveTv.keepRecordingsHelp')} value={String(draft.retentionDays)} options={[0, 7, 14, 30, 60, 90, 365].map(value => ({value: String(value), label: String(value)}))} onValueChange={value => onChange({...draft, retentionDays: Number(value)})}/>
      <Select testID="live-owner-storage-episodes" label={t('web.liveTv.episodesPerSeries')} description={t('web.liveTv.episodesPerSeriesHelp')} value={String(draft.episodeLimit)} options={[0, 1, 3, 5, 10, 20, 50].map(value => ({value: String(value), label: String(value)}))} onValueChange={value => onChange({...draft, episodeLimit: Number(value)})}/>
      <Select testID="live-owner-storage-floor" label={t('web.liveTv.leaveFree')} description={t('web.liveTv.leaveFreeHelp')} value={String(gb(draft.floorBytes))} options={[0, 10, 20, 50, 100, 200].map(value => ({value: String(value), label: `${value} ${t('web.liveTv.gbUnit')}`}))} onValueChange={value => onChange({...draft, floorBytes: Number(value) * 1e9})}/>
      <Select testID="live-owner-storage-cap" label={t('web.liveTv.capUpTo')} description={t('web.liveTv.capUpToHelp')} value={String(gb(draft.capBytes))} options={[0, 100, 250, 500, 1000, 2000].map(value => ({value: String(value), label: `${value} ${t('web.liveTv.gbUnit')}`}))} onValueChange={value => onChange({...draft, capBytes: Number(value) * 1e9})}/>
    </View>
  </Section>;
}

/** Frame 16c: one bar counts what is waiting and applies it to the whole server. */
function PendingBar({count, busy, runtime, onDiscard, onSave}: {count: number; busy: boolean; runtime: NativeShellRuntime; onDiscard: () => void; onSave: () => void}) {
  const theme = useTheme(), t = runtime.text.t;
  if (!count) return null;
  return <View testID="live-owner-pending" style={{borderTopWidth: 1, borderTopColor: theme.colors.line, paddingTop: 12, gap: 10}}>
    <Text style={[shellType(13.5), {color: theme.colors.textSecondary}]}>{t('web.liveTv.changesWaiting', {count})}</Text>
    <View style={{flexDirection: 'row', gap: 10}}>
      <Button testID="live-owner-pending-discard" variant="glass" disabled={busy} onPress={onDiscard}>{t('action.discard')}</Button>
      <Button testID="live-owner-pending-save" loading={busy} onPress={onSave}>{t('action.save')}</Button>
    </View>
  </View>;
}

/** Frame 17a: a new rule from a series the guide really lists, for a permitted profile. */
export function NewRuleSheet({controller, runtime, policy, sources, open, onOpenChange, onSaved}: {controller: NativeLiveOwnerController; runtime: NativeShellRuntime; policy?: Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>; sources?: readonly LiveSource[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const [ownPolicy, setOwnPolicy] = useState<Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>>(), [ownSources, setOwnSources] = useState<readonly LiveSource[]>();
  useEffect(() => {
    if (!open || policy && sources) return;
    let active = true;
    void Promise.all([controller.policy(), controller.load(true).then(() => controller.getSnapshot().list?.sources ?? [])]).then(([nextPolicy, nextSources]) => {if (active) {setOwnPolicy(nextPolicy); setOwnSources(nextSources);}}, () => {});
    return () => {active = false;};
  }, [open, policy, sources, controller]);
  const effectivePolicy = policy ?? ownPolicy, effectiveSources = sources ?? ownSources ?? [];
  const allowed = effectivePolicy ? effectivePolicy.owners.filter(value => recordingAllowed(value.owner, effectivePolicy.grants)) : [];
  const [name, setName] = useState(''), [owner, setOwner] = useState(''), [sourceId, setSourceId] = useState(''), [day, setDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [series, setSeries] = useState<readonly RecordingSeries[]>([]), [anchor, setAnchor] = useState(''), [newOnly, setNewOnly] = useState(false);
  const [before, setBefore] = useState<number | null>(null), [after, setAfter] = useState<number | null>(null), [priority, setPriority] = useState('0'), [keepKey, setKeepKey] = useState('default');
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>();
  const cancel = useRef<View>(null);
  useEffect(() => {
    if (!open) return;
    setName(''); setOwner(allowed[0] ? recordingOwnerKey(allowed[0].owner) : ''); setSourceId(effectiveSources[0]?.id ?? ''); setDay(new Date().toISOString().slice(0, 10));
    setSeries([]); setAnchor(''); setNewOnly(false); setBefore(null); setAfter(null); setPriority('0'); setKeepKey('default'); setError(undefined); setBusy(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open || !sourceId || !recordingGuideRoute(day, sourceId)) {setSeries([]); return;}
    let active = true;
    setLoading(true); setError(undefined);
    void controller.guideSeries(day, sourceId).then(value => {if (active) {setSeries(value); setAnchor('');}}, failure => {if (active) setError(failure);}).finally(() => {if (active) setLoading(false);});
    return () => {active = false;};
  }, [open, day, sourceId, controller]);
  if (!effectivePolicy) return null;
  const chosen = series.find(value => value.key === anchor), chosenOwner = allowed.find(value => recordingOwnerKey(value.owner) === owner);
  const kept: KeepPolicy | null = keepKey === 'default' ? null : keepKey === 'keep-all' ? {mode: 'keep-all', keepCount: 0, keepDays: 0, keepUntilWatched: false} : keepKey === 'keep-count' ? {mode: 'keep-count', keepCount: 10, keepDays: 0, keepUntilWatched: false} : {mode: 'keep-days', keepCount: 0, keepDays: 30, keepUntilWatched: false};
  const ready = !!chosenOwner && name.trim().length > 0 && !!chosen && recordingGuideRoute(day, sourceId) !== null;
  const save = async () => {
    if (!ready || !chosen || !chosenOwner) return;
    setBusy(true); setError(undefined);
    try {
      await controller.createRule({owner: chosenOwner.owner, anchor: chosen.anchor, kind: 'series', name: name.trim(), match: chosen.seriesId, sourceId: chosen.anchor.sourceId, enabled: chosen.recordAvailable,
        options: {prePaddingMs: before, postPaddingMs: after, keepPolicy: kept, newEpisodesOnly: newOnly, priority: Math.round(Number(priority) || 0), folderTemplate: ''}}, effectivePolicy!.grants);
      onSaved();
    } catch (failure) {setError(failure);}
    finally {setBusy(false);}
  };
  const paddingOptions = [{value: 'default', label: t('web.recordingRules.default')}, ...[0, 60, 120, 300, 600, 900].map(value => ({value: String(value), label: value ? t('recordings.minutes', {count: value / 60}) : t('recordings.none')}))];
  return <Dialog open={open} onOpenChange={value => onOpenChange(value)} title={t('web.recordingRules.newTitle')} initialFocusRef={cancel} testID="live-owner-new-rule-sheet"
    footer={<View style={{flexDirection: 'row', gap: 10}}><Button ref={cancel} variant="glass" disabled={busy} onPress={() => onOpenChange(false)}>{t('action.cancel')}</Button><Button variant="primary" loading={busy} disabled={!ready} onPress={() => void save()}>{t('action.save')}</Button></View>}>
    <View style={{gap: 12}}>
      {error !== undefined && <StateView testID="live-owner-new-rule-error" {...runtime.error(error, () => setError(undefined))}/>}
      <TextField testID="live-owner-new-rule-name" label={t('web.recordingRules.ruleName')} value={name} maxLength={160} onChangeText={setName}/>
      <Select testID="live-owner-new-rule-owner" label={t('web.recordingRules.recordFor')} value={owner} options={[{value: '', label: t('web.recordingRules.chooseProfile')}, ...allowed.map(value => ({value: recordingOwnerKey(value.owner), label: recordingOwnerLabel(value)}))]} onValueChange={setOwner}/>
      {!allowed.length && <Text style={[shellType(13), {color: theme.colors.amber}]}>{t('web.recordingRules.allowFirst')}</Text>}
      <Select testID="live-owner-new-rule-source" label={t('live.guideSource')} value={sourceId} options={effectiveSources.map(value => ({value: value.id, label: value.name}))} onValueChange={value => {setSourceId(value); setAnchor('');}}/>
      <TextField testID="live-owner-new-rule-day" label={t('web.recordingRules.guideDate')} value={day} maxLength={10} autoCapitalize="none" onChangeText={value => {setDay(value); setAnchor('');}}/>
      {!recordingGuideRoute(day, sourceId) && <Text style={[shellType(13), {color: theme.colors.amber}]}>{t('web.recordingRules.validDate')}</Text>}
      {loading && <Text style={[shellType(13), {color: theme.colors.textTertiary}]}>{t('web.recordingRules.readingGuide')}</Text>}
      <Select testID="live-owner-new-rule-series" label={t('web.recordingRules.seriesFromGuide')} value={anchor} options={[{value: '', label: t('web.recordingRules.chooseProgram')}, ...series.map(value => ({value: value.key, label: t('web.recordingRules.seriesOption', {title: value.title, channel: value.channelName, time: defaultI18n.time(value.startsAt), available: value.recordAvailable ? 'yes' : 'no'})}))]}
        onValueChange={value => {const picked = series.find(item => item.key === value); setAnchor(value); if (picked) {setName(current => current || picked.title); setNewOnly(false);}}}/>
      {!loading && !series.length && recordingGuideRoute(day, sourceId) && error === undefined && <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.recordingRules.noSeries')}</Text>}
      {chosen && !chosen.recordAvailable && <Text style={[shellType(13), {color: theme.colors.amber}]}>{t('web.recordingRules.captureUnavailable')}</Text>}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 12}}><Text style={[shellType(15, 600), {color: theme.colors.text, flex: 1}]}>{t('guide.newOnly')}</Text><Switch testID="live-owner-new-rule-new-only" accessibilityLabel={t('guide.newOnly')} checked={newOnly} onCheckedChange={setNewOnly}/></View>
      <Select testID="live-owner-new-rule-before" label={t('web.recordingRules.startEarlySeconds')} value={before === null ? 'default' : String(before)} options={paddingOptions} onValueChange={value => setBefore(value === 'default' ? null : Number(value))}/>
      <Select testID="live-owner-new-rule-after" label={t('web.recordingRules.endLateSeconds')} value={after === null ? 'default' : String(after)} options={paddingOptions} onValueChange={value => setAfter(value === 'default' ? null : Number(value))}/>
      <TextField testID="live-owner-new-rule-priority" label={t('web.recordingRules.priority')} description={t('web.recordingRules.priorityHelp')} keyboardType="number-pad" value={priority} onChangeText={setPriority}/>
      <Select testID="live-owner-new-rule-keep" label={t('recordings.keepLabel')} value={keepKey} options={[{value: 'default', label: t('web.recordingRules.useDefaults')}, {value: 'keep-all', label: t('web.logs.everything')}, {value: 'keep-count', label: t('web.recordingRules.latestFew')}, {value: 'keep-days', label: t('web.dvrSettings.keepDays')}]} onValueChange={setKeepKey}/>
    </View>
  </Dialog>;
}
