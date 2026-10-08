import type {ContentEntry} from '../../../../../packages/client-core/src/library-content';
import type {WorkspaceSeason} from '../../../../../packages/client-core/src/show-workspace';
import type {I18n} from '../../app/i18n';

/**
 * Pure helpers for the title pages (Spec — Title Pages): facts lines, episode labels, season
 * order and the next-up rule. No React, so they can be tested and shared by every title type.
 */

/** "S2 E4", "E4" (no season) or "" (no number). */
export function episodeCode(i18n: I18n, entry: Pick<ContentEntry, 'seasonNumber' | 'episodeNumber' | 'absoluteNumber'>): string {
  // A show numbered across its seasons says "Episode 1043", never a season.
  if (entry.absoluteNumber != null) return i18n.t('title.episodeAbsolute', {number: entry.absoluteNumber});
  if (entry.episodeNumber == null) return '';
  if (entry.seasonNumber != null && entry.seasonNumber > 0) return i18n.t('title.episodeCode', {season: entry.seasonNumber, episode: entry.episodeNumber});
  return i18n.t('title.episodeOnly', {episode: entry.episodeNumber});
}

/** "Season 2" or "Specials"; the server's own title wins when it has one. */
export function seasonLabel(i18n: I18n, season: Pick<WorkspaceSeason, 'number' | 'title'>): string {
  if (season.number === 0) return i18n.t('title.specials');
  return season.title || i18n.t('title.season', {number: season.number});
}

/** Spec §2: Specials (season 0) go last; the rest keep the server's order. */
export function orderSeasons<T extends Pick<WorkspaceSeason, 'number'>>(seasons: readonly T[]): T[] {
  return [...seasons.filter(s => s.number !== 0), ...seasons.filter(s => s.number === 0)];
}

/**
 * Next up within the loaded episodes (the Continue Watching rule, until the show projection
 * carries it): the episode in progress, else the first unwatched, else nothing.
 */
export function nextUpIn(entries: readonly ContentEntry[]): ContentEntry | undefined {
  return entries.find(e => e.playback && (e.progressSeconds ?? 0) > 0 && !e.watched) ?? entries.find(e => e.playback && !e.watched);
}

/** Fraction watched, for the thin bar under a Resume label. */
export function resumeFraction(entry: Pick<ContentEntry, 'progressSeconds' | 'duration' | 'watched'> | undefined): number | undefined {
  if (!entry || entry.watched || !entry.duration || !entry.progressSeconds) return undefined;
  return Math.max(0, Math.min(1, entry.progressSeconds / entry.duration));
}

/** `·`-separated facts, dropping blanks (spec §1). */
export function factsLine(parts: readonly (string | number | undefined | null | false)[]): string {
  return parts.filter(p => p !== undefined && p !== null && p !== false && p !== '').map(String).join(' · ');
}

/** Names from credits in one department ("Directing", "Writing"), in server order. */
export function namesIn<T extends {name: string; department: string}>(credits: readonly T[], departments: readonly string[]): string[] {
  const wanted = departments.map(d => d.toLowerCase());
  const out: string[] = [];
  for (const c of credits) if (wanted.includes(c.department.toLowerCase()) && !out.includes(c.name)) out.push(c.name);
  return out;
}

export const isActing = (department: string) => ['acting', 'cast', 'actors'].includes(department.toLowerCase());

/**
 * M32 (web parity, WEB-DETAIL-05): the crew shelf's credit order —
 * Directing, Writing, Screenplay, Creator, Composer, Producer. A credit
 * takes its best (lowest) rank; anything else (property masters,
 * editors…) is crew, not key crew.
 */
export function crewRank(department: string, role: string): number {
  const d = department.trim().toLowerCase();
  const r = role.trim().toLowerCase();
  if (d === 'directing' || r.includes('director')) return 0;
  if (d === 'writing' || r.includes('writ')) return 1;
  if (r.includes('screenplay')) return 2;
  if (d === 'creator' || r.includes('creator') || r.includes('created by')) return 3;
  if (d === 'music' || r.includes('composer')) return 4;
  if (r.includes('producer') || (d === 'production' && r === '')) return 5;
  return -1;
}

/** Key crew in credit order: one row per person, at most 8. */
export function keyCrew<T extends {personId?: string; name: string; department: string; role: string}>(credits: readonly T[]): T[] {
  const ranked = credits.map(c => ({c, rank: crewRank(c.department, c.role)})).filter(x => x.rank >= 0);
  ranked.sort((a, b) => a.rank - b.rank);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const {c} of ranked) {
    const key = c.personId ?? `name:${c.name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= 8) break;
  }
  return out;
}
