import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
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
import {appendRecordingPage, needsRuleOwner, rulePaddingChoice, rulePaddingFromChoice} from './recording-owner-model';
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
  const [ownerCursor, setOwnerCursor] = useState(''), [ruleCursor, setRuleCursor] = useState(''), [pageBusy, setPageBusy] = useState(false), [pageError, setPageError] = useState<'owners' | 'rules'>();
  const pageFlight = useRef<object | undefined>(undefined), ownerSeen = useRef(new Set<string>()), ruleSeen = useRef(new Set<string>()), pageEpoch = useRef(0);
  const [error, setError] = useState<unknown>(), [busy, setBusy] = useState(''), [ruleMenu, setRuleMenu] = useState<AdminRule>(), [newRule, setNewRule] = useState(false);
  // One rule-removal confirmation, exactly the rule it was drawn for; the flight keeps that same
  // opening so a delayed close or a second press cannot reach a successor.
  type RuleRemoveOpening = Readonly<{token: number; rule: AdminRule; controller: NativeLiveOwnerController; revision: number}>;
  const [ruleRemoveOpening, setRuleRemoveOpening] = useState<RuleRemoveOpening>();
  const ruleRemoveRef = useRef<RuleRemoveOpening | undefined>(undefined), ruleRemoveFlight = useRef<RuleRemoveOpening | undefined>(undefined), ruleRemoveToken = useRef(0), mounted = useRef(true);
  const ruleOwner = useRef(controller);
  useLayoutEffect(() => {mounted.current = true; return () => {mounted.current = false; ruleRemoveRef.current = undefined; ruleRemoveFlight.current = undefined;};}, []);
  const openRuleRemove = (rule: AdminRule) => {
    if (ruleRemoveFlight.current) return;
    const revision = runtime.navigation?.getSnapshot().revision;
    if (revision === undefined) return;
    const next: RuleRemoveOpening = {token: ++ruleRemoveToken.current, rule, controller, revision};
    // A fresh confirmation starts with no stale busy display from an orphaned write.
    if (!ruleRemoveFlight.current) setBusy('');
    ruleRemoveRef.current = next; setRuleRemoveOpening(next);
  };
  const closeRuleRemove = (target: RuleRemoveOpening) => {if (ruleRemoveRef.current !== target) return; ruleRemoveRef.current = undefined; setRuleRemoveOpening(current => current === target ? undefined : current);};
  if (ruleOwner.current !== controller) {ruleOwner.current = controller; ruleRemoveRef.current = undefined; ruleRemoveFlight.current = undefined;}
  const ruleRevision = runtime.navigation?.getSnapshot().revision;
  if (ruleRemoveRef.current && (ruleRemoveRef.current.revision !== ruleRevision || ruleRemoveRef.current.controller !== controller)) {ruleRemoveRef.current = undefined; ruleRemoveFlight.current = undefined;}
  const shownRuleRemove = ruleRemoveOpening && ruleRemoveRef.current === ruleRemoveOpening && ruleRemoveOpening.controller === controller && ruleRemoveOpening.revision === ruleRevision ? ruleRemoveOpening : undefined;
  const [permissionDraft, setPermissionDraft] = useState<Readonly<Record<string, Readonly<{enabled: boolean; inheritProfiles: boolean}>>>>({});
  const [defaultsDraft, setDefaultsDraft] = useState<DVRDefaults>(), [storageDraft, setStorageDraft] = useState<StoragePolicy>();
  const ruleOpeners = useRef(new Map<string, View>()), ruleMenuOpener = useRef<View | null>(null), confirmCancel = useRef<View>(null);
  const reload = async (reset = false) => {
    const epoch = ++pageEpoch.current; setPageError(undefined);
    setError(undefined);
    try {
      const [nextTuners, nextPolicy, nextRules, nextSettings, nextStorage] = await Promise.all([controller.tuners(), controller.policy(), controller.rules(), controller.dvrSettings(), recordings.storage()]);
      if (!controller.lifetime.current() || pageEpoch.current !== epoch) return;
      setTuners(nextTuners);
      setPolicy(current => {if (reset || !current) return nextPolicy; const first = new Set(nextPolicy.owners.map(row => recordingOwnerKey(row.owner))); return {...nextPolicy, owners: [...nextPolicy.owners, ...current.owners.filter(row => !first.has(recordingOwnerKey(row.owner)))]};});
      setRules(current => {if (reset || !current) return nextRules.items; const first = new Set(nextRules.items.map(row => row.id)); return [...nextRules.items, ...current.filter(row => !first.has(row.id))];});
      if (reset || !policy) {ownerSeen.current = new Set(); setOwnerCursor(nextPolicy.nextCursor);}
      if (reset || !rules) {ruleSeen.current = new Set(); setRuleCursor(nextRules.nextCursor);}
      setSettings(nextSettings); setStorage(nextStorage);
      setDefaultsDraft(current => current ?? nextSettings.settings); setStorageDraft(current => current ?? nextStorage.policy);
    } catch (failure) {if (controller.lifetime.current() && pageEpoch.current === epoch) setError(failure);}
  };
  useEffect(() => {pageFlight.current = undefined; setPageBusy(false); setPolicy(undefined); setRules(undefined); setOwnerCursor(''); setRuleCursor(''); void reload(true); return () => {pageEpoch.current++; pageFlight.current = undefined;};}, [controller, recordings]); // eslint-disable-line react-hooks/exhaustive-deps
  const pendingEdits = !!(Object.keys(permissionDraft).length || (settings && defaultsDraft && JSON.stringify(defaultsDraft) !== JSON.stringify(settings.settings)) || (storage && storageDraft && JSON.stringify(storageDraft) !== JSON.stringify(storage.policy)));
  const loadMore = async (kind: 'owners' | 'rules') => {
    const cursor = kind === 'owners' ? ownerCursor : ruleCursor;
    const seen = kind === 'owners' ? ownerSeen.current : ruleSeen.current;
    if (!cursor || seen.has(cursor) || pageFlight.current || busy || pendingEdits || ruleMenu || shownRuleRemove || (kind === 'rules' && newRule) || ruleRevision === undefined || runtime.navigation?.getSnapshot().revision !== ruleRevision || runtime.getSnapshot().contentVisible !== true || ruleOwner.current !== controller) return;
    const epoch = pageEpoch.current, revision = runtime.navigation?.getSnapshot().revision;
    const current = () => mounted.current && ruleOwner.current === controller && controller.lifetime.current() && runtime.getSnapshot().contentVisible === true && pageEpoch.current === epoch && runtime.navigation?.getSnapshot().revision === revision;
    const flight = {}; pageFlight.current = flight; setPageBusy(true); setPageError(undefined);
    try {
      if (kind === 'owners') {
        const page = await controller.policy(cursor); if (!current()) return;
        if (!policy || JSON.stringify(policy.grants) !== JSON.stringify(page.grants)) throw new Error('invalid_response');
        const owners = appendRecordingPage(policy.owners, page.owners, cursor, page.nextCursor, seen, row => recordingOwnerKey(row.owner));
        seen.add(cursor); setPolicy({...policy, owners}); setOwnerCursor(page.nextCursor);
      } else {
        const page = await controller.rules(cursor); if (!current()) return;
        if (!rules) throw new Error('invalid_response');
        const nextRules = appendRecordingPage(rules, page.items, cursor, page.nextCursor, seen, row => row.id);
        seen.add(cursor); setRules(nextRules); setRuleCursor(page.nextCursor);
      }
    } catch {if (current()) setPageError(kind);}
    finally {if (pageFlight.current === flight) {pageFlight.current = undefined; if (mounted.current) setPageBusy(false);}}
  };
  const write = async (key: string, work: () => Promise<unknown>, current: () => boolean = () => true) => {
    if (busy || pageFlight.current) return;
    const live = () => controller.lifetime.current() && current();
    setBusy(key); setError(undefined);
    try {await work(); if (live()) await reload();}
    catch (failure) {if (live()) setError(failure);}
    finally {if (live()) setBusy('');}
  };
  const saveAll = async () => {
    if (busy || pageFlight.current || !policy) return;
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
    {policy && <Permissions policy={policy} draft={permissionDraft} runtime={runtime} onChange={(owner, change) => !pageFlight.current && setPermissionDraft(current => ({...current, [recordingOwnerKey(owner)]: change}))}/>}
    {pageError && <Button disabled={pageBusy} onPress={() => void loadMore(pageError)}>{t('next.states.tryAgain')}</Button>}
    {!!ownerCursor && <Button disabled={pageBusy || !!busy || pendingEdits} onPress={() => void loadMore('owners')}>{t('next.settings.loadMore')}</Button>}
    <Section title={t('web.recordingRules.title')} description={t('web.recordingRules.lede')} action={policy && <Button testID="live-owner-new-rule" icon="i-plus" size="small" disabled={pageBusy} onPress={() => setNewRule(true)}>{t('web.recordingRules.newRule')}</Button>}>
      {rules?.map(rule => <Focusable key={rule.id} ref={node => {if (node) ruleOpeners.current.set(rule.id, node); else ruleOpeners.current.delete(rule.id);}} testID={`live-owner-rule-${rule.id}`} focusKind="row"
        onPress={() => {if (pageFlight.current) return; ruleMenuOpener.current = ruleOpeners.current.get(rule.id) ?? null; setRuleMenu(rule);}} style={{flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.colors.raised, borderRadius: 14, padding: 14}}>
        <View style={{flex: 1, gap: 4}}>
          <Text style={[shellType(15, 700), {color: theme.colors.text}]} numberOfLines={1}>{rule.name || rule.match}</Text>
          <Text style={[shellType(12.5), {color: theme.colors.textSecondary}]} numberOfLines={2}>{[needsRuleOwner(rule) ? t('web.recordingRules.chooseOwner') : t(rule.kind === 'title' ? 'web.recordingRules.titleMatch' : 'web.recordingRules.seriesKind'), rule.options.newEpisodesOnly ? t('web.recordingRules.newOnly') : '', rule.owner.authority ? ownerName(policy?.owners, rule.owner as RecordingOwner) ?? '' : ''].filter(Boolean).join(' · ')}</Text>
        </View>
        <Text style={[shellType(12.5, 700), {color: rule.enabled ? theme.colors.healthy : theme.colors.textTertiary}]}>{rule.enabled ? t('recordings.on') : t('web.recordingRules.pausedRule')}</Text>
      </Focusable>)}
      {!!ruleCursor && <Button disabled={pageBusy || !!busy || pendingEdits || newRule} onPress={() => void loadMore('rules')}>{t('next.settings.loadMore')}</Button>}
      {rules && !rules.length && <Text style={[shellType(13), {color: theme.colors.textSecondary}]}>{t('web.recordingRules.noRules')} {t('web.recordingRules.noRulesHelp')}</Text>}
    </Section>
    {settings && defaultsDraft && <Defaults document={settings} draft={defaultsDraft} runtime={runtime} onChange={value => {if (!pageFlight.current) setDefaultsDraft(value);}}/>}
    {storage && storageDraft && <Storage storage={storage} draft={storageDraft} runtime={runtime} onChange={value => {if (!pageFlight.current) setStorageDraft(value);}}/>}
    {settings && storage && <PendingBar count={Object.keys(permissionDraft).length + (JSON.stringify(defaultsDraft) !== JSON.stringify(settings.settings) ? 1 : 0) + (JSON.stringify(storageDraft) !== JSON.stringify(storage.policy) ? 1 : 0)}
      busy={busy === 'save' || pageBusy} onDiscard={() => {setPermissionDraft({}); setDefaultsDraft(settings.settings); setStorageDraft(storage.policy);}}
      onSave={() => void saveAll()} runtime={runtime}/>}
    <Menu open={ruleMenu !== undefined} onOpenChange={value => {if (!value) setRuleMenu(undefined);}} title={ruleMenu?.name} anchorRef={ruleMenuOpener} presentation="sheet" testID="live-owner-rule-menu" items={ruleMenu ? [
      ...(policy && !needsRuleOwner(ruleMenu) ? [{id: 'toggle', icon: ruleMenu.enabled ? 'i-pause' as const : 'i-play' as const, label: t(ruleMenu.enabled ? 'web.recordingRules.pauseRule' : 'web.recordingRules.resumeRule'), onSelect: () => void write(`rule:${ruleMenu.id}`, async () => {const saved = await controller.saveRuleEnabled(ruleMenu, policy.grants, !ruleMenu.enabled); if (controller.lifetime.current()) setRules(current => current?.map(row => row.id === saved.id ? saved : row));})}] : []),
      {id: 'separator', separator: true as const},
      {id: 'remove', icon: 'i-trash' as const, label: t('web.recordingRules.remove'), destructive: true, onSelect: () => openRuleRemove(ruleMenu)},
    ] : []}/>
    {policy && <NewRuleSheet controller={controller} runtime={runtime} policy={policy} sources={sources} ownerCursor={ownerCursor} ownerLoading={pageBusy} ownerError={pageError === 'owners'} onMoreOwners={() => void loadMore('owners')} open={newRule} onOpenChange={setNewRule}
      onSaved={() => {setNewRule(false); void reload();}}/>}
    <Dialog open={shownRuleRemove !== undefined} onOpenChange={value => {if (!value && !ruleRemoveFlight.current && shownRuleRemove) closeRuleRemove(shownRuleRemove);}} title={t('web.recordingRules.removeTitle', {name: shownRuleRemove?.rule.name ?? ''})} description={t('web.recordingRules.removeBody')} testID="live-owner-rule-remove" initialFocusRef={confirmCancel}
      footer={<View style={{flexDirection: 'row', gap: 10}}><Button ref={confirmCancel} variant="glass" disabled={!!busy} onPress={() => {if (shownRuleRemove) closeRuleRemove(shownRuleRemove);}}>{t('action.cancel')}</Button><Button variant="glass" textStyle={{color: theme.colors.record}} style={{backgroundColor: `${theme.colors.record}29`}} disabled={!!busy} loading={busy.startsWith('rule')} onPress={() => {
        const opening = shownRuleRemove;
        if (!mounted.current || !opening || ruleRemoveFlight.current || ruleRemoveRef.current !== opening) return;
        // Visibility, the route revision and the controller are re-read at the press.
        if (runtime.navigation?.getSnapshot().revision !== opening.revision) return;
        // Visibility and the controller are re-read at the press.
        if (runtime.getSnapshot().contentVisible !== true || !opening.controller.lifetime.current()) return;
        ruleRemoveFlight.current = opening;
        void write(`rule:${opening.rule.id}`, async () => {await opening.controller.deleteRule(opening.rule); if (opening.controller.lifetime.current() && ruleRemoveRef.current === opening) setRules(current => current?.filter(row => row.id !== opening.rule.id));},
          () => mounted.current && ruleRemoveFlight.current === opening && ruleRemoveRef.current === opening
            && opening.controller === controller && runtime.navigation?.getSnapshot().revision === opening.revision).then(
          () => {if (mounted.current && opening.controller.lifetime.current() && ruleRemoveRef.current === opening) closeRuleRemove(opening);},
          () => {}
        ).finally(() => {if (ruleRemoveFlight.current === opening) ruleRemoveFlight.current = undefined;});
      }}>{t('web.recordingRules.remove')}</Button></View>}>
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
  for (const choice of policy.owners) {const key = JSON.stringify([choice.owner.authority, choice.owner.accountId]); accounts.set(key, [...(accounts.get(key) ?? []), choice]);}
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
          <Switch testID={`live-owner-inherit-${primary.owner.accountId}`} accessibilityLabel={t('web.dvrSettings.inheritSwitch')} checked={primaryValue.inheritProfiles} disabled={!primaryValue.enabled}
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
export function NewRuleSheet({controller, runtime, policy, sources, ownerCursor, ownerLoading, ownerError, onMoreOwners, open, onOpenChange, onSaved}: {controller: NativeLiveOwnerController; runtime: NativeShellRuntime; policy?: Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]}>; sources?: readonly LiveSource[]; ownerCursor?: string; ownerLoading?: boolean; ownerError?: boolean; onMoreOwners?: () => void; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => void}) {
  const theme = useTheme(), t = runtime.text.t;
  const [ownPolicy, setOwnPolicy] = useState<Readonly<{owners: readonly RecordingOwnerChoice[]; grants: readonly RecordingGrant[]; nextCursor: string}>>(), [ownSources, setOwnSources] = useState<readonly LiveSource[]>();
  const [ownLoading, setOwnLoading] = useState(false), [ownError, setOwnError] = useState(false);
  const ownOpenRef = useRef(open); ownOpenRef.current = open;
  const ownRevision = runtime.navigation?.getSnapshot().revision;
  const ownController = useRef(controller);
  const ownEpoch = useRef(0), ownFlight = useRef<object | undefined>(undefined), ownSeen = useRef(new Set<string>());
  useEffect(() => {
    const changedController = ownController.current !== controller;
    if (changedController) {ownController.current = controller; ownEpoch.current++; ownSeen.current = new Set(); setOwnPolicy(undefined); setOwnSources(undefined);}
    if (open) setOwnLoading(false);
    if (!open || policy && sources || (!changedController && ownPolicy && ownSources)) return;
    let active = true; const epoch = ++ownEpoch.current; setOwnError(false);
    void Promise.all([controller.policy(), controller.load(true).then(() => controller.getSnapshot().list?.sources ?? [])]).then(([nextPolicy, nextSources]) => {if (active && ownEpoch.current === epoch && controller.lifetime.current()) {setOwnPolicy(nextPolicy); setOwnSources(nextSources);}}, () => {});
    return () => {active = false; ownEpoch.current++; ownFlight.current = undefined;};
  }, [open, policy, sources, controller]);
  const effectivePolicy = policy ?? (ownController.current === controller ? ownPolicy : undefined), effectiveSources = sources ?? (ownController.current === controller ? ownSources : undefined) ?? [];
  const loadOwnOwners = async () => {
    const cursor = ownPolicy?.nextCursor;
    if (!open || !ownOpenRef.current || policy || !ownPolicy || !cursor || ownFlight.current || ownSeen.current.has(cursor) || ownRevision === undefined || runtime.navigation?.getSnapshot().revision !== ownRevision || runtime.getSnapshot().contentVisible !== true) return;
    const epoch = ownEpoch.current, revision = runtime.navigation?.getSnapshot().revision;
    const current = () => ownOpenRef.current && ownEpoch.current === epoch && controller.lifetime.current() && runtime.getSnapshot().contentVisible === true && runtime.navigation?.getSnapshot().revision === revision;
    const flight = {}; ownFlight.current = flight; setOwnLoading(true); setOwnError(false);
    try {
      const page = await controller.policy(cursor); if (!current()) return;
      if (JSON.stringify(ownPolicy.grants) !== JSON.stringify(page.grants)) throw new Error('invalid_response');
      const owners = appendRecordingPage(ownPolicy.owners, page.owners, cursor, page.nextCursor, ownSeen.current, row => recordingOwnerKey(row.owner));
      ownSeen.current.add(cursor); setOwnPolicy({...ownPolicy, owners, nextCursor: page.nextCursor});
    } catch {if (current()) setOwnError(true);}
    finally {if (ownFlight.current === flight) {ownFlight.current = undefined; if (ownEpoch.current === epoch) setOwnLoading(false);}}
  };
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
    if (!ready || !chosen || !chosenOwner || ownerLoading || ownLoading) return;
    setBusy(true); setError(undefined);
    try {
      await controller.createRule({owner: chosenOwner.owner, anchor: chosen.anchor, kind: chosen.seriesId ? 'series' : 'title', name: name.trim(), match: chosen.seriesId || chosen.title, sourceId: chosen.anchor.sourceId, enabled: chosen.recordAvailable,
        options: {prePaddingMs: before, postPaddingMs: after, keepPolicy: kept, newEpisodesOnly: newOnly, priority: Math.round(Number(priority) || 0), folderTemplate: ''}}, effectivePolicy!.grants);
      onSaved();
    } catch (failure) {setError(failure);}
    finally {setBusy(false);}
  };
  const paddingOptions = [{value: 'default', label: t('web.recordingRules.default')}, ...[0, 60, 120, 300, 600, 900].map(value => ({value: String(value), label: value ? t('recordings.minutes', {count: value / 60}) : t('recordings.none')}))];
  return <Dialog open={open} onOpenChange={value => onOpenChange(value)} title={t('web.recordingRules.newTitle')} initialFocusRef={cancel} testID="live-owner-new-rule-sheet"
    footer={<View style={{flexDirection: 'row', gap: 10}}><Button ref={cancel} variant="glass" disabled={busy} onPress={() => onOpenChange(false)}>{t('action.cancel')}</Button><Button variant="primary" loading={busy} disabled={!ready || ownerLoading || ownLoading} onPress={() => void save()}>{t('action.save')}</Button></View>}>
    <View style={{gap: 12}}>
      {error !== undefined && <StateView testID="live-owner-new-rule-error" {...runtime.error(error, () => setError(undefined))}/>}
      <TextField testID="live-owner-new-rule-name" label={t('web.recordingRules.ruleName')} value={name} maxLength={160} onChangeText={setName}/>
      <Select testID="live-owner-new-rule-owner" label={t('web.recordingRules.recordFor')} pickerContext={(policy ? ownerCursor : ownPolicy?.nextCursor) ? <Button disabled={ownerLoading || ownLoading || busy} onPress={policy ? onMoreOwners : () => void loadOwnOwners()}>{t((policy ? ownerError : ownError) ? 'next.states.tryAgain' : 'next.settings.loadMore')}</Button> : undefined} value={owner} options={[{value: '', label: t('web.recordingRules.chooseProfile')}, ...allowed.map(value => ({value: recordingOwnerKey(value.owner), label: recordingOwnerLabel(value)}))]} onValueChange={setOwner}/>
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
      <Select testID="live-owner-new-rule-before" label={t('web.recordingRules.startEarlySeconds')} value={rulePaddingChoice(before)} options={paddingOptions} onValueChange={value => setBefore(rulePaddingFromChoice(value))}/>
      <Select testID="live-owner-new-rule-after" label={t('web.recordingRules.endLateSeconds')} value={rulePaddingChoice(after)} options={paddingOptions} onValueChange={value => setAfter(rulePaddingFromChoice(value))}/>
      <TextField testID="live-owner-new-rule-priority" label={t('web.recordingRules.priority')} description={t('web.recordingRules.priorityHelp')} keyboardType="number-pad" value={priority} onChangeText={setPriority}/>
      <Select testID="live-owner-new-rule-keep" label={t('recordings.keepLabel')} value={keepKey} options={[{value: 'default', label: t('web.recordingRules.useDefaults')}, {value: 'keep-all', label: t('web.logs.everything')}, {value: 'keep-count', label: t('web.recordingRules.latestFew')}, {value: 'keep-days', label: t('web.dvrSettings.keepDays')}]} onValueChange={setKeepKey}/>
    </View>
  </Dialog>;
}
