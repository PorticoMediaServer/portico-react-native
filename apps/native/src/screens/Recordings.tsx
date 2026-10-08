import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {activeRecording, countUnwatched, dvrMessage, mutableRecording, playableRecording, recordingReason, recordingStateLabel, type DVRPage, type Recording, type RecordingDetail, type RecordingRule, type RecordingStorage, type RuleConfig} from '../../../../packages/client-core/src/dvr';
import {formatBytes, useArtwork} from '../app/content';
import {useDVRClient} from '../app/dvr';
import {useI18n} from '../app/i18n';
import {usePlayerActions} from '../app/player-actions';
import {useSession} from '../app/session';
import {groupRecordings, isExceptionBadge, dvrPaddings, dvrLimits} from './channels/dvr-groups';
import {Badge, Button, ConfirmSheet, Divider, ListRow, Menu, Notice, Page, PageHeader, ProgressBar, Segmented, Sheet, StateView, Surface, Text, afterOverlaysClose, useEntryFocus, useTheme} from '../ui';
import {closeLanguageMenu} from './settings/language-picker-handoff';

type View_ = 'upcoming' | 'recorded' | 'rules' | 'storage';

/**
 * FEAT-02 (Apple): the DVR's own workspace, a peer of the guide. Upcoming recordings (conflicts
 * first, as their own group) resolve or cancel; finished ones play; series rules edit, pause and
 * delete; storage shows what is left. Through `DVRClient`, as web does. TV focus reaches every
 * action; iPhone uses sheets.
 */
