import test from 'node:test';
import assert from 'node:assert/strict';
import {managesServer} from '../src/app/roles.ts';

test('only an owner or admin sees the server’s management (invite, manage on the web)', () => {
  assert.equal(managesServer('owner'), true);
  assert.equal(managesServer('admin'), true);
  assert.equal(managesServer('member'), false);
  assert.equal(managesServer(undefined), false);
});
