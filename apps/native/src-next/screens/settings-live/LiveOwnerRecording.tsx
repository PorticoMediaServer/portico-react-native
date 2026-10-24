import React, {useEffect, useRef, useState} from 'react';
import {Text, View} from 'react-native';
import {defaultI18n} from '../../../../../packages/i18n/src';
import {recordingOwnerKey, recordingOwnerLabel, recordingAllowed, type RecordingGrant, type RecordingOwner, type RecordingOwnerChoice} from '../../../../../packages/client-core/src/server-admin/recording-policy';
import {tunerStatus, tunerUseLine} from '../../../../../packages/client-core/src/server-admin/live-words';
import type {RecordingStorage, StoragePolicy} from '../../../../../packages/client-core/src/dvr';
import {Button, Focusable, Select, Switch} from '../../kit/controls';
import {Dialog, Menu} from '../../kit/overlays';
import {StateView} from '../../kit/states';
import {shellType} from '../../kit/shell/visual';
import {useTheme} from '../../kit/theme';
import type {NativeShellRuntime} from '../../shell/runtime';
import type {NativeLiveOwnerController} from './live-owner-controller';
import type {NativeRecordingsController} from './recordings-controller';
import type {AdminRule, DVRDefaults, DVRDocument, TunerAllocation, TunerView} from './recording-owner-model';

const paddingChoices = [0, 60, 120, 300, 600, 900];
const keepModes: readonly DVRDefaults['keepPolicy']['mode'][] = ['keep-all', 'keep-count', 'keep-days'];