export function RecordingsScreen({eyebrow, picker}: {/** Channels (Spec §2.0): the destination's name above the title. */ eyebrow?: string; /** Channels: the phone source picker under the title. */ picker?: React.ReactNode} = {}) {
  const navigation = useNavigation();
  const dvr = useDVRClient();
  const player = usePlayerActions();
  const i18n = useI18n();
  const {space} = useTheme();
  const artwork = useArtwork();
  const {session} = useSession();
  const manager = session?.viewer.role === 'owner' || session?.viewer.role === 'admin';
  const [view, setView] = useState<View_>('upcoming');
  const [page, setPage] = useState<DVRPage>();
  const [storage, setStorage] = useState<RecordingStorage>();
  const [error, setError] = useState('');
  const [cancelling, setCancelling] = useState<Recording>();
  const [details, setDetails] = useState<Recording>();
  const [conflict, setConflict] = useState<Recording>();
  const [editing, setEditing] = useState<RecordingRule | null>(null);
  // Switching tabs while a read is in flight: only the latest read may land; the list clears
  // first so the old tab never shows under the new one (FEAT-08).
  const generation = useRef(0);
  // PERF-S15: pages follow the server's cursor (Previous / Next), so every recording is reachable.
  const [cursors, setCursors] = useState<readonly string[]>(['']);
  const cursor = cursors[cursors.length - 1] ?? '';
  useEffect(() => { setCursors(['']); }, [view]);
  const load = useCallback(() => {
    if (!dvr) return;
    const mine = ++generation.current;
    setError('');
    if (view === 'storage') {
      dvr.storage().then(s => { if (mine === generation.current) setStorage(s); }, e => { if (mine === generation.current) setError(dvrMessage(e)); });
    } else {
      dvr.list(view, cursor).then(p => { if (mine === generation.current) setPage(p); }, e => { if (mine === generation.current) setError(dvrMessage(e)); });
    }
  }, [dvr, view, cursor]);
  useEffect(() => { setPage(undefined); setStorage(undefined); load(); }, [load]);
  const recordings = page?.recordings ?? [];
  const rules = page?.rules ?? [];
  const loaded = view === 'storage' ? !!storage : !!page;
  // FEAT-08: show rows group by seriesId and expand to episodes.
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  useEffect(() => { setExpanded([]); }, [view]);
  const showGroups = useMemo(() => (view !== 'recorded' ? null : groupRecordings(recordings)), [view, recordings]);
  // TV: the first recording takes focus once the list arrives (the Segmented above stays one Up away).
  const claim = useEntryFocus(recordings.length > 0 || rules.length > 0);
  const conflicted = recordings.filter(r => r.state === 'conflicted' || r.conflicts.length);
  const rest = recordings.filter(r => !conflicted.includes(r));
  const firstId = [...conflicted, ...rest][0]?.id;
  const isConflict = (r: Recording) => r.state === 'conflicted' || r.conflicts.length > 0;
  const durationOf = (r: Recording) => {
    const ms = Date.parse(r.end) - Date.parse(r.start);
    return Number.isFinite(ms) && ms > 0 ? i18n.t('recordings.minutes', {count: Math.max(1, Math.round(ms / 60000))}) : '';
  };
  // Part 2.2: episode subtitle with the channel name when the server provides it.
  const episodeSubtitle = (r: Recording) => [r.channel?.name || '', i18n.dateTime(r.start), durationOf(r), r.bytes > 0 && !activeRecording(r) ? formatBytes(r.bytes) : '', recordingReason(r.reason) || undefined].filter(Boolean).join(' · ');
  // Part 2.2: grouped show rows count only watched===false as unwatched; null is neither.
  const groupSubtitle = (items: readonly Recording[]) => {
    const unwatched = countUnwatched(items);
    return unwatched > 0 ? i18n.t('recordings.showCountUnwatched', {count: items.length, unwatched}) : i18n.t('recordings.showCount', {count: items.length});
  };
  const badgeFor = (r: Recording) => {
    // FEAT-08: Recorded shows badges only for exceptions (Failed, Incomplete) plus Kept.
    // Upcoming keeps its state badges (Scheduled, Tuner conflict, Recording).
    if (view === 'recorded' && !isExceptionBadge(r) && !r.keep) return null;
    return (
      <View style={{flexDirection: 'row', alignItems: 'center', gap: space.xs}}>
        {r.keep ? <Badge label={i18n.t('recordings.kept')} tone="neutral" /> : null}
        {view === 'recorded' && !isExceptionBadge(r) ? null : <Badge label={recordingStateLabel(r.state)} tone={r.state === 'recording' ? 'record' : r.state === 'failed' ? 'amber' : 'neutral'} />}
      </View>
    );
  };
  const posterFor = (r: Recording) => (r.itemId ? artwork(`/v1/items/${encodeURIComponent(r.itemId)}/art/poster`) : undefined);
  const row = (r: Recording, focusId?: string) => {
    // FEAT-08: a published recording shows its poster; otherwise the state icon.
    const poster = posterFor(r);
    return (
      <ListRow
        key={r.id}
        hasTVPreferredFocus={claim && r.id === (focusId ?? firstId)}
        source={poster}
        shape="poster"
        icon={poster ? undefined : r.state === 'recording' ? 'dvr' : playableRecording(r) ? 'play' : 'calendar'}
      title={r.programme.title}
      subtitle={view === 'recorded' ? episodeSubtitle(r) : [r.channel?.name || '', i18n.dateTime(r.start), recordingReason(r.reason) || undefined].filter(Boolean).join(' · ')}
      trailing={badgeFor(r)}
      // Every row has an action, so each can take focus on TV: play what's finished, resolve
      // what conflicts, cancel what's scheduled or still recording (what's recorded so far is
      // kept), and show details for the rest.
      onPress={playableRecording(r) ? () => player.play(r.itemId, 0) : isConflict(r) ? () => setConflict(r) : mutableRecording(r) || activeRecording(r) ? () => setCancelling(r) : () => setDetails(r)}
      />
    );
  };
  const group = (title: string | undefined, items: Recording[]) => (items.length ? (
    <View style={{gap: space.xs}}>
      {title ? <Notice tone="warning" title={title} message={i18n.t('recordings.conflictsBody')} /> : null}
      <Surface padded={false}>
        {items.map((r, i) => (
          <View key={r.id}>
            {i ? <Divider inset={space.md} /> : null}
            {row(r)}
          </View>
        ))}
      </Surface>
    </View>
  ) : null);
  const ruleHelp = (rule: RecordingRule) => [
    rule.config.episodes === 'new' ? i18n.t('recordings.newEpisodes') : i18n.t('recordings.allEpisodes'),
    rule.config.options.episodeLimit ? i18n.t('recordings.keepLatest', {count: rule.config.options.episodeLimit}) : '',
    rule.config.keywords.join(', '),
  ].filter(Boolean).join(' · ');
  // FEAT-08: Upcoming rest groups under day section headers (conflicts stay first).
  const UpcomingDays = ({items}: {items: Recording[]}) => {
    const order: string[] = [];
    const byDay = new Map<string, Recording[]>();
    for (const r of items) {
      const day = i18n.date(r.start);
      if (!byDay.has(day)) { byDay.set(day, []); order.push(day); }
      byDay.get(day)!.push(r);
    }
    if (!order.length) return null;
    return (
      <View style={{gap: space.xs}}>
        {order.map(day => (
          <View key={day} style={{gap: space.xs}}>
            <Text variant="bodyStrong" tone="secondary">{day}</Text>
            <Surface padded={false}>
              {byDay.get(day)!.map((r, i) => (
                <View key={r.id}>
                  {i ? <Divider inset={space.md} /> : null}
                  {row(r)}
                </View>
              ))}
            </Surface>
          </View>
        ))}
      </View>
    );
  };
  return (
    <View style={{flex: 1}}>
      <Page>
        <PageHeader eyebrow={eyebrow} title={i18n.t('recordings.title')} onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined} />
        {picker}
        <View style={{paddingHorizontal: space.page, gap: space.lg}}>
          <Segmented items={[{id: 'upcoming', label: i18n.t('recordings.upcoming')}, {id: 'recorded', label: i18n.t('recordings.recorded')}, {id: 'rules', label: i18n.t('recordings.rules')}, {id: 'storage', label: i18n.t('recordings.storage')}]} selected={view} onSelect={id => setView(id as View_)} />
          {!dvr ? <StateView icon="dvr" title={i18n.t('recordings.unavailableTitle')} message={i18n.t('recordings.unavailableBody')} /> : null}
          {error ? <Notice tone="warning" message={error} action={i18n.t('action.tryAgain')} onAction={load} /> : null}
          {dvr && !loaded && !error ? <StateView loading title={i18n.t('recordings.loading')} /> : null}
          {page && view !== 'rules' && view !== 'storage' && !recordings.length ? (
            <StateView icon="dvr" title={i18n.t(view === 'upcoming' ? 'recordings.noneScheduled' : 'recordings.noneRecorded')} message={i18n.t(view === 'upcoming' ? 'recordings.noneScheduledBody' : 'recordings.noneRecordedBody')} />
          ) : null}
          {page && view === 'rules' && !rules.length ? (
            <StateView icon="dvr" title={i18n.t('recordings.noneRules')} message={i18n.t('recordings.noneRulesBody')} />
          ) : null}
          {page && !page.captureAvailable && page.captureUnavailableReason && view === 'upcoming' ? <Notice tone="info" message={recordingReason(page.captureUnavailableReason)} /> : null}
          {page && view === 'upcoming' ? (<>{group(i18n.t('recordings.conflicts'), conflicted)}<UpcomingDays items={rest} /></>) : null}
          {page && view === 'recorded' && showGroups ? (
            <View style={{gap: space.xs}}>
              {showGroups.map(g => {
                const first = g.items[0]!;
                const open = expanded.includes(g.key);
                if (g.items.length === 1) return <Surface key={first.id} padded={false}>{row(first)}</Surface>;
                // FEAT-08: the show row carries the first episode's poster, as web does.
                const showPoster = posterFor(first);
                return (
                  <Surface key={g.key} padded={false}>
                    <ListRow source={showPoster} shape="poster" icon={showPoster ? undefined : 'dvr'} title={g.title} subtitle={groupSubtitle(g.items)} trailingIcon={open ? 'chevronDown' : 'forward'} onPress={() => setExpanded(e => (open ? e.filter(k => k !== g.key) : [...e, g.key]))} />
                    {open ? g.items.map((r, i) => (
                      <View key={r.id}>
                        <Divider inset={space.md} />
                        <View style={{paddingLeft: space.lg}}>{row(r)}</View>
                        {i === g.items.length - 1 ? null : null}
                      </View>
                    )) : null}
                  </Surface>
                );
              })}
            </View>
          ) : null}
          {page && view === 'rules' && rules.length ? (
            <Surface padded={false}>
              {rules.map((rule, i) => (
                <View key={rule.id}>
                  {i ? <Divider inset={space.md} /> : null}
                  <ListRow
                    hasTVPreferredFocus={claim && i === 0}
                    icon="repeat"
                    title={rule.config.name}
                    subtitle={ruleHelp(rule) || undefined}
                    trailing={<Badge label={i18n.t(rule.config.enabled ? 'recordings.on' : 'recordings.paused')} tone={rule.config.enabled ? 'accent' : 'neutral'} />}
                    onPress={() => setEditing(rule)}
                  />
                </View>
              ))}
            </Surface>
          ) : null}
          {view === 'storage' && storage ? <StorageView storage={storage} manager={manager} /> : null}
          {view !== 'storage' && (cursors.length > 1 || page?.nextCursor) ? (
            <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm}}>
              <Button variant="ghost" size="sm" icon="back" label={i18n.t('title.previousPage')} disabled={cursors.length < 2} onPress={() => setCursors(c => c.slice(0, -1))} />
              <Button variant="ghost" size="sm" trailingIcon="forward" label={i18n.t('title.nextPage')} disabled={!page?.nextCursor} onPress={() => { const next = page?.nextCursor; if (next) setCursors(c => [...c, next].slice(-1000)); }} />
            </View>
          ) : null}
        </View>
      </Page>
      <Sheet open={!!details} onClose={() => setDetails(undefined)} title={details?.programme.title} kind="form" cancelLabel={null} primary={{label: i18n.t('recordings.done'), onPress: () => setDetails(undefined)}}>
        {details ? (
          <View>
            <ListRow title={i18n.t('recordings.state')} meta={recordingStateLabel(details.state)} />
            <ListRow title={i18n.t('recordings.when')} meta={i18n.dateTime(details.start)} />
            {recordingReason(details.reason) ? <ListRow title={i18n.t('recordings.why')} subtitle={recordingReason(details.reason)} /> : null}
          </View>
        ) : null}
      </Sheet>
      <ConfirmSheet open={!!cancelling} onDismiss={() => setCancelling(undefined)} title={i18n.t('recordings.cancelTitle', {title: cancelling?.programme.title ?? ''})} consequence={i18n.t(cancelling && activeRecording(cancelling) && cancelling.state === 'recording' ? 'recordings.cancelKeepsRecorded' : 'recordings.cancelNotRecorded')} confirmLabel={i18n.t('recordings.cancelAction')} onConfirm={async () => { if (dvr && cancelling) { await dvr.cancel(cancelling); load(); } }} />
      {conflict ? <ConflictSheet recording={conflict} onClose={() => setConflict(undefined)} onChanged={() => { setConflict(undefined); load(); }} /> : null}
      {editing ? <RuleSheet rule={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </View>
  );
}

