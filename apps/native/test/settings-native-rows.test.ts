import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsStructure, settingsRowId} from '../../../packages/client-core/src/presentation/index.ts';
import {withNativeRows} from '../src/screens/settings/native-structure.ts';

const keys = new Set(['appearance.cardSizePercent', 'appearance.showBackdrops', 'playback.subtitleSize', 'playback.subtitleBackground', 'playback.subtitleMode', 'playback.preferredSubtitleLanguages', 'playback.preferredAudioLanguages', 'notifications.badges']);
const pageOf = (platform: 'phone' | 'tv', id: string, published: ReadonlySet<string> | undefined = keys) => {
  const shared = settingsStructure({owner: false, platform, capabilities: {...(published ? {preferenceKeys: published} : {})}});
  return withNativeRows(shared, published).headings.flatMap(h => h.pages).find(p => p.id === id)!;
};
const rowIds = (page: {sections: readonly {rows: readonly Parameters<typeof settingsRowId>[0][]}[]}) => page.sections.flatMap(s => s.rows.map(settingsRowId));

for (const platform of ['phone', 'tv'] as const) {
  test(`${platform}: Appearance offers Card size and Show backdrops, first, once`, () => {
    const ids = rowIds(pageOf(platform, 'appearance'));
    assert.deepEqual(ids.slice(0, 2), ['cardSize', 'appearance.showBackdrops']);
    assert.equal(ids.filter(id => id === 'cardSize').length, 1);
    // What was there stays, after them.
    assert.ok(ids.includes('reduceMotion'));
  });

  test(`${platform}: Audio & Subtitles offers the caption size and background`, () => {
    const page = pageOf(platform, 'languages');
    const section = page.sections.find(s => s.id === 'appearance')!;
    assert.equal(section.title, 'settings.section.subtitleAppearance');
    assert.deepEqual(section.rows.map(settingsRowId), ['playback.subtitleSize', 'playback.subtitleBackground']);
  });
}

test('a setting the server does not publish is not offered', () => {
  const some = new Set([...keys].filter(k => k !== 'appearance.cardSizePercent' && k !== 'playback.subtitleBackground'));
  assert.equal(rowIds(pageOf('phone', 'appearance', some)).includes('cardSize'), false);
  assert.ok(rowIds(pageOf('phone', 'appearance', some)).includes('appearance.showBackdrops'));
  assert.deepEqual(pageOf('phone', 'languages', some).sections.find(s => s.id === 'appearance')!.rows.map(settingsRowId), ['playback.subtitleSize']);
});

test('adding the rows twice changes nothing, and a structure that needs none is returned as it is', () => {
  const shared = settingsStructure({owner: false, platform: 'phone', capabilities: {preferenceKeys: keys}});
  const once = withNativeRows(shared, keys);
  assert.equal(withNativeRows(once, keys), once);
  const none = new Set(['notifications.badges']);
  const bare = settingsStructure({owner: false, platform: 'phone', capabilities: {preferenceKeys: none}});
  assert.equal(withNativeRows(bare, none), bare);
});

test('the rows are the shared ones: the same choices and scope', () => {
  const card = pageOf('tv', 'appearance').sections.flatMap(s => s.rows).find(r => r.kind === 'composite' && r.id === 'cardSize')!;
  assert.equal(card.kind === 'composite' && card.scope, 'deviceClass');
  assert.deepEqual(card.kind === 'composite' && card.control.type === 'choice' && card.control.choices.map(c => c.value), ['small', 'medium', 'large']);
});
