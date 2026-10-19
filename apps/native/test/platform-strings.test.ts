import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {androidQualifier} from '../../../scripts/platform-strings.mjs';

const script = fileURLToPath(new URL('../../../scripts/platform-strings.mjs', import.meta.url));

test('the Android and iOS string files are generated from the catalogue and current', () => {
  assert.doesNotThrow(() => execFileSync(process.execPath, [script, '--check'], {stdio: 'pipe'}), 'run: node scripts/platform-strings.mjs --write');
});

test('Android resource qualifiers name scripts, numeric regions and Indonesian the way Android reads them', () => {
  assert.equal(androidQualifier('fr'), 'fr');
  assert.equal(androidQualifier('pt-BR'), 'pt-rBR');
  assert.equal(androidQualifier('fr-CA'), 'fr-rCA');
  assert.equal(androidQualifier('es-419'), 'b+es+419');
  assert.equal(androidQualifier('zh-Hant'), 'b+zh+Hant');
  assert.equal(androidQualifier('id'), 'in');
});
