import test from 'node:test';
import assert from 'node:assert/strict';
import {appendIdentityCode, formatIdentityCode, identityCodeCharacters, identityCodeEntry, identityCodeRows} from '../src-next/tv/auth/TVIdentityCodeForm';

test('frame 2a draws A–Z, the dash, then 0–9 on nine-key rows', () => {
  assert.equal(identityCodeCharacters.join(''), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ-1234567890');
  assert.deepEqual(identityCodeRows.map(row => row.join('')), ['ABCDEFGHI', 'JKLMNOPQR', 'STUVWXYZ-', '123456789', '0']);
  assert.deepEqual(identityCodeEntry, {region: 'tv.identity-code.keyboard.1', child: 'V'});
});

test('typing keeps twelve symbols, redraws the dashes and ignores spaces', () => {
  assert.equal(appendIdentityCode('', 'G'), 'G');
  assert.equal(appendIdentityCode('G39EBZ', 'V'), 'G39EBZV');
  assert.equal(appendIdentityCode('G39E', 'space'), 'G39E');
  assert.equal(appendIdentityCode('G39EBZVDSEJ', 'C'), 'G39EBZVDSEJ');
  assert.equal(appendIdentityCode('G39E', 'delete'), 'G39');
  assert.equal(appendIdentityCode('G39E', 'clear'), '');
  assert.equal(formatIdentityCode('G39EBZVDSEJC'), 'G39E-BZVD-SEJC');
  assert.equal(formatIdentityCode('G39'), 'G39');
});
