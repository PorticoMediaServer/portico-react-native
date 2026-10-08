import React, {useRef, useState} from 'react';
import {View} from 'react-native';
import {defaultRecordingOptions, seriesRuleConfig, dvrMessage, type RecordingDraft} from '../../../../../packages/client-core/src/dvr';
import type {ChannelSource} from '../../../../../packages/client-core/src/guide/index';
import {sourceName, useReminders, type RawIndex, type Reminder} from '../../app/channels';
import {useArtwork} from '../../app/content';
import {useDVRClient} from '../../app/dvr';
import {Artwork, Badge, Button, Menu, Notice, Segmented, Sheet, Text, showToast, useSpecPlatform, useTheme, type FocusableHandle} from '../../ui';
import {ChannelLogo, ChannelName, channelReason} from './parts';
import {episodeLine, type GuideFormat} from './format';
import {dvrLimits, dvrPaddings} from './dvr-groups';
import type {Selection} from './GuideGrid';
import {afterOverlaysClose} from '../../ui/Sheet';
import {closeLanguageMenu} from '../settings/language-picker-handoff';

/**
 * The program sheet (Spec §3.5): side sheet on TV and iPad, half sheet on phones. Actions in
 * order, each only when allowed; "Watch live" on an unavailable channel stays, disabled, with the
 * reason. TV opens on the primary action (Watch live, or Record for a future program).
 */
