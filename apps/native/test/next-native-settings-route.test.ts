import test from 'node:test';
import assert from 'node:assert/strict';
import type {PreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import type {DirectSnapshot} from '../../../packages/client-core/src/profile-management';
import {settingsStructure} from '../../../packages/client-core/src/presentation/settings-structure';
import {installationIdentity,setInstallationIdentity} from '../../../packages/client-core/src/installation';
import {nativeAccountPanelIds, nativeSettingsContext, nativeSettingsUnavailablePanelIds} from '../src-next/screens/settings-live/settings-context';

const preferences = {
  deviceClass: 'mobile',
  registry: {revision: 'r1', fields: [
    {key: 'playback.autoplayNext', type: 'boolean', default: true, scopes: ['profile-server'], group: 'playback', labelKey: 'settings.row.autoplayNext'},
    {key: 'region.locale', type: 'string', default: 'en-US', scopes: ['profile-server'], group: 'region', labelKey: 'settings.row.language'},
  ]},
  documents: [], effective: {}, effectiveSource: {}, clampedFields: [], registryRevision: 'r1',
} as unknown as PreferenceSnapshot;

const account = (role: 'owner' | 'admin' | 'member', hostedAccountId?: string): DirectSnapshot => Object.freeze({
  authority: 'local', serverId: 'server-1', canManage: role === 'owner' || role === 'admin',
  capabilities: {manageAccount: role === 'owner' || role === 'admin', managePeople: role !== 'member', manageServer: role !== 'member', manageSignIn: role === 'owner'},
  account: {id: 'account-1', username: 'justin', primaryProfileId: 'profile-1', role, revision: 1, disabled: false, allowedLibraries: [], ...(hostedAccountId ? {hostedAccountId} : {})},
  profiles: [{id: 'profile-1', name: 'Justin', primary: true, position: 0, art: 'blue' as const, revision: 1, pinRevision: 0, pinRequired: false}],
});

const source = (role: 'owner' | 'admin' | 'member', hostedAccountId?: string) => ({account: account(role, hostedAccountId), preferences: () => preferences, session: () => undefined});

test('an owner on a local server is the owner, with the server-published preference keys', () => {
  const context = nativeSettingsContext(source('owner'), 'phone');
  assert.equal(context.owner, true);
  assert.equal(context.administrator, false);
  assert.equal(context.platform, 'phone');
  assert.deepEqual([...context.capabilities.preferenceKeys ?? []], ['playback.autoplayNext', 'region.locale']);
  assert.equal(context.capabilities.localAccount, true);
  assert.equal(context.capabilities.porticoMember, false);
  assert.equal(context.capabilities.manageSignIn, false);
  assert.equal(context.capabilities.manageDevices, false);
  assert.equal(context.capabilities.downloads, false);
});

test('a Portico Account member is not a local account and is never made owner', () => {
  const context = nativeSettingsContext(source('member', 'hosted-1'), 'phone');
  assert.equal(context.owner, false);
  assert.equal(context.administrator, false);
  assert.equal(context.capabilities.localAccount, false);
  assert.equal(context.capabilities.porticoMember, true);
  assert.equal(context.capabilities.hostedAccount, true);
  assert.equal(context.capabilities.accessTokens, false);
});

test('an administrator sees only the administrator tier, never the owner pages', () => {
  const context = nativeSettingsContext(source('admin'), 'tv');
  assert.equal(context.owner, false);
  assert.equal(context.administrator, true);
  assert.equal(context.platform, 'tv');
});

test('the structure omits every drawn panel this build cannot draw rather than leaving an empty section', () => {
  const original = installationIdentity();
  setInstallationIdentity(undefined);
  try {
    const context = nativeSettingsContext(source('owner'), 'phone');
    const structure = settingsStructure(context);
    const rows = structure.headings.flatMap(heading => heading.pages).flatMap(page => page.sections).flatMap(section => section.rows);
    const custom = rows.filter(row => row.kind === 'custom').map(row => row.kind === 'custom' ? row.id : '');
    for (const id of nativeSettingsUnavailablePanelIds) assert.equal(custom.includes(id), false, id);
    for (const id of nativeAccountPanelIds.filter(id => id !== 'deviceName')) assert.equal(custom.includes(id), true, id);
    assert.equal(context.capabilities.deviceName, false);
    assert.equal(custom.includes('deviceName'), false, 'a missing installation name supplies no device-name row');
    for (const section of structure.headings.flatMap(heading => heading.pages).flatMap(page => page.sections)) assert.ok(section.rows.length > 0, section.id);
    setInstallationIdentity({installationId: 'm0_005_settings_installation_0000000000', name: 'Named phone', platform: 'android', app: 'Portico', appVersion: 'test'});
    const namedContext = nativeSettingsContext(source('owner'), 'phone');
    const namedRows = settingsStructure(namedContext).headings.flatMap(heading => heading.pages).flatMap(page => page.sections).flatMap(section => section.rows);
    assert.equal(namedContext.capabilities.deviceName, true);
    assert.ok(namedRows.some(row => row.kind === 'custom' && row.id === 'deviceName'), 'the real installation-name capability admits its panel');
  } finally {setInstallationIdentity(original);}
});

test('the dashboard route stays the owner and administrator read-only page on television', () => {
  const member = settingsStructure(nativeSettingsContext(source('member'), 'tv'));
  assert.equal(member.headings.some(heading => heading.id === 'server'), false);
  const owner = settingsStructure(nativeSettingsContext(source('owner'), 'tv'));
  assert.deepEqual(owner.headings.find(heading => heading.id === 'server')?.pages.map(page => page.id), ['dashboard']);
});
