import type {SettingsPage, SettingsRow, SettingsSection, SettingsStructure} from '../../../../../packages/client-core/src/presentation/index';
import type {MessageId} from '../../../../../packages/i18n/src/index';

/**
 * Rows this app draws that the shared Settings structure (`settings-structure.ts`) still lists
 * for the web alone, although phones, tablets and televisions honour them now:
 *
 * - **Card size** and **Show backdrops** (Appearance): the shell applies both (`AppearanceProvider`).
 * - **Subtitle size and background** (Audio & Subtitles): every player engine draws captions in
 *   this style, on top of the device's own Accessibility caption settings.
 *
 * Each row is the shared one, word for word: the same keys, choices, labels and scope. They are
 * added here only until the shared structure names these platforms itself; a row the structure
 * already carries is never added twice, and a setting this server does not publish is left out.
 */
const CARD_SIZE: SettingsRow = {
  kind: 'composite', id: 'cardSize', storage: 'registry', label: 'settings.row.cardSize', scope: 'deviceClass',
  control: {type: 'choice', choices: [{value: 'small', label: 'settings.cardSize.small'}, {value: 'medium', label: 'settings.cardSize.medium'}, {value: 'large', label: 'settings.cardSize.large'}]},
};
const BACKDROPS: SettingsRow = {kind: 'preference', key: 'appearance.showBackdrops', label: 'pref.label.appearance.showBackdrops', help: 'settings.help.backdrops', scope: 'deviceClass', control: {type: 'switch'}};
const SUBTITLE_SIZE: SettingsRow = {kind: 'preference', key: 'playback.subtitleSize', label: 'settings.row.subtitleSize', control: {type: 'choice', choices: (['small', 'medium', 'large', 'extra-large'] as const).map(value => ({value, label: `settings.subtitleSize.${value}` as MessageId}))}};
const SUBTITLE_BACKGROUND: SettingsRow = {kind: 'preference', key: 'playback.subtitleBackground', label: 'settings.row.subtitleBackground', control: {type: 'choice', choices: (['none', 'translucent', 'opaque'] as const).map(value => ({value, label: `settings.subtitleBackground.${value}` as MessageId}))}};

const carries = (page: SettingsPage, test: (row: SettingsRow) => boolean) => page.sections.some(section => section.rows.some(test));
const isPreference = (key: string) => (row: SettingsRow) => row.kind === 'preference' && row.key === key;

/** `keys`: the preferences this server publishes, once known (absent: not known yet, nothing is left out). */
export function withNativeRows(structure: SettingsStructure, keys?: ReadonlySet<string>): SettingsStructure {
  const published = (key: string) => !keys || keys.has(key);
  const page = (given: SettingsPage): SettingsPage => {
    if (given.id === 'appearance') {
      const added: SettingsRow[] = [];
      if (published('appearance.cardSizePercent') && !carries(given, row => row.kind === 'composite' && row.id === 'cardSize')) added.push(CARD_SIZE);
      if (published('appearance.showBackdrops') && !carries(given, isPreference('appearance.showBackdrops'))) added.push(BACKDROPS);
      if (!added.length) return given;
      // They lead the page's first group, as on the web.
      const [first, ...rest] = given.sections;
      const sections: SettingsSection[] = first && !first.advanced ? [{...first, rows: [...added, ...first.rows]}, ...rest] : [{id: 'look', rows: added}, ...given.sections];
      return {...given, sections};
    }
    if (given.id === 'languages') {
      const added: SettingsRow[] = [];
      if (published('playback.subtitleSize') && !carries(given, isPreference('playback.subtitleSize'))) added.push(SUBTITLE_SIZE);
      if (published('playback.subtitleBackground') && !carries(given, isPreference('playback.subtitleBackground'))) added.push(SUBTITLE_BACKGROUND);
      if (!added.length) return given;
      const at = given.sections.findIndex(section => section.id === 'appearance');
      if (at >= 0) return {...given, sections: given.sections.map((section, index) => (index === at ? {...section, rows: [...section.rows, ...added]} : section))};
      return {...given, sections: [...given.sections, {id: 'appearance', title: 'settings.section.subtitleAppearance', rows: added}]};
    }
    return given;
  };
  let changed = false;
  const headings = structure.headings.map(heading => {
    const pages = heading.pages.map(given => { const next = page(given); if (next !== given) changed = true; return next; });
    return changed ? {...heading, pages} : heading;
  });
  return changed ? {headings} : structure;
}
