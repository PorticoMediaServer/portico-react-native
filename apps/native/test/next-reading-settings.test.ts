import test from 'node:test';
import assert from 'node:assert/strict';
import {HttpLocalApi} from '../../../packages/client-core/src';
import {parsePreferenceSnapshot, type PreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import {nativeReadingPreferencesAvailable, nativeReadingSettingsPreferences, nativeReadingSettingsSection} from '../src-next/screens/settings/reading-preferences';
import type {ShellAuthority} from '../src-next/shell/model';

const allRows = [...(nativeReadingSettingsSection.groups ?? []), ...(nativeReadingSettingsSection.advanced?.groups ?? [])].flatMap(group => group.rows);
const fields = allRows.map(row => {
  const value = row.control.default;
  assert.ok(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean');
  return {key: row.key!, type: typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ? 'integer' : 'string', default: value,
    ...(row.control.options ? {allowedValues: row.control.options.map(option => option.value)} : {}),
    scopes: ['profile-server'], group: 'reading', labelKey: `preferences.${row.key}`};
});
function snapshot(revision = 3, overrides: Record<string, unknown> = {}): PreferenceSnapshot {
  return parsePreferenceSnapshot({deviceClass: 'mobile', registryRevision: 'reading-v1', registry: {revision: 'reading-v1', fields},
    documents: [{scope: 'profile-server', revision, activeRevision: revision, digest: 'a'.repeat(64), values: overrides},
      {scope: 'profile-device-class', revision: 1, activeRevision: 1, digest: 'b'.repeat(64), values: {}}],
    effective: Object.fromEntries(fields.map(field => [field.key, overrides[field.key] ?? field.default])),
    effectiveSource: Object.fromEntries(fields.map(field => [field.key, field.key in overrides ? 'profile-server' : 'default'])), clampedFields: []});
}
function fixture() {
  let preferences = snapshot(), valid = true;
  const authority: ShellAuthority = {serverId: 'server', accountId: 'account', profileId: 'profile', epoch: 'epoch', viewerFence: 'a'.repeat(64)};
  const authorityListeners = new Set<() => void>(), preferenceListeners = new Set<() => void>();
  const requests: {method: string; body?: any; signal?: AbortSignal | null}[] = [];
  let nextReply: ((method: string, body: any, signal?: AbortSignal | null) => Promise<unknown>) | undefined;
  const envelope = (data: PreferenceSnapshot, fence = 'a'.repeat(64)) => ({scope: {serverId: authority.serverId, viewerFence: fence}, data});
  const api = new HttpLocalApi('https://reading-settings.test', 'synthetic-account-token', async (_input, init) => {
    const method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({method, body, signal: init?.signal});
    const reply = nextReply ? await nextReply(method, body, init?.signal) : envelope(preferences);
    return new Response(JSON.stringify(reply), {status: 200, headers: {'content-type': 'application/json'}});
  });
  const owner = {api, authority: () => authority, current: () => valid, preferences: () => preferences,
    subscribeAuthority: (listener: () => void) => {authorityListeners.add(listener); return () => {authorityListeners.delete(listener);};},
    subscribePreferences: (listener: () => void) => {preferenceListeners.add(listener); return () => {preferenceListeners.delete(listener);};}};
  return {owner, requests, envelope,
    reply: (next: typeof nextReply) => {nextReply = next;},
    publish: (next: PreferenceSnapshot) => {preferences = next; for (const listener of [...preferenceListeners]) listener();},
    close: () => {valid = false; for (const listener of [...authorityListeners]) listener();},
    listeners: () => ({authority: authorityListeners.size, preferences: preferenceListeners.size})};
}

test('retained Read and Settings borrow one source, publishing canonical changes only after real CAS acknowledgement', async () => {
  const f = fixture(), source = nativeReadingSettingsPreferences(f.owner);
  try {
    assert.equal(nativeReadingSettingsPreferences(f.owner), source);
    const before = source.getSnapshot();
    assert.equal(source.getSnapshot(), before, 'external-store projection is stable');
    let finish!: (reply: unknown) => void;
    f.reply(async () => new Promise(resolve => {finish = resolve;}));
    const pending = source.patch({textSize: 6});
    assert.equal(source.getSnapshot(), before, 'no optimistic preference reaches the retained reader');
    assert.equal(source.getState().busy, true);
    assert.equal(f.requests[0]!.method, 'PATCH');
    assert.equal(f.requests[0]!.body.scope, 'profile-server');
    assert.equal(f.requests[0]!.body.deviceClass, 'mobile');
    assert.equal(f.requests[0]!.body.expectedRevision, 3);
    assert.deepEqual(f.requests[0]!.body.values, {'reading.textSize': 6});
    assert.equal(typeof f.requests[0]!.body.idempotencyKey, 'string');
    finish(f.envelope(snapshot(4, {'reading.textSize': 6})));
    assert.equal((await pending).textSize, 6);
    assert.equal(nativeReadingSettingsPreferences(f.owner).getSnapshot().textSize, 6, 'returning through Settings needs no second reader or SSE wait');
    f.publish(snapshot(5, {'reading.textSize': 7}));
    assert.equal(source.getSnapshot().textSize, 7);
    assert.equal(source.getState().preferences.documents[0]!.revision, 5);
    f.reply(async () => f.envelope(snapshot(6)));
    await source.patch({textSize: null});
    assert.equal(f.requests[1]!.body.expectedRevision, 5);
    assert.deepEqual(f.requests[1]!.body.values, {'reading.textSize': null}, 'Reset clears only the actual profile override');
  } finally {f.close();}
  assert.deepEqual(f.listeners(), {authority: 0, preferences: 0});
});

test('Reading settings reject unknown values and disabled dependent row writes without network mutations', async () => {
  const f = fixture(), source = nativeReadingSettingsPreferences(f.owner);
  try {
    await assert.rejects(source.setRow('reading.font', 'invented-font'));
    await assert.rejects(source.setRow('not-a-row', 'anything'));
    f.publish(snapshot(4, {'reading.twoPages': false}));
    const dependent = allRows.find(row => row.id === 'comics.firstPageAlone')!;
    assert.equal(source.rowEnabled(dependent), false);
    await assert.rejects(source.setRow(dependent.id, true));
    assert.equal(f.requests.length, 0);
  } finally {f.close();}
});

test('a changed viewer fence refuses the preference acknowledgement and preserves the current projection', async () => {
  const f = fixture(), source = nativeReadingSettingsPreferences(f.owner);
  try {
    await source.refresh();
    const before = source.getSnapshot();
    f.reply(async () => f.envelope(snapshot(4, {'reading.textSize': 6}), 'c'.repeat(64)));
    await assert.rejects(source.patch({textSize: 6}));
    assert.equal(source.getSnapshot(), before);
    assert.notEqual(source.getState().error, undefined);
  } finally {f.close();}
});

test('authority retirement aborts the real outstanding request and withholds late preferences', async () => {
  const f = fixture(), source = nativeReadingSettingsPreferences(f.owner);
  let finish!: (reply: unknown) => void;
  f.reply(async () => new Promise(resolve => {finish = resolve;}));
  const pending = source.patch({textSize: 6});
  f.close();
  assert.equal(f.requests[0]!.signal?.aborted, true);
  finish(f.envelope(snapshot(4, {'reading.textSize': 6})));
  await assert.rejects(pending);
  assert.throws(source.getSnapshot);
  assert.deepEqual(f.listeners(), {authority: 0, preferences: 0});
});

test('Reading settings eligibility uses actual published preferences and never admits a TV or a partial registry', () => {
  const actual = snapshot();
  assert.equal(nativeReadingPreferencesAvailable(actual), true);
  assert.equal(nativeReadingPreferencesAvailable({...actual, deviceClass: 'television'}), false);
  assert.equal(nativeReadingPreferencesAvailable({...actual, documents: []}), false);
  assert.equal(nativeReadingPreferencesAvailable({...actual, effective: {}, registry: {...actual.registry, fields: []}}), false);
});