/** Recording › tuners, who may record, standing rules, defaults and space. */
export function NativeRecordingOwner({controller, recordings, runtime}: {controller: NativeLiveOwnerController; recordings: NativeRecordingsController; runtime: NativeShellRuntime}) {
  const theme = useTheme(), t = runtime.text.t;
  const [tuners, setTuners] = useState<TunerView>(), [policy, setPolicy] = useState<Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>>();
  const [rules, setRules] = useState<readonly AdminRule[]>(), [settings, setSettings] = useState<DVRDocument>(), [storage, setStorage] = useState<RecordingStorage>();
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(''), [ruleMenu, setRuleMenu] = useState<AdminRule>(), [ruleRemove, setRuleRemove] = useState<AdminRule>();
  const ruleOpeners = useRef(new Map<string, View>()), ruleMenuOpener = useRef<View | null>(null);
  const reload = async () => {
    setError(undefined);
    try {
      const [nextTuners, nextPolicy, nextRules, nextSettings, nextStorage] = await Promise.all([controller.tuners(), controller.policy(), controller.rules(), controller.dvrSettings(), recordings.storage()]);
      if (!controller.lifetime.current()) return;
      setTuners(nextTuners); setPolicy(nextPolicy); setRules(nextRules); setSettings(nextSettings); setStorage(nextStorage);
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
  if (error !== undefined && !tuners && !policy) return <View style={{paddingHorizontal: 20, paddingTop: 20}}><StateView testID="live-owner-recording-error" {...runtime.error(error, () => void reload())}/></View>;
  return <View style={{paddingHorizontal: 20, paddingTop: 18, gap: 26}}>
    {error !== undefined && <StateView testID="live-owner-recording-error" {...runtime.error(error, () => void reload())}/>}
    <Section title={t('web.dvrSettings.tuners')} description={tuners ? t('web.dvrSettings.tunersLede', {hours: tuners.upcomingWindowHours}) : undefined}>
      {tuners?.sources.map(source => <TunerCard key={source.sourceId} source={source} runtime={runtime}/>)}
      {tuners && !tuners.sources.length && <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.dvrSettings.noTuners')}</Text>}
      {!tuners && error === undefined && <Text style={[shellType(13), {color: theme.colors.textTertiary}]}>{t('web.librarySettings.loading')}</Text>}
    </Section>
    {policy && <Permissions policy={policy} busy={busy} runtime={runtime} onWrite={(owner, enabled, inheritProfiles, revision) => write(`permission:${recordingOwnerKey(owner)}`, () => controller.setPermission(owner, enabled, inheritProfiles, revision))}/>}
    <Section title={t('web.recordingRules.title')} description={t('web.recordingRules.lede')}>
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
    {settings && <Defaults document={settings} busy={busy} runtime={runtime} onSave={value => write('defaults', async () => {const next = await controller.saveDvrSettings(settings.revision, value); if (controller.lifetime.current()) setSettings(next);})}/>}
    {storage && <Storage storage={storage} busy={busy} runtime={runtime} onSave={policy => write('storage', async () => {const next = await recordings.saveStorage(policy); if (controller.lifetime.current() && next) setStorage(await recordings.storage());})}/>}
    <Menu open={ruleMenu !== undefined} onOpenChange={value => {if (!value) setRuleMenu(undefined);}} title={ruleMenu?.name} anchorRef={ruleMenuOpener} presentation="sheet" testID="live-owner-rule-menu" items={ruleMenu ? [
      ...(policy ? [{id: 'toggle', icon: ruleMenu.enabled ? 'i-pause' as const : 'i-play' as const, label: t(ruleMenu.enabled ? 'web.recordingRules.pauseRule' : 'web.recordingRules.resumeRule'), onSelect: () => void write(`rule:${ruleMenu.id}`, () => controller.saveRuleEnabled(ruleMenu, policy.grants, !ruleMenu.enabled))}] : []),
      {id: 'separator', separator: true as const},
      {id: 'remove', icon: 'i-trash' as const, label: t('web.recordingRules.remove'), destructive: true, onSelect: () => setRuleRemove(ruleMenu)},
    ] : []}/>
    <Dialog open={ruleRemove !== undefined} onOpenChange={value => {if (!value && !busy) setRuleRemove(undefined);}} title={t('web.recordingRules.removeTitle', {name: ruleRemove?.name ?? ''})} description={t('web.recordingRules.removeBody')} testID="live-owner-rule-remove"
      footer={<View style={{flexDirection: 'row', gap: 10}}><Button variant="glass" textStyle={{color: theme.colors.record}} style={{backgroundColor: `${theme.colors.record}29`}} loading={busy.startsWith('rule')} onPress={() => {const rule = ruleRemove; if (!rule) return; void write(`rule:${rule.id}`, () => controller.deleteRule(rule)).then(() => {if (controller.lifetime.current()) setRuleRemove(undefined);});}}>{t('web.recordingRules.remove')}</Button><Button variant="glass" disabled={!!busy} onPress={() => setRuleRemove(undefined)}>{t('action.cancel')}</Button></View>}>
      <View/>
    </Dialog>
  </View>;
}

function Section({title, description, children}: {title: string; description?: string; children: React.ReactNode}) {
  const theme = useTheme();
  return <View style={{gap: 10}}>
    <Text style={[shellType(13, 700), {color: theme.colors.textTertiary}]}>{title}</Text>
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

/** Every profile the server lists, with its effective grant; an inherited profile reads as such. */
function Permissions({policy, busy, runtime, onWrite}: {policy: Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>; busy: string; runtime: NativeShellRuntime; onWrite: (owner: RecordingOwner, enabled: boolean, inheritProfiles: boolean, revision: number) => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const accounts = new Map<string, RecordingOwnerChoice[]>();
  for (const choice of policy.owners) {const key = choice.owner.accountId; accounts.set(key, [...(accounts.get(key) ?? []), choice]);}
  return <Section title={t('web.dvrSettings.whoCanRecord')} description={t('web.dvrSettings.whoCanRecordLede')}>
    {[...accounts.entries()].map(([accountId, profiles]) => {
      const primary = profiles[0]!, primaryGrant = policy.grants.find(grant => recordingOwnerKey(grant.owner) === recordingOwnerKey(primary.owner));
      return <View key={accountId} style={{gap: 4, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 10}}>
        <Text style={[shellType(12.5, 700), {color: theme.colors.textTertiary, paddingHorizontal: 6}]}>{primary.accountName}</Text>
        {profiles.map(choice => {
          const key = recordingOwnerKey(choice.owner), exact = policy.grants.find(grant => recordingOwnerKey(grant.owner) === key), allowed = recordingAllowed(choice.owner, policy.grants);
          return <View key={key} style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, minHeight: 44}}>
            <View style={{flex: 1}}>
              <Text style={[shellType(15, 600), {color: theme.colors.text}]} numberOfLines={1}>{choice.profileName}</Text>
              <Text style={[shellType(12.5), {color: theme.colors.textTertiary}]}>{exact ? t(exact.enabled ? 'recordings.on' : 'recordings.paused') : t('web.dvrSettings.inheritedFromAccount')}</Text>
            </View>
            <Switch testID={`live-owner-permission-${choice.owner.profileId}`} accessibilityLabel={choice.profileName} checked={allowed}
              disabled={!exact && !primaryGrant || busy === `permission:${key}`}
              onCheckedChange={enabled => onWrite(choice.owner, enabled, exact?.inheritProfiles ?? false, exact?.revision ?? 0)}/>
          </View>;
        })}
        <View style={{flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 6, paddingLeft: 18, minHeight: 40}}>
          <Text style={[shellType(13), {color: theme.colors.textSecondary, flex: 1}]}>{t('web.dvrSettings.inheritRow')}</Text>
          <Switch testID={`live-owner-inherit-${accountId}`} accessibilityLabel={t('web.dvrSettings.inheritSwitch')} checked={primaryGrant?.inheritProfiles ?? false}
            disabled={!primaryGrant?.enabled || busy === `permission:${recordingOwnerKey(primary.owner)}`}
            onCheckedChange={inheritProfiles => onWrite(primary.owner, primaryGrant?.enabled ?? false, inheritProfiles, primaryGrant?.revision ?? 0)}/>
        </View>
      </View>;
    })}
  </Section>;
}

function Defaults({document, busy, runtime, onSave}: {document: DVRDocument; busy: string; runtime: NativeShellRuntime; onSave: (value: DVRDefaults) => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const [draft, setDraft] = useState<DVRDefaults>(document.settings);
  useEffect(() => setDraft(document.settings), [document]);
  const patch = (value: Partial<DVRDefaults>) => setDraft(current => ({...current, ...value}));
  const dirty = JSON.stringify(draft) !== JSON.stringify(document.settings);
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
    <Button testID="live-owner-defaults-save" loading={busy === 'defaults'} disabled={!dirty} onPress={() => onSave(draft)}>{t('action.save')}</Button>
  </Section>;
}

function Storage({storage, busy, runtime, onSave}: {storage: RecordingStorage; busy: string; runtime: NativeShellRuntime; onSave: (policy: StoragePolicy) => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const [draft, setDraft] = useState<StoragePolicy>(storage.policy);
  useEffect(() => setDraft(storage.policy), [storage]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(storage.policy);
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
      <Select testID="live-owner-storage-retention" label={t('web.liveTv.keepRecordings')} description={t('web.liveTv.keepRecordingsHelp')} value={String(draft.retentionDays)} options={[0, 7, 14, 30, 60, 90, 365].map(value => ({value: String(value), label: String(value)}))} onValueChange={value => setDraft(current => ({...current, retentionDays: Number(value)}))}/>
      <Select testID="live-owner-storage-episodes" label={t('web.liveTv.episodesPerSeries')} description={t('web.liveTv.episodesPerSeriesHelp')} value={String(draft.episodeLimit)} options={[0, 1, 3, 5, 10, 20, 50].map(value => ({value: String(value), label: String(value)}))} onValueChange={value => setDraft(current => ({...current, episodeLimit: Number(value)}))}/>
      <Select testID="live-owner-storage-floor" label={t('web.liveTv.leaveFree')} description={t('web.liveTv.leaveFreeHelp')} value={String(gb(draft.floorBytes))} options={[0, 10, 20, 50, 100, 200].map(value => ({value: String(value), label: `${value} ${t('web.liveTv.gbUnit')}`}))} onValueChange={value => setDraft(current => ({...current, floorBytes: Number(value) * 1e9}))}/>
      <Select testID="live-owner-storage-cap" label={t('web.liveTv.capUpTo')} description={t('web.liveTv.capUpToHelp')} value={String(gb(draft.capBytes))} options={[0, 100, 250, 500, 1000, 2000].map(value => ({value: String(value), label: `${value} ${t('web.liveTv.gbUnit')}`}))} onValueChange={value => setDraft(current => ({...current, capBytes: Number(value) * 1e9}))}/>
    </View>
    <Button testID="live-owner-storage-save" loading={busy === 'storage'} disabled={!dirty} onPress={() => onSave(draft)}>{t('action.save')}</Button>
  </Section>;
}
