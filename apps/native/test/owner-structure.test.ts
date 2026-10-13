import test from 'node:test';
import assert from 'node:assert/strict';
import {settingsRowId, settingsStructure, type SettingsPage, type SettingsStructure} from '../../../packages/client-core/src/presentation/index.ts';
import {nativeSettingsStructure, withOwnerPages} from '../src/screens/settings/native-structure.ts';

const owner = {owner: true, capabilities: {accessTokens: false}};
const member = {owner: false, capabilities: {accessTokens: true}};
const heading = (s: SettingsStructure, id: 'account' | 'server') => s.headings.find(h => h.id === id);
const page = (s: SettingsStructure, h: 'account' | 'server', id: string): SettingsPage => heading(s, h)!.pages.find(p => p.id === id)!;
const sections = (p: SettingsPage) => p.sections.map(s => s.id);
const panels = (p: SettingsPage) => p.sections.flatMap(s => s.rows.filter(r => r.kind === 'custom').map(settingsRowId));

test('an owner on a phone or tablet has Integrations and Metadata, where the web has them', () => {
  const phone = nativeSettingsStructure(owner, false);
  const web = settingsStructure({...owner, platform: 'web'});
  const ids = heading(phone, 'server')!.pages.map(p => p.id);
  assert.deepEqual(ids, heading(web, 'server')!.pages.map(p => p.id));
  assert.equal(ids[ids.indexOf('libraries') + 1], 'metadata');
  assert.equal(ids[ids.indexOf('people') + 1], 'integrations');
});

test('Integrations is the web’s page: keys with their rate, members’ tokens with their switch, webhooks, assistants', () => {
  const integrations = page(nativeSettingsStructure(owner, false), 'server', 'integrations');
  assert.deepEqual(integrations.tabs?.map(t => t.id), ['keys', 'tokens', 'webhooks', 'assistants']);
  assert.deepEqual(panels(integrations), ['server.apiKeys', 'server.memberTokens', 'server.webhooks', 'server.assistants']);
  const settings = integrations.sections.flatMap(s => s.rows.filter(r => r.kind === 'server-setting').map(settingsRowId));
  assert.deepEqual(settings, ['runtime.apiRequestsPerMinute', 'runtime.blockMemberAccessTokens']);
  assert.deepEqual(integrations, page(settingsStructure({...owner, platform: 'web'}), 'server', 'integrations'));
});

test('the keys list is in one place: it leaves People when Integrations holds it', () => {
  const people = page(nativeSettingsStructure(owner, false), 'server', 'people');
  assert.equal(panels(people).includes('server.apiKeys'), false);
  assert.deepEqual(people.tabs?.map(t => t.id), ['accounts', 'invitations', 'devices']);
  // The shared structure alone still lists it there for a phone.
  assert.ok(panels(page(settingsStructure({...owner, platform: 'phone'}), 'server', 'people')).includes('server.apiKeys'));
});

test('Storage, Troubleshooting and General gain their owner panels in the web’s order', () => {
  const phone = nativeSettingsStructure(owner, false);
  const storage = sections(page(phone, 'server', 'storage'));
  assert.deepEqual(storage.slice(storage.indexOf('retention'), storage.indexOf('sources') + 1), ['retention', 'usage', 'places', 'downloadUsage', 'sources']);
  const trouble = sections(page(phone, 'server', 'troubleshooting'));
  assert.deepEqual(trouble.slice(trouble.indexOf('capabilities'), trouble.indexOf('export') + 1), ['capabilities', 'setAside', 'clientReports', 'export']);
  const general = sections(page(phone, 'server', 'general'));
  assert.deepEqual(general.slice(general.indexOf('updates'), general.indexOf('updates') + 2), ['updates', 'restart']);
  assert.deepEqual(panels(page(phone, 'server', 'metadata')), ['server.metadataSettings']);
});

test('pausing background work and the guide limits were already a phone’s, and stay', () => {
  const phone = nativeSettingsStructure(owner, false);
  assert.ok(panels(page(phone, 'server', 'schedule')).includes('server.backgroundPause'));
  const live = page(phone, 'server', 'live').sections.flatMap(s => s.rows.map(settingsRowId));
  for (const row of ['liveDefaults.guideDays', 'liveDefaults.importLimits.channels', 'liveDefaults.importLimits.programmes', 'liveDefaults.importLimits.bytes']) assert.ok(live.includes(row), row);
});

test('a member has no Server heading, and their own access tokens under Profile, before Sign out', () => {
  const phone = nativeSettingsStructure(member, false);
  assert.equal(heading(phone, 'server'), undefined);
  const profile = sections(page(phone, 'account', 'profile'));
  assert.equal(profile[profile.indexOf('tokens') + 1], 'session');
  assert.deepEqual(page(phone, 'account', 'profile').sections.find(s => s.id === 'tokens')!.rows.map(settingsRowId), ['accessTokens']);
});

test('the owner makes keys, not personal tokens: no tokens row for them', () => {
  assert.equal(sections(page(nativeSettingsStructure(owner, false), 'account', 'profile')).includes('tokens'), false);
});

test('television gets none of it: the Dashboard alone for an owner, nothing for a member', () => {
  const tv = nativeSettingsStructure(owner, true);
  assert.deepEqual(heading(tv, 'server')!.pages.map(p => p.id), ['dashboard']);
  assert.equal(sections(page(tv, 'account', 'profile')).includes('tokens'), false);
  const memberTV = nativeSettingsStructure(member, true);
  assert.equal(heading(memberTV, 'server'), undefined);
  assert.equal(sections(page(memberTV, 'account', 'profile')).includes('tokens'), false);
});

test('nothing is added twice, and a structure with nothing to add is returned as it is', () => {
  const web = settingsStructure({...owner, platform: 'web'});
  const once = withOwnerPages(settingsStructure({...owner, platform: 'phone'}), web);
  assert.equal(withOwnerPages(once, web), once);
  const plain = settingsStructure({owner: false, platform: 'phone', capabilities: {}});
  assert.equal(withOwnerPages(plain, settingsStructure({owner: false, platform: 'web', capabilities: {}})), plain);
});

test('every lifted row is one this app draws', () => {
  const drawn = new Set(['server.apiKeys', 'server.memberTokens', 'server.webhooks', 'server.assistants', 'server.metadataSettings', 'server.resourceUsage', 'server.storageStatus', 'server.downloadUsage', 'server.setAsideTitles', 'server.clientReports', 'server.restart', 'accessTokens']);
  const phone = nativeSettingsStructure(owner, false), base = settingsStructure({...owner, platform: 'phone'});
  const before = new Set(base.headings.flatMap(h => h.pages.flatMap(p => p.sections.flatMap(s => s.rows.filter(r => r.kind === 'custom').map(settingsRowId)))));
  const added = phone.headings.flatMap(h => h.pages.flatMap(p => p.sections.flatMap(s => s.rows.filter(r => r.kind === 'custom').map(settingsRowId)))).filter(id => !before.has(id));
  for (const id of added) assert.ok(drawn.has(id), id);
  assert.equal(added.includes('server.devices'), false);
  assert.equal(added.includes('server.playbackProblems'), false);
});
