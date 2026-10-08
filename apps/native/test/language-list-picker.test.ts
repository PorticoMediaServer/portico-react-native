/**
 * X-03: preferred audio/subtitle languages are chosen from language names,
 * never typed. The picker works as an ordered list: add, remove and reorder.
 * Names resolve catalogue-first, so a runtime without `Intl.DisplayNames`
 * (Hermes) still shows names, never codes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMON_LANGUAGES, MAX_LANGUAGES, addLanguage, availableLanguages, languageName, moveLanguage, removeLanguage} from '../src/screens/settings/language-list.ts';
import {enUS} from '../../../packages/i18n/src/catalog/en-US.ts';

const en = (key: string): string | undefined => enUS[key as keyof typeof enUS];

test('X-03: codes render as language names, never codes', () => {
  assert.equal(languageName('ja', en, 'en'), 'Japanese');
  assert.equal(languageName('en', en, 'en'), 'English');
  // Unknown codes fall back to the code itself (still choosable, never blank).
  assert.equal(languageName('zzzz', en, 'en'), 'zzzz');
});

test('X-03: every offered language has a catalogue name', () => {
  for (const code of COMMON_LANGUAGES) {
    assert.ok(en(`language.${code}`), `missing language.${code}`);
  }
  assert.equal(en('language.ja'), 'Japanese');
  assert.equal(en('language.en'), 'English');
});

test('X-03: without Intl.DisplayNames the catalogue still yields names', () => {
  const real = Intl.DisplayNames;
  try {
    (Intl as Record<string, unknown>).DisplayNames = undefined;
    assert.equal(languageName('ja', en), 'Japanese');
    assert.equal(languageName('ja', () => undefined), 'ja');
  } finally {
    (Intl as Record<string, unknown>).DisplayNames = real;
  }
});

test('X-03: the catalogue wins over DisplayNames', () => {
  assert.equal(languageName('ja', () => 'Japonais', 'en'), 'Japonais');
});

test('X-03: the acceptance flow: Japanese, then English for audio; English for subtitles', () => {
  let audio: readonly string[] = [];
  audio = addLanguage(audio, 'ja');
  audio = addLanguage(audio, 'en');
  assert.deepEqual(audio, ['ja', 'en']);
  assert.equal(
    audio.map(c => languageName(c, en, 'en')).join(', '),
    'Japanese, English',
  );
  let subtitles: readonly string[] = [];
  subtitles = addLanguage(subtitles, 'en');
  assert.deepEqual(subtitles, ['en']);
});

test('X-03: adding skips duplicates and stops at the registry limit', () => {
  assert.deepEqual(addLanguage(['ja', 'en'], 'ja'), ['ja', 'en']);
  const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  assert.equal(full.length, MAX_LANGUAGES);
  assert.deepEqual(addLanguage(full, 'ja'), full);
});

test('X-03: remove and reorder keep the order of the rest', () => {
  assert.deepEqual(removeLanguage(['ja', 'en', 'fr'], 1), ['ja', 'fr']);
  assert.deepEqual(removeLanguage(['ja'], 5), ['ja']);
  assert.deepEqual(moveLanguage(['ja', 'en', 'fr'], 1, 'up'), ['en', 'ja', 'fr']);
  assert.deepEqual(moveLanguage(['ja', 'en', 'fr'], 1, 'down'), ['ja', 'fr', 'en']);
  assert.deepEqual(moveLanguage(['ja', 'en'], 0, 'up'), ['ja', 'en']);
  assert.deepEqual(moveLanguage(['ja', 'en'], 1, 'down'), ['ja', 'en']);
});

test('X-03: the offer list excludes chosen languages', () => {
  const offers = availableLanguages(['en', 'ja']);
  assert.ok(!offers.includes('en') && !offers.includes('ja'));
  assert.ok(offers.includes('fr'));
});
