import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import type {GuideChannel, GuideProgramme} from '../../../../packages/client-core/src/channel-guide';
import {nowNextProgrammes, programmeRangeLabel} from '../../../../packages/client-core/src/presentation/index';
import {useI18n} from '../app/i18n';
import {useTheme, ListRow, Sheet, StateView} from '../ui';
import {channelStep, tunedChannel, type Lineup} from './channel-lineup';
import type {PlayerEngine} from './usePlayer';

/** The programme on now on a tuned channel (null outside programmes or guide gaps). */
export function currentLiveProgramme(channel: GuideChannel, nowMs = Date.now()): GuideProgramme | null {
  for (const p of channel.programmes) {
    const startMs = Date.parse(p.start), endMs = Date.parse(p.end);
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= nowMs && nowMs < endMs) return p;
  }
  return null;
}

type Row = {channel: GuideChannel; lineup?: Lineup; current: boolean; now: {title: string; startMs: number; endMs: number} | null; next: {title: string; startMs: number} | null};

/**
 * MU4 FEAT-07: the mini guide over the video. Three rows — previous, current,
 * next channel with now/next programme — tuning on select. It reads the
 * guide's own lineup through the stepping accessor (O(visible): three rows),
 * and hands the lineup back on tune so stepping keeps working.
 */
export function MiniGuideSheet({open, onClose, engine}: {open: boolean; onClose: () => void; engine: PlayerEngine}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const [rows, setRows] = useState<Row[] | null>(null);
  useEffect(() => {
    if (!open) { setRows(null); return; }
    let live = true;
    const nowMs = Date.now();
    const programmesOf = (channel: GuideChannel) => {
      const list = channel.programmes.flatMap(p => {
        const startMs = Date.parse(p.start), endMs = Date.parse(p.end);
        return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs ? [{id: p.id, title: p.title, startMs, endMs}] : [];
      });
      return nowNextProgrammes(list, nowMs);
    };
    void Promise.all([channelStep(-1), channelStep(1)]).then(([prev, next]) => {
      if (!live) return;
      const current = tunedChannel();
      const ordered = [
        current ? {channel: current, lineup: undefined as Lineup | undefined, current: true} : null,
        prev ? {...prev, current: false} : null,
        next ? {...next, current: false} : null,
      ].filter((r): r is {channel: GuideChannel; lineup: Lineup | undefined; current: boolean} => !!r);
      const seen = new Set<string>();
      setRows(ordered.filter(r => {
        const key = `${r.channel.sourceId}/${r.channel.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).map(r => ({...r, ...programmesOf(r.channel)})));
    }, () => { if (live) setRows([]); });
    return () => { live = false; };
  }, [open]);
  const bare = (ms: number) => {
    try {
      const parts = new Intl.DateTimeFormat(i18n.locale, {hour: 'numeric', minute: '2-digit'}).formatToParts(new Date(ms));
      return parts.filter(p => p.type !== 'dayPeriod').map(p => p.value).join('').replace(/\s+/g, ' ').trim() || i18n.time(ms);
    } catch { return i18n.time(ms); }
  };
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('player.live.guide')} kind="picker">
      <View style={{gap: space.xs}}>
        {rows === null ? <StateView loading title={i18n.t('player.live.guide')} /> : null}
        {rows !== null && !rows.length ? <StateView icon="channels" title={i18n.t('guide.noInformation')} /> : null}
        {rows?.map(r => {
          const head = [r.channel.number, r.channel.name].filter(Boolean).join(' · ');
          return (
            <ListRow
              key={`${r.channel.sourceId}/${r.channel.id}`}
              icon="channels"
              title={head}
              subtitle={r.now ? `${r.now.title} · ${programmeRangeLabel(r.now.startMs, r.now.endMs, (ms, meridiem) => (meridiem ? i18n.time(ms) : bare(ms)))}` : i18n.t('guide.noInformation')}
              description={r.next ? i18n.t('guide.next', {title: r.next.title, time: i18n.time(r.next.startMs)}) : undefined}
              trailingIcon="forward"
              onPress={() => { engine.tune(r.channel, r.lineup); onClose(); }}
            />
          );
        })}
      </View>
    </Sheet>
  );
}