export function ProgramSheet({selection, format, raw, sources, showSource, quiet, onClose, onWatch, onChanged, onFavorite, onRecordings}: {selection: Selection; format: GuideFormat; raw: RawIndex; sources: readonly ChannelSource[]; showSource: boolean; /** FEAT-01: the screen explains a server-wide reason once. */ quiet: boolean; onClose: () => void; onWatch: (s: Selection) => void; onChanged: () => void; onFavorite: (s: Selection) => void; onRecordings?: () => void}) {
  const {space, isTV} = useTheme();
  const platform = useSpecPlatform();
  const placement = platform === 'phone' ? 'auto' : 'side';
  const t = format.t;
  const {channel, program} = selection;
  const dvr = useDVRClient();
  const artwork = useArtwork();
  const reminders = useReminders();
  const now = Date.now();
  const rawChannel = raw.channels.get(channel.id);
  const rawProgram = program ? raw.programmes.get(program.id) : undefined;
  const airing = !!program && program.start <= now && program.end > now;
  const ended = !!program && program.end <= now;
  const future = !!program && program.start > now;
  const [busy, setBusy] = useState<'one' | 'series' | 'cancel' | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'one' | 'series' | 'canceled' | null>(null);
  const [recordAsk, setRecordAsk] = useState(false);
  const [seriesAsk, setSeriesAsk] = useState(false);
  const [episodes, setEpisodes] = useState<'new' | 'all'>('new');
  const [anyChannel, setAnyChannel] = useState(false);
  // FEAT-02: padding for a one-time record and keep + padding for a series rule, from the same
  // bounded choices as the rule editor (`dvrPaddings`/`dvrLimits`, within `validRecordingOptions`).
  const [keep, setKeep] = useState(0);
  const [beforeSeconds, setBeforeSeconds] = useState(0);
  const [afterSeconds, setAfterSeconds] = useState(0);
  const [picking, setPicking] = useState<'keep' | 'before' | 'after' | null>(null);
  // The overlay system shows one sheet at a time: the form steps aside while its choice menu is
  // open, and comes back only once the menu has finished dismissing (as the language picker does).
  const [formHidden, setFormHidden] = useState(false);
  const openPicker = (which: 'keep' | 'before' | 'after') => { setFormHidden(true); setPicking(which); };
  const closePicker = () => closeLanguageMenu({clearMenu: () => setPicking(null), defer: fn => { setTimeout(fn, 0); }, gate: {runAfterClose: fn => { afterOverlaysClose(fn); }}, reopenList: () => setFormHidden(false)});
  const minutes = (seconds: number) => (seconds ? t('recordings.minutes', {count: seconds / 60}) : t('recordings.none'));
  const keepLabel = keep ? t('recordings.keepLatest', {count: keep}) : t('recordings.keepAll');
  const canRecord = !!dvr && !!rawChannel && !!rawProgram && channel.kind === 'live' && channel.recordAvailable && !ended;
  const draft: RecordingDraft | undefined = rawChannel && rawProgram ? {channel: rawChannel, programme: rawProgram, series: false} : undefined;
  const scheduled = (!!program?.recording && done !== 'canceled') || done === 'one';
  const record = async (kind: 'one' | 'series' | 'cancel') => {
    if (!dvr || !draft || busy) return;
    setBusy(kind); setError('');
    try {
      if (kind === 'one') await dvr.schedule(draft, {...defaultRecordingOptions, beforeSeconds, afterSeconds});
      else if (kind === 'series') {
        // The series options map through the shared `seriesRuleConfig`, as web does.
        const {config, anchor} = seriesRuleConfig({...draft, series: true}, {episodes, keep, beforeSeconds, afterSeconds, anyChannel});
        await dvr.saveRule(await dvr.newRuleID(), 0, config, anchor);
      }
      else if (program?.recording?.id) await dvr.cancel((await dvr.detail(program.recording.id)).recording);
      setDone(kind === 'cancel' ? 'canceled' : kind); setSeriesAsk(false); setRecordAsk(false);
      if (kind !== 'cancel') showToast({message: kind === 'one' ? t('guide.scheduledBody') : t('guide.seriesSet'), icon: 'dvr', ...(onRecordings ? {action: {label: t('guide.viewRecordings'), onPress: onRecordings}} : {})});
      onChanged();
    } catch (e) { setError(dvrMessage(e)); } finally { setBusy(null); }
  };
  const pickItems = picking === 'keep'
    ? dvrLimits.map(n => ({id: String(n), label: n ? t('recordings.keepLatest', {count: n}) : t('recordings.keepAll'), selected: keep === n}))
    : dvrPaddings.map(n => ({id: String(n), label: minutes(n), selected: (picking === 'before' ? beforeSeconds : afterSeconds) === n}));
  const pick = (id: string) => {
    const n = Number(id);
    if (picking === 'keep') setKeep(n);
    else if (picking === 'before') setBeforeSeconds(n);
    else if (picking === 'after') setAfterSeconds(n);
    closePicker();
  };
  const reason = channelReason(channel, quiet);
  const description = rawProgram?.description ?? '';
  const when = program ? `${format.dayLabel(program.start, now)}, ${format.range(program.start, program.end)}` : '';
  const flags = program?.flags ?? {};
  const episode = episodeLine(program);
  // Programme facts are static per programme (PERF-07: safe as props). Year, rating and the
  // first 3 categories read as one line; the star rating keeps its own badge when present.
  const facts = program ? [program.year ? String(program.year) : '', program.rating ?? '', (program.categories ?? []).slice(0, 3).join(', ')].filter(Boolean).join(' · ') : '';
  const watchLabel = channel.kind === 'library' ? t('channels.watch') : !program || future || ended ? t('guide.watchChannel') : t('guide.watchLive');
  const showWatch = !program || airing || ended || !channel.tuneAvailable;
  const reminder: Reminder | undefined = program ? {programId: program.id, channelId: channel.id, title: program.title, channelName: channel.name, start: program.start} : undefined;
  const reminded = !!program && reminders.has(program.id);
  const primaryRef = useRef<FocusableHandle>(null);
  const recordPrimary = !showWatch && canRecord && !scheduled;
  // TV opens on the first action that can be used: Watch, else Record, else Remind me, else Favorite.
  const focusFirst: 'watch' | 'record' | 'remind' | 'favorite' = showWatch && channel.tuneAvailable ? 'watch' : canRecord && !scheduled ? 'record' : future && reminder ? 'remind' : 'favorite';

  if (seriesAsk) {
    return (
      <>
        <Sheet open={!formHidden} onClose={() => setSeriesAsk(false)} title={t('guide.recordSeriesTitle')} subtitle={program?.title} kind="form" placement={placement} primary={{label: t('guide.recordSeriesTitle'), onPress: () => void record('series'), loading: busy === 'series'}}>
          <View style={{gap: space.md}}>
            <Segmented accessibilityLabel={t('guide.recordSeriesTitle')} items={[{id: 'new', label: t('guide.newOnly')}, {id: 'all', label: t('guide.allEpisodes')}]} selected={episodes} onSelect={v => setEpisodes(v as 'new' | 'all')} />
            <Segmented accessibilityLabel={t('guide.recordSeriesTitle')} items={[{id: 'this', label: t('guide.thisChannel')}, {id: 'any', label: t('guide.anyChannel')}]} selected={anyChannel ? 'any' : 'this'} onSelect={v => setAnyChannel(v === 'any')} />
            <Button variant="secondary" label={`${t('recordings.keepLabel')}: ${keepLabel}`} onPress={() => openPicker('keep')} />
            <Button variant="secondary" label={`${t('recordings.startEarly')}: ${minutes(beforeSeconds)}`} onPress={() => openPicker('before')} />
            <Button variant="secondary" label={`${t('recordings.endLate')}: ${minutes(afterSeconds)}`} onPress={() => openPicker('after')} />
            {error ? <Notice tone="error" message={error} /> : null}
          </View>
        </Sheet>
        <Menu open={picking !== null} onClose={closePicker} title={t(picking === 'keep' ? 'recordings.keepLabel' : picking === 'before' ? 'recordings.startEarly' : 'recordings.endLate')} items={pickItems} onSelect={pick} />
      </>
    );
  }

  if (recordAsk) {
    return (
      <>
        <Sheet open={!formHidden} onClose={() => setRecordAsk(false)} title={t('guide.record')} subtitle={program?.title} kind="form" placement={placement} primary={{label: t('guide.record'), onPress: () => void record('one'), loading: busy === 'one'}}>
          <View style={{gap: space.md}}>
            <Button variant="secondary" label={`${t('recordings.startEarly')}: ${minutes(beforeSeconds)}`} onPress={() => openPicker('before')} />
            <Button variant="secondary" label={`${t('recordings.endLate')}: ${minutes(afterSeconds)}`} onPress={() => openPicker('after')} />
            {error ? <Notice tone="error" message={error} /> : null}
          </View>
        </Sheet>
        <Menu open={picking !== null} onClose={closePicker} title={t(picking === 'before' ? 'recordings.startEarly' : 'recordings.endLate')} items={pickItems} onSelect={pick} />
      </>
    );
  }

  return (
    <Sheet open onClose={onClose} title={program?.title ?? channel.name} placement={placement} detent="half" kind="picker" onShown={() => { if (isTV) primaryRef.current?.focus(); }}>
      <View style={{gap: space.md, paddingHorizontal: isTV ? 0 : space.md}}>
        <View style={{flexDirection: 'row', alignItems: 'center', gap: space.md}}>
          <ChannelLogo channel={channel} size={isTV ? 72 : 44} />
          <View style={{flex: 1, minWidth: 0}}>
            <ChannelName channel={channel} variant="bodyStrong" prefix={channel.number || undefined} />
            {showSource ? <Text variant="caption" tone="tertiary" lines={1}>{sourceName(sources, channel.sourceId)}</Text> : null}
          </View>
        </View>
        {program ? (
          <View style={{gap: space.xs}}>
            {program.image ? <Artwork source={artwork(program.image)} shape="poster" width={120} title={program.title} /> : null}
            {episode ? <Text variant="bodyStrong">{episode}</Text> : null}
            <Text variant="body" tone="secondary">{when}</Text>
            {facts ? <Text variant="body" tone="secondary">{facts}</Text> : null}
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: space.xs}}>
              {airing ? <Badge label={t('guide.onNow')} tone="record" /> : null}
              {flags.live ? <Badge label={t('guide.live')} tone="record" /> : null}
              {flags.new ? <Badge label={t('guide.new')} tone="accent" /> : null}
              {flags.premiere ? <Badge label={t('guide.premiere')} tone="accent" /> : null}
              {program.rating ? <Badge label={program.rating} /> : null}
              {(program.categories ?? []).slice(0, 3).map(c => <Badge key={c} label={c} />)}
              {program.starRating ? <Badge label={t('guide.starRating', {value: program.starRating})} /> : null}
              {scheduled ? <Badge label={t('guide.recordingScheduled')} tone="record" /> : null}
            </View>
            {airing ? <Text variant="caption" tone="secondary">{t('guide.startedLeft', {started: format.minutes(now - program.start), left: format.minutes(program.end - now)})}</Text> : null}
          </View>
        ) : <Text variant="body" tone="secondary">{t('guide.noInformation')}</Text>}
        {reason ? <Notice tone="warning" message={reason} /> : null}
        {error ? <Notice tone="error" message={error} /> : null}
        <View style={{flexDirection: isTV ? 'column' : 'row', flexWrap: 'wrap', alignItems: isTV ? 'stretch' : 'center', gap: space.sm}}>
          {showWatch ? <Button ref={focusFirst === 'watch' ? primaryRef : undefined} variant="primary" icon="play" label={watchLabel} disabled={!channel.tuneAvailable} onPress={() => { onClose(); onWatch(selection); }} /> : null}
          {canRecord && scheduled && program?.recording ? <Button variant="secondary" icon="close" label={t('web.dvr.cancelRecording')} loading={busy === 'cancel'} disabled={!!busy} onPress={() => void record('cancel')} /> : null}
          {canRecord && !scheduled ? <Button ref={focusFirst === 'record' ? primaryRef : undefined} variant={recordPrimary ? 'primary' : 'secondary'} icon="dvr" label={t('guide.record')} loading={busy === 'one'} disabled={!!busy} onPress={() => setRecordAsk(true)} /> : null}
          {canRecord && program?.seriesId && done !== 'series' ? <Button variant="secondary" icon="repeat" label={t('guide.recordSeries')} disabled={!!busy} onPress={() => setSeriesAsk(true)} /> : null}
          {future && reminder ? <Button ref={focusFirst === 'remind' ? primaryRef : undefined} variant="secondary" icon={reminded ? 'close' : 'bell'} label={reminded ? t('guide.stopRemind') : t('guide.remind')} onPress={() => reminders.toggle(reminder)} /> : null}
          <Button ref={focusFirst === 'favorite' ? primaryRef : undefined} variant="ghost" icon={channel.favorite ? 'starFilled' : 'star'} label={channel.favorite ? t('channels.removeFavorite') : t('channels.addFavorite')} onPress={() => { onFavorite(selection); onClose(); }} />
        </View>
        {reminded ? <Text variant="caption" tone="tertiary">{t('guide.reminderSet')}</Text> : null}
        {program ? <Text variant="body" tone={description ? 'secondary' : 'tertiary'}>{description || t('guide.noDescription')}</Text> : null}
      </View>
    </Sheet>
  );
}
