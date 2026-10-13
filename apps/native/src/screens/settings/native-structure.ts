import {settingsStructure, type SettingsContext, type SettingsPage, type SettingsRow, type SettingsSection, type SettingsStructure} from '../../../../../packages/client-core/src/presentation/index';
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

/**
 * The owner's administration on phones and tablets (Justin, 14 Oct 2026): Integrations, Metadata,
 * what is in use and where things are kept, downloads person by person, Restart, titles set
 * aside, client reports, and a member's own access tokens. The shared structure still lists these
 * for the web alone. They are taken from it as authored (the web's own pages and sections, word
 * for word, in the web's order), so nothing about them is written a second time here; when the
 * shared structure names phones itself, each is already present and nothing is added.
 *
 * Television is given none of them: its Server heading stays the read-only Dashboard.
 */
const OWNER_PAGES: readonly string[] = ['metadata', 'integrations'];
const OWNER_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  'account/profile': ['tokens'],
  'server/storage': ['usage', 'places', 'downloadUsage'],
  'server/troubleshooting': ['setAside', 'clientReports'],
  'server/general': ['restart'],
};
/** What a phone listed only for want of the page that now holds it: the keys list under People moves to Integrations, as on the web. */
const MOVED_SECTIONS: Readonly<Record<string, Readonly<{to: string; sections: readonly string[]}>>> = {'server/people': {to: 'integrations', sections: ['apiKeys']}};

/** Places `added` after the nearest entry before it in `order` that `present` already has, else first. */
function placed<T extends {id: string}>(present: readonly T[], added: T, order: readonly string[]): T[] {
  let at = 0;
  for (let i = order.indexOf(added.id) - 1; i >= 0; i--) {
    const found = present.findIndex(entry => entry.id === order[i]);
    if (found >= 0) { at = found + 1; break; }
  }
  return [...present.slice(0, at), added, ...present.slice(at)];
}

/** A page's sub-pages after its sections changed: one with no section left is gone, and a single one is not a choice. */
function withTabs(page: SettingsPage, sections: readonly SettingsSection[], tabs = page.tabs): SettingsPage {
  const {tabs: _tabs, ...rest} = page;
  const kept = tabs?.filter(tab => sections.some(section => section.tab === tab.id));
  return {...rest, ...(kept && kept.length > 1 ? {tabs: kept} : {}), sections};
}

/**
 * `device`: the structure for this phone or tablet. `web`: the structure the web draws for the
 * same viewer and server (same owner, same capabilities). Returns `device` itself when there is
 * nothing to add.
 */
export function withOwnerPages(device: SettingsStructure, web: SettingsStructure): SettingsStructure {
  let changed = false;
  const headings = device.headings.map(heading => {
    const authored = web.headings.find(h => h.id === heading.id);
    if (!authored) return heading;
    let pages: SettingsPage[] = heading.pages.map(page => {
      const wanted = OWNER_SECTIONS[`${heading.id}/${page.id}`];
      const from = authored.pages.find(p => p.id === page.id);
      if (!wanted || !from) return page;
      let sections = [...page.sections];
      for (const id of wanted) {
        const section = from.sections.find(s => s.id === id);
        if (section && !sections.some(s => s.id === id)) sections = placed(sections, section, from.sections.map(s => s.id));
      }
      if (sections.length === page.sections.length) return page;
      changed = true;
      return withTabs(page, sections, from.tabs ?? page.tabs);
    });
    if (heading.id === 'server') {
      for (const id of OWNER_PAGES) {
        const page = authored.pages.find(p => p.id === id);
        if (!page || pages.some(p => p.id === id)) continue;
        pages = placed(pages, page, authored.pages.map(p => p.id));
        changed = true;
      }
    }
    pages = pages.map(page => {
      const moved = MOVED_SECTIONS[`${heading.id}/${page.id}`];
      if (!moved || !pages.some(p => p.id === moved.to) || !page.sections.some(s => moved.sections.includes(s.id))) return page;
      changed = true;
      return withTabs(page, page.sections.filter(s => !moved.sections.includes(s.id)));
    });
    return changed ? {...heading, pages} : heading;
  });
  return changed ? {headings} : device;
}

/**
 * The Settings screen this app draws for a viewer: the shared structure for the kind of device,
 * with the rows this app honours, and on phones and tablets the owner's administration pages.
 * `keys`: the preferences this server publishes, once known.
 */
export function nativeSettingsStructure(context: Omit<SettingsContext, 'platform'>, television: boolean, keys?: ReadonlySet<string>): SettingsStructure {
  const device = withNativeRows(settingsStructure({...context, platform: television ? 'tv' : 'phone'}), keys);
  return television ? device : withOwnerPages(device, settingsStructure({...context, platform: 'web'}));
}
