import {defaultI18n} from '../../../../../packages/i18n/src';
import {episodeLabel, type TextEnvironment} from '../../../../../packages/client-core/src/presentation/kit-model';
import type {GuideProgram} from '../../../../../packages/client-core/src/guide/types';

/** Source69 TV guide clocks omit the day period in the ruler/cells. Sheets retain the full
 * canonical programme range. Only format actual instants, in the device's genuine zone. */
export function nativeGuideClock(locale: string, timeZone: string, hour12?: boolean, omitDayPeriod = true): (at: number) => string | undefined {
  let formatter: Intl.DateTimeFormat;
  try {formatter = new Intl.DateTimeFormat(locale, {hour: 'numeric', minute: '2-digit', timeZone, ...(hour12 === undefined ? {} : {hour12})});}
  catch {return () => undefined;}
  return at => Number.isFinite(at) && Number.isFinite(new Date(at).getTime())
    ? formatter.formatToParts(at).filter(part => !omitDayPeriod || part.type !== 'dayPeriod').map(part => part.value).join('').replace(/[\u00a0\u202f]/g, ' ').trim()
    : undefined;
}
/** Separate facts keep the drawn spacing and the stored episode subtitle intact. */
export function nativeProgrammeCaption(programme: GuideProgram | undefined, onNow: boolean, isTV: boolean, clock: (at: number) => string | undefined, text: TextEnvironment): readonly string[] {
  if (!programme) return [];
  const episode = programme.episode?.number === undefined ? undefined : episodeLabel({mode: 'seasonal', season: programme.episode.season, episode: programme.episode.number}, 'ordinary', text)?.text;
  if (episode || programme.subtitle) return [episode, programme.subtitle].filter((value): value is string => !!value);
  const start = clock(programme.start), end = clock(programme.end);
  if (!end) return [];
  return !isTV && onNow ? [defaultI18n.t('guide.ends', {time: end})] : start ? [defaultI18n.t('guide.range', {start, end})] : [];
}
