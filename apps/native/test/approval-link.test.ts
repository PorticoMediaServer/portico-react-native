/** A TV's Quick Connect code is approved on its own server, never on the account service. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalLink} from '../src/app/approval-link.ts';

test('the QR opens this server’s /device page with the code in the fragment', () => {
  assert.equal(approvalLink('https://demo.getportico.tv', 'https://web.getportico.tv/device#code=AB12-CD34', 'AB12-CD34'), 'https://demo.getportico.tv/device#code=AB12-CD34');
  assert.equal(approvalLink('http://192.168.1.20:32500/', undefined, 'AB12-CD34'), 'http://192.168.1.20:32500/device#code=AB12-CD34');
  // A server that already answers with its own page is used as given.
  assert.equal(approvalLink('https://demo.getportico.tv', 'https://demo.getportico.tv/device#code=X', 'X'), 'https://demo.getportico.tv/device#code=X');
});
