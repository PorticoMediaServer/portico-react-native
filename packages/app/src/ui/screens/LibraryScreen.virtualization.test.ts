import {
  canRequestNextLibraryPage,
  librarySpecialFocusId,
  librarySpecialItemKey,
  librarySpecialTVFocusId,
} from './LibraryScreen';

export {};
declare const __dirname: string;
declare function require(id: string): {
  readFileSync(path: string, encoding: string): string;
  resolve(...paths: string[]): string;
};
const {readFileSync} = require('node:fs');
const {resolve} = require('node:path');

const source = readFileSync(resolve(__dirname, 'LibraryScreen.tsx'), 'utf8');

describe('LibraryScreen TV special-library rendering', () => {
  test('uses bounded virtualized lists for every accumulated TV presentation', () => {
    expect(source.match(/\{\.\.\.TV_SPECIAL_LIST_PROPS\}/g) ?? []).toHaveLength(
      4,
    );
    expect(source.match(/style=\{styles\.specialListTv\}/g) ?? []).toHaveLength(
      4,
    );
    expect(source).toContain('columnWrapperStyle={styles.resourceGridTv}');
    expect(source).toContain('ItemSeparatorComponent={ScheduleSeparator}');
    expect(source).toContain('{...TV_SPECIAL_FACET_LIST_PROPS}');
    expect(source).toContain('data={discoverRows}');
    expect(source).toContain(
      "keyExtractor={row => librarySpecialItemKey('discover-row', row.id)}",
    );
    expect(source).toContain(
      'renderItem={({item: row}) => renderDiscoverRow(row)}',
    );
    expect(source).not.toContain('mergedPage.facets.map(group =>');
    expect(source).not.toContain('mergedPage.resources.map(resource =>');
    expect(source).not.toContain('mergedPage.schedule.map(entry =>');
    expect(source).not.toContain(
      'mergedPage!.rows.filter(row => row.items.length > 0).map',
    );
  });

  test('keeps stable, presentation-scoped keys and focus identities', () => {
    expect(librarySpecialItemKey('resource', 'resource-1')).toBe(
      'resource:resource-1',
    );
    expect(librarySpecialItemKey('resource', 'resource-1')).toBe(
      librarySpecialItemKey('resource', 'resource-1'),
    );
    expect(librarySpecialItemKey('resource', 'resource-1')).not.toBe(
      librarySpecialItemKey('schedule', 'resource-1'),
    );
    expect(librarySpecialItemKey('discover-row', 'row-1')).toBe(
      'discover-row:row-1',
    );
    expect(librarySpecialItemKey('discover-row', 'row-1')).not.toBe(
      librarySpecialItemKey('discover-row', 'row-2'),
    );

    const firstGroupFocus = librarySpecialFocusId(
      'library-1',
      'authors',
      'facet',
      'author-1',
      'authors',
    );
    expect(firstGroupFocus).toBe(
      librarySpecialFocusId(
        'library-1',
        'authors',
        'facet',
        'author-1',
        'authors',
      ),
    );
    expect(firstGroupFocus).not.toBe(
      librarySpecialFocusId(
        'library-1',
        'authors',
        'facet',
        'author-1',
        'series',
      ),
    );
    expect(firstGroupFocus).not.toBe(
      librarySpecialFocusId(
        'library-2',
        'authors',
        'facet',
        'author-1',
        'authors',
      ),
    );
    const focusScope = {libraryId: 'library-1', tabId: 'authors'};
    expect(
      librarySpecialTVFocusId(focusScope, 'facet', 'author-1', 'authors'),
    ).toBe(firstGroupFocus);
    expect(librarySpecialTVFocusId(focusScope, 'resource', 'resource-1')).toBe(
      'library-special:library-1:authors:resource:resource-1',
    );
    expect(
      librarySpecialTVFocusId(undefined, 'resource', 'resource-1'),
    ).toBeUndefined();
    expect(
      source.match(/tvFocusId=\{librarySpecialTVFocusId\(/g) ?? [],
    ).toHaveLength(2);
  });

  test('exposes truthful next-page backpressure', () => {
    expect(canRequestNextLibraryPage(true, false)).toBe(true);
    expect(canRequestNextLibraryPage(false, false)).toBe(false);
    expect(canRequestNextLibraryPage(true, true)).toBe(false);
    expect(source).toMatch(
      /if\s*\(\s*!canRequestNextLibraryPage\(page\.hasNextPage, page\.isFetchingNextPage\)\s*\)\s*return;/,
    );
    expect(source).toContain('const pagination = page.hasNextPage ?');
  });

  test('retains the mobile-specific surface path', () => {
    expect(source.match(/const mobileContent\s*=\s*\(/g) ?? []).toHaveLength(3);
    expect(source).toContain(
      'return television ? content : mobileSurface(mobileContent);',
    );
    expect(source).toContain('platform="mobile"');
  });
});