/** FEAT-02: a tuner conflict names what overlaps and lets the viewer pick which one records. */
function ConflictSheet({recording, onClose, onChanged}: {recording: Recording; onClose: () => void; onChanged: () => void}) {
  const dvr = useDVRClient();
  const i18n = useI18n();
  const {space} = useTheme();
  const [detail, setDetail] = useState<RecordingDetail>();
  const [busy, setBusy] = useState<'raise' | 'skip' | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!dvr) return;
    dvr.detail(recording.id).then(setDetail, e => setError(dvrMessage(e)));
  }, [dvr, recording.id]);
  const run = async (kind: 'raise' | 'skip') => {
    if (!dvr) return;
    setBusy(kind); setError('');
    try {
      if (kind === 'skip') await dvr.cancel(recording);
      else await dvr.update(recording, {...recording.options, priority: Math.min(1000, Math.max(recording.options.priority, ...detail!.overlaps.map(o => o.priority)) + 1)});
      onChanged();
    } catch (e) { setError(dvrMessage(e)); } finally { setBusy(null); }
  };
  const tuners = detail?.capacity.known ? detail.capacity.effective : undefined;
  return (
    <Sheet open onClose={onClose} title={i18n.t('recordings.conflictTitle', {title: recording.programme.title})} kind="form" cancelLabel={null} primary={{label: i18n.t('recordings.recordThis'), loading: busy === 'raise', disabled: !!busy || !detail, onPress: () => void run('raise')}}>
      <View style={{gap: space.md}}>
        {error ? <Notice tone="danger" message={error} /> : null}
        {!detail && !error ? <StateView loading title={i18n.t('recordings.loading')} /> : null}
        {detail ? <Text variant="body" tone="secondary">{tuners !== undefined ? i18n.t('recordings.conflictBodyTuners', {count: tuners}) : i18n.t('recordings.conflictBody')}</Text> : null}
        {detail?.overlaps.length ? (
          <Surface padded={false}>
            {detail.overlaps.map((o, i) => (
              <View key={o.id}>
                {i ? <Divider inset={space.md} /> : null}
                <ListRow icon="dvr" title={o.title} subtitle={i18n.dateTime(o.start)} />
              </View>
            ))}
          </Surface>
        ) : null}
        <Button variant="secondary" label={i18n.t('recordings.skipThis')} loading={busy === 'skip'} disabled={!!busy} onPress={() => void run('skip')} />
      </View>
    </Sheet>
  );
}

