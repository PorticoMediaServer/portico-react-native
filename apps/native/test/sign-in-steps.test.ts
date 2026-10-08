import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {accountScreen, directStepAfter, firstDirectStep, reachableDirectSteps} from '../src/screens/auth/sign-in-steps.ts';

const source = (path: string) => readFileSync(new URL('../src/screens/auth/' + path, import.meta.url), 'utf8');

test('iPhone and iPad have no code sign-in: the direct sign-in is the password form only', () => {
  assert.equal(firstDirectStep(false), 'password');
  assert.deepEqual([...reachableDirectSteps(false)], ['password'], 'no address step and no Quick Connect code on a handheld');
  for (const event of ['connected', 'usePassword', 'back'] as const) assert.notEqual(directStepAfter('password', event, false), 'code');
  assert.equal(directStepAfter('password', 'back', false), 'exit');
});

test('iPhone and iPad open account sign-in on the form, never on an activation code', () => {
  assert.equal(accountScreen(false), 'form');
  assert.equal(accountScreen(true), 'activation');
});

test('the TV keeps its codes: address, then the server Quick Connect code, with a password fallback', () => {
  assert.equal(firstDirectStep(true), 'address');
  assert.equal(directStepAfter('address', 'connected', true), 'code');
  assert.equal(directStepAfter('code', 'usePassword', true), 'password');
  assert.equal(directStepAfter('code', 'back', true), 'address');
  assert.equal(directStepAfter('password', 'back', true), 'address');
  assert.equal(directStepAfter('address', 'back', true), 'exit');
  assert.deepEqual([...reachableDirectSteps(true)].sort(), ['address', 'code', 'password']);
});

test('the screens move only through the step model, and the handheld form offers no code entry', () => {
  const direct = source('DirectSignIn.tsx');
  assert.doesNotMatch(direct, /setStep\('(code|address|password)'\)/, 'no step is set around the model');
  const flow = source('AuthFlow.tsx');
  assert.doesNotMatch(flow, /step === 'code'/, 'no account code step');
  const handheld = flow.split('\n').filter(l => /^\s*return <HostedSignIn /.test(l));
  assert.equal(handheld.length, 1);
  assert.doesNotMatch(handheld[0], /onUseCode/, 'the handheld Portico Account form has no "use a code" link');
  assert.match(flow, /accountScreen\(isTV\) === 'activation'/, 'activation only where the model says');
});
