import type {MessageId} from '../../../../packages/i18n/src/index';

type Translate = (id: MessageId, values?: Record<string, string | number>) => string;

/**
 * How many titles a list holds, in words: "1,204 movies". A broad filter is counted by the server
 * only up to 10,000 (Justin, 14 October); past that the total is a lower bound and reads
 * "10,000+ movies" everywhere it is shown, while the list itself keeps growing as pages arrive.
 */
export function browseCountLabel(t: Translate, count: number, pivot: string, atLeast = false): string {
  return t(atLeast ? 'lib.countAtLeast' : 'lib.count', {count, pivot});
}

/** A group's titles in words ("12 titles", or "10,000+ titles" for a lower bound). */
export function titleCountLabel(t: Translate, count: number, atLeast = false): string {
  return atLeast ? t('lib.countAtLeast', {count, pivot: 'other'}) : t('count.titles', {count});
}

/** A music genre's songs ("312 songs", or "10,000+ songs" when the genre was counted only that far). */
export function songCountLabel(t: Translate, count: number, atLeast = false): string {
  return atLeast ? t('lib.countAtLeast', {count, pivot: 'songs'}) : t('title.songCount', {count});
}