/** FEAT-02: a series rule's episodes, how many to keep and its padding, edited in one place. */
function RuleSheet({rule, onClose, onSaved}: {rule: RecordingRule; onClose: () => void; onSaved: () => void}) {
  const dvr = useDVRClient();
  const i18n = useI18n();
  const {space} = useTheme();
  const [config, setConfig] = useState<RuleConfig>(rule.config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [matches, setMatches] = useState<number | null>(null);
  const [picking, setPicking] = useState<'keep' | 'before' | 'after' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // One sheet at a time: the editor steps aside while a choice menu is open and comes back once the
  // menu has finished dismissing (as the language picker does).
  const [formHidden, setFormHidden] = useState(false);
  const openPicker = (which: 'keep' | 'before' | 'after') => { setFormHidden(true); setPicking(which); };
  const closePicker = () => closeLanguageMenu({clearMenu: () => setPicking(null), defer: fn => { setTimeout(fn, 0); }, gate: {runAfterClose: fn => { afterOverlaysClose(fn); }}, reopenList: () => setFormHidden(false)});
  useEffect(() => {
    if (!dvr) return;
    // FEAT-02: the live preview updates at most once per 400 ms of edits, never per keystroke.
    let live = true;
    const id = setTimeout(() => { dvr.preview(config).then(p => { if (live) setMatches(p.matches); }, () => { if (live) setMatches(null); }); }, 400);
    return () => { live = false; clearTimeout(id); };
  }, [dvr, config]);
  const minutes = (seconds: number) => (seconds ? i18n.t('recordings.minutes', {count: seconds / 60}) : i18n.t('recordings.none'));
  const keepLabel = config.options.episodeLimit ? i18n.t('recordings.keepLatest', {count: config.options.episodeLimit}) : i18n.t('recordings.keepAll');
  const save = async (next: RuleConfig = config) => {
    if (!dvr) return;
    setBusy(true); setError('');
    try { await dvr.saveRule(rule.id, rule.revision, next); onSaved(); } catch (e) { setError(dvrMessage(e)); } finally { setBusy(false); }
  };
  const toggle = () => void save({...config, enabled: !config.enabled});
  return (
    <>
      <Sheet open={!confirmDelete && !formHidden} onClose={onClose} title={config.name} kind="form" cancelLabel={null} primary={{label: i18n.t('action.save'), loading: busy, onPress: () => void save()}}>
        <View style={{gap: space.md}}>
          {error ? <Notice tone="danger" message={error} /> : null}
          {matches !== null ? <Text variant="body" tone="secondary">{i18n.t('recordings.matches', {count: matches})}</Text> : null}
          <Segmented accessibilityLabel={i18n.t('recordings.editRule')} items={[{id: 'new', label: i18n.t('recordings.newEpisodes')}, {id: 'all', label: i18n.t('recordings.allEpisodes')}]} selected={config.episodes} onSelect={v => setConfig(c => ({...c, episodes: v as 'all' | 'new'}))} />
          <Button variant="secondary" label={`${i18n.t('recordings.keepLabel')}: ${keepLabel}`} onPress={() => openPicker('keep')} />
          <Button variant="secondary" label={`${i18n.t('recordings.startEarly')}: ${minutes(config.options.beforeSeconds)}`} onPress={() => openPicker('before')} />
          <Button variant="secondary" label={`${i18n.t('recordings.endLate')}: ${minutes(config.options.afterSeconds)}`} onPress={() => openPicker('after')} />
          <View style={{flexDirection: 'row', gap: space.sm}}>
            <Button variant="secondary" label={i18n.t(config.enabled ? 'recordings.pauseRule' : 'recordings.resumeRule')} disabled={busy} onPress={toggle} />
            <Button variant="destructive" label={i18n.t('recordings.deleteRule')} disabled={busy} onPress={() => setConfirmDelete(true)} />
          </View>
        </View>
      </Sheet>
      <Menu
        open={picking !== null}
        onClose={closePicker}
        title={i18n.t(picking === 'keep' ? 'recordings.keepLabel' : picking === 'before' ? 'recordings.startEarly' : 'recordings.endLate')}
        items={(picking === 'keep' ? dvrLimits.map(n => ({id: String(n), label: n ? i18n.t('recordings.keepLatest', {count: n}) : i18n.t('recordings.keepAll'), selected: config.options.episodeLimit === n})) : dvrPaddings.map(n => ({id: String(n), label: minutes(n), selected: (picking === 'before' ? config.options.beforeSeconds : config.options.afterSeconds) === n})))}
        onSelect={id => {
          const n = Number(id);
          if (picking === 'keep') setConfig(c => ({...c, options: {...c.options, episodeLimit: n}}));
          else if (picking === 'before') setConfig(c => ({...c, options: {...c.options, beforeSeconds: n}}));
          else if (picking === 'after') setConfig(c => ({...c, options: {...c.options, afterSeconds: n}}));
          closePicker();
        }}
      />
      <DeleteRuleSheet rule={rule} open={confirmDelete} onClose={() => setConfirmDelete(false)} onDeleted={onSaved} />
    </>
  );
}

function DeleteRuleSheet({rule, open, onClose, onDeleted}: {rule: RecordingRule; open: boolean; onClose: () => void; onDeleted: () => void}) {
  const dvr = useDVRClient();
  const i18n = useI18n();
  const {space} = useTheme();
  const [future, setFuture] = useState<'keep' | 'cancel'>('keep');
  useEffect(() => { if (open) setFuture('keep'); }, [open]);
  return (
    <ConfirmSheet open={open} onDismiss={onClose} title={i18n.t('recordings.deleteRuleTitle', {name: rule.config.name})} consequence={i18n.t('recordings.deleteRuleBody')} confirmLabel={i18n.t('recordings.deleteRule')} onConfirm={async () => { if (dvr) { await dvr.deleteRule(rule, future); onDeleted(); } }}>
      <View style={{gap: space.sm}}>
        <Segmented items={[{id: 'keep', label: i18n.t('recordings.keepUpcoming')}, {id: 'cancel', label: i18n.t('recordings.cancelUpcoming')}]} selected={future} onSelect={v => setFuture(v as 'keep' | 'cancel')} />
      </View>
    </ConfirmSheet>
  );
}

/** FEAT-02: how much recording space is used and roughly how much is left. */
function StorageView({storage, manager}: {storage: RecordingStorage; manager: boolean}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const {usedBytes, freeBytes} = storage.measurement;
  const total = usedBytes + freeBytes;
  return (
    <View style={{gap: space.md}}>
      <Surface padded={false}>
        <ListRow title={i18n.t('recordings.storageUsed', {used: formatBytes(usedBytes), free: formatBytes(freeBytes)})} subtitle={storage.forecastHours > 0 ? i18n.t('recordings.hoursLeft', {count: Math.floor(storage.forecastHours)}) : undefined} />
        {total > 0 ? <View style={{paddingHorizontal: space.md, paddingBottom: space.sm}}><ProgressBar value={usedBytes / total} /></View> : null}
        {storage.pendingDeleteBytes > 0 ? <ListRow icon="trash" title={i18n.t('recordings.pendingDelete', {size: formatBytes(storage.pendingDeleteBytes)})} /> : null}
        {!storage.measurement.writeHealthy ? <ListRow icon="warning" title={i18n.t('recordings.writeUnhealthy')} /> : null}
        {manager && storage.policy.retentionDays ? <ListRow icon="clock" title={i18n.t('recordings.retention', {count: storage.policy.retentionDays})} /> : null}
      </Surface>
    </View>
  );
}
