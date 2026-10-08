import {useEffect, useMemo, useState} from 'react';
import {DAY_MS, MINUTE_MS, TIERS, type TierThresholds} from '../../../../../packages/client-core/src/guide/index';
import {useI18n} from '../../app/i18n';
import {localTimezone} from '../../app/channels';

/**
 * Guide labels in this device's time zone, with the Intl formatters built once per zone: a guide
 * draws hundreds of times, and a formatter per call is slow on Hermes.
 */
export function useGuideFormat() {
  const i18n = useI18n();
  const zone = localTimezone();
  return useMemo(() => {
    const make = (options: Intl.DateTimeFormatOptions) => { try { return new Intl.DateTimeFormat(i18n.region.formatLocale, {...options, timeZone: zone}); } catch { return undefined; } };
    const time = make({hour: 'numeric', minute: '2-digit', ...(i18n.region.hour12 !== undefined ? {hour12: i18n.region.hour12} : {})});
    const weekday = make({weekday: 'short', day: 'numeric', month: 'short'});
    let dayKeyFormat: Intl.DateTimeFormat | undefined;
    try { dayKeyFormat = new Intl.DateTimeFormat('en-CA', {year: 'numeric', month: '2-digit', day: '2-digit', timeZone: zone}); } catch {}
    const dayKey = (ms: number) => (dayKeyFormat ? dayKeyFormat.format(new Date(ms)) : new Date(ms).toISOString().slice(0, 10));
    const clock = (ms: number) => (time ? time.format(new Date(ms)) : i18n.time(ms));
    const dayLabel = (ms: number, now = Date.now()) => {
      const key = dayKey(ms);
      if (key === dayKey(now)) return i18n.t('guide.today');
      if (key === dayKey(now + DAY_MS)) return i18n.t('guide.tomorrow');
      if (key === dayKey(now - DAY_MS)) return i18n.t('guide.yesterday');
      return weekday ? weekday.format(new Date(ms)) : i18n.date(ms, 'weekday');
    };
    const range = (a: number, b: number) => i18n.t('guide.range', {start: clock(a), end: clock(b)});
    const minutes = (ms: number) => Math.max(1, Math.round(ms / MINUTE_MS));
    /** "22 min left", or "2h 7m left" past an hour. */
    const timeLeft = (ms: number) => (ms < 60 * MINUTE_MS ? i18n.t('guide.minutesLeft', {count: minutes(ms)}) : i18n.t('guide.timeLeft', {time: i18n.duration(Math.round(ms / MINUTE_MS) * 60, 'short')}));
    return {zone, clock, dayKey, dayLabel, range, minutes, timeLeft, t: i18n.t};
  }, [i18n, zone]);
}
export type GuideFormat = ReturnType<typeof useGuideFormat>;

/** A clock that ticks every `stepMs` (the now line and progress move; cells are not re-laid out by it alone). */
export function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), stepMs); return () => clearInterval(id); }, [stepMs]);
  return now;
}

/**
 * Guide geometry (Spec §3.1). TV is designed on the 1920×1080 canvas. These move to
 * `packages/design` `guideSpec` with the web's when F-core adds it.
 */
export type GuideGeometry = Readonly<{column: number; channel: number; row: number; ruler: number; gap: number; tiers: TierThresholds; nowLine: number; progress: number}>;
export const GEOMETRY = {
  // TV: the 360 px channel column sits inside the 80 px page gutter, so the column starts where the header does.
  tv: {column: 360, channel: 440, row: 120, ruler: 64, gap: 4, tiers: TIERS.tv, nowLine: 4, progress: 4},
  tablet: {column: 240, channel: 220, row: 72, ruler: 40, gap: 2, tiers: TIERS.standard, nowLine: 2, progress: 2},
  phoneLandscape: {column: 180, channel: 150, row: 64, ruler: 36, gap: 2, tiers: TIERS.standard, nowLine: 2, progress: 2},
} as const satisfies Record<string, GuideGeometry>;

/** Initials for a channel with no logo; a stable tint from the channel id (§2.1). */
export function initials(name: string): string {
  // No Unicode property escapes: Hermes' support for them varies by version.
  const words = name.split(/[\s\-_.,:;/|·•()[\]&+!?'"]+/).filter(Boolean);
  return (words.length > 1 ? words[0]![0]! + words[1]![0]! : (words[0] ?? '?').slice(0, 2)).toUpperCase();
}
export function tintIndex(id: string, count: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % count;
}

/** "S2 E5 · The Arrival" (§3.3), or the on-screen episode text. */
export function episodeLine(p: {episode?: {season?: number; number?: number; display?: string}; subtitle?: string} | undefined): string {
  if (!p) return '';
  const e = p.episode;
  const code = e ? (e.season && e.number ? `S${e.season} E${e.number}` : e.display ?? '') : '';
  return [code, p.subtitle].filter(Boolean).join(' · ');
}
