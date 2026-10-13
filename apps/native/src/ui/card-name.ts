import {uiI18n} from './i18n';

/**
 * The spoken name of a card or media row: its title and caption, then what its artwork shows
 * about it (that its files are not there, the watched tick, the progress line, a badge), which
 * are otherwise seen and never heard. The same rule as the web card (`cardName`).
 */
export function cardName(title: string, o: {subtitle?: string; watched?: boolean; progress?: number; badge?: string; unavailable?: boolean} = {}): string {
  const i18n = uiI18n();
  let name = o.subtitle ? `${title}, ${o.subtitle}` : title;
  const add = (state: string) => { name = i18n.t('card.nameWithState', {name, state}); };
  if (o.unavailable) add(i18n.t('card.unavailable'));
  const watched = i18n.t('card.watched');
  // A badge that already says "Watched" is not said twice.
  if (o.badge && o.badge !== watched) add(o.badge);
  if (o.watched || o.badge === watched) add(watched);
  else if (o.progress && o.progress > 0) add(i18n.t('card.progress', {progress: i18n.percent(Math.min(1, o.progress))}));
  return name;
}
