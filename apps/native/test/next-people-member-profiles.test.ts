import test from 'node:test';
import assert from 'node:assert/strict';
import {IdentityClient} from '../../../packages/client-core/src/identity-client.ts';
import {screenModule} from './helpers/screen-harness.mjs';
import {lifecycleHooks, nodes, content, t, theme} from './helpers/owner-server-settings.mjs';

const {MemberProfilesClient} = await screenModule(new URL('../../../packages/client-core/src/member-profiles.ts', import.meta.url), {
  react: {default: {}}, '../../contracts/src/route-paths.ts': await import('../../../packages/contracts/src/route-paths.ts'), '../../contracts/src/routes.ts': await import('../../../packages/contracts/src/routes.ts'),
  './profile-management.ts': {PROFILE_ART: ['blue', 'violet', 'mint', 'coral', 'gold', 'slate', 'rose', 'sky']}, './identity-restrictions.ts': await import('../../../packages/client-core/src/identity-restrictions.ts'), './server-messages.ts': await import('../../../packages/client-core/src/server-messages.ts'),
});
const deferred = () => {let resolve!: (value: any) => void, reject!: (value: any) => void; const promise = new Promise<any>((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const profile = (id = 'alex', revision = 4) => ({id, name: 'Alex', art: 'mint', primary: true, position: 0, revision, pinRequired: true, pinRevision: 2, allowedLibraries: [],
  restrictions: {profileId: id, ratingSystem: 'ca', maximumAgeRating: 'PG', maximumAge: 8, allowUnrated: true, blockedLabels: ['Private'], allowDownloads: true, allowLiveTv: false, allowDvr: true, allowWatchTogether: false, revision: 7}});
const systems = [{id: 'ca', name: 'Canada', region: 'CA', screens: [], values: [{code: 'G', label: 'General', minimumAge: 0}, {code: 'PG', label: 'Parental guidance', minimumAge: 8}]}];
const tick = async () => {for (let i = 0; i < 8; i++) await Promise.resolve();};
async function fixture(caller = 'owner', target = 'member') {
  const requests: any[] = [], reported: unknown[] = [];
  let active = true, personCurrent = true;
  const person = {accountId: 'member', role: target, revision: 5};
  const context = {current: () => active, account: {account: {id: 'caller', role: caller}, capabilities: {managePeople: true}}, api: {request(path: string, method: string, body: unknown, signal: AbortSignal) {
    const pending = deferred(); requests.push({path, method, body, signal, ...pending}); return pending.promise;
  }}};
  const module = await screenModule(new URL('../src-next/screens/settings-live/server/member-profiles-source.ts', import.meta.url), {
    react: {default: {}}, '../../../../../../packages/client-core/src/member-profiles': {MemberProfilesClient}, '../../../../../../packages/client-core/src/identity-client': {IdentityClient},
    '../lifetime': {screenScopeEnded: () => new Error('ended'), NativeScreenLifetime: class {live = true; current = () => active && this.live; request = (work: any, signal: any) => work(signal); dispose = () => {this.live = false;};}},
  });
  const source = new module.NativeMemberProfilesSource(context, person, () => personCurrent, (error: unknown) => reported.push(error));
  const load = async (items = [profile()]) => {const pending = source.load(); requests.at(-1).resolve({accountId: 'member', items}); await tick(); requests.at(-1).resolve({items: systems}); await pending; return source.getSnapshot().items?.[0];};
  return {source, context, person, requests, reported, load, switchPerson: () => {personCurrent = false;}, retire: () => {active = false;}};
}

test('Profiles reads real rows and server rating scale; Manage requires the server read and exact published row', async () => {
  const f = await fixture();
  assert.equal(f.source.canManage(profile()), false);
  const row = await f.load();
  assert.equal(f.requests[0].path, '/v1/admin/access/members/member/profiles'); assert.equal(f.requests[0].method, 'GET');
  assert.deepEqual(f.source.getSnapshot().items, [profile()]); assert.deepEqual(f.source.getSnapshot().systems, systems);
  assert.equal(f.source.canManage(row), true); assert.equal(f.source.canManage({...row}), false);
  f.source.manage({...row}); assert.equal(f.source.getSnapshot().managing, undefined);
  f.source.manage(row); assert.equal(f.source.getSnapshot().managing, row); f.source.dispose();
});

test('Manage respects owner/admin tiers and never reads owner profiles or another admin as admin', async () => {
  for (const [caller, target, allowed] of [['owner', 'member', true], ['owner', 'admin', true], ['admin', 'member', true], ['admin', 'admin', false], ['admin', 'owner', false], ['owner', 'owner', false], ['member', 'member', false]] as const) {
    const f = await fixture(caller, target);
    if (allowed) {const row = await f.load(); assert.equal(f.source.canManage(row), true);}
    else {await f.source.load(); assert.equal(f.requests.length, 0); assert.equal(f.source.getSnapshot().denied, true);}
    f.source.dispose();
  }
  const f = await fixture(); const read = f.source.load(); f.requests[0].reject({status: 403}); await read;
  assert.equal(f.source.getSnapshot().denied, true); assert.equal(f.source.canManage(profile()), false); f.source.dispose();
});

test('Rename, colour and restrictions save separately with the revision read and preserve all other limits', async () => {
  const f = await fixture(); let row = await f.load(); f.source.manage(row);
  let saving = f.source.rename(row, ' Alex new '); assert.deepEqual(f.requests.at(-1).body, {expectedRevision: 4, name: 'Alex new'});
  f.requests.at(-1).resolve({...profile(), name: 'Alex new', revision: 5}); assert.equal(await saving, true);
  assert.equal(await f.source.colour(row, 'blue'), false, 'the replaced revision cannot save');
  row = f.source.getSnapshot().managing; saving = f.source.colour(row, 'blue'); assert.deepEqual(f.requests.at(-1).body, {expectedRevision: 5, art: 'blue'});
  f.requests.at(-1).resolve({...row, art: 'blue', revision: 6}); await saving;
  row = f.source.getSnapshot().managing; saving = f.source.restrict(row, {allowUnrated: false});
  assert.deepEqual(f.requests.at(-1).body, {expectedRevision: 7, ratingSystem: 'ca', maximumAgeRating: 'PG', allowUnrated: false, blockedLabels: ['Private'], allowDownloads: true, allowLiveTv: false, allowDvr: true, allowWatchTogether: false});
  f.requests.at(-1).resolve({...row, restrictions: {...row.restrictions, allowUnrated: false, revision: 8}}); assert.equal(await saving, true); f.source.dispose();
});

test('a revision conflict re-reads, discards the stale draft, announces changed and never retries the write', async () => {
  const f = await fixture(); const row = await f.load(); f.source.manage(row);
  const saving = f.source.rename(row, 'New'); f.requests.at(-1).reject({status: 409, code: 'profile_changed'}); await tick();
  assert.equal(f.requests.at(-1).method, 'GET'); assert.equal(f.source.getSnapshot().changed, true); assert.equal(f.source.getSnapshot().pinConfirmation, undefined);
  f.requests.at(-1).resolve({accountId: 'member', items: [{...profile(), revision: 9, name: 'Elsewhere'}]}); assert.equal(await saving, false);
  assert.equal(f.source.getSnapshot().managing.name, 'Elsewhere'); assert.equal(f.source.getSnapshot().managing.revision, 9);
  assert.equal(f.requests.filter(request => request.method === 'PATCH').length, 1); f.source.dispose();
});

test('Remove PIN needs the exact confirmation and uses the current read revision', async () => {
  const f = await fixture(); const row = await f.load(); f.source.manage(row);
  assert.equal(await f.source.removePIN(row), false); assert.equal(f.requests.length, 2);
  f.source.askRemovePIN(row); f.source.cancelRemovePIN(); assert.equal(await f.source.removePIN(row), false);
  f.source.askRemovePIN(row); assert.equal(await f.source.removePIN({...row}, f.source.getSnapshot().pinConfirmation), false);
  const confirmation = f.source.getSnapshot().pinConfirmation;
  const saving = f.source.removePIN(row, confirmation); assert.equal(f.requests.at(-1).path, '/v1/admin/access/members/member/profiles/alex/pin-reset'); assert.deepEqual(f.requests.at(-1).body, {expectedRevision: 4});
  assert.equal(await f.source.removePIN(row), false, 'confirmation is consumed before dispatch');
  f.requests.at(-1).resolve({...profile(), revision: 5, pinRequired: false, pinRevision: 3}); assert.equal(await saving, true);
  assert.equal(f.source.getSnapshot().managing.pinRequired, false); f.source.dispose();
});

test('late list, save and conflict re-read cannot publish after switching person or disposing', async () => {
  const first = await fixture(); const reading = first.source.load(); first.switchPerson(); first.requests[0].resolve({accountId: 'member', items: [profile()]}); await reading;
  assert.equal(first.source.getSnapshot().items, undefined); assert.equal(first.requests.length, 1); first.source.dispose();
  for (const conflict of [false, true]) {
    const f = await fixture(); const row = await f.load(); f.source.manage(row); const saving = f.source.rename(row, 'New');
    if (conflict) {f.requests.at(-1).reject({status: 409}); await tick();}
    f.switchPerson(); f.source.dispose(); assert.equal(f.requests.at(-1).signal.aborted, true);
    f.requests.at(-1).resolve(conflict ? {accountId: 'member', items: [profile()]} : {...profile(), name: 'New', revision: 5}); await saving;
    assert.equal(f.source.getSnapshot().managing, undefined); assert.equal(f.reported.length, 0);
  }
});

async function screenFixture(source: any) {
  const host = lifecycleHooks();
  const module = await screenModule(new URL('../src-next/screens/settings-live/server/PeopleMemberProfiles.tsx', import.meta.url), {
    react: host.react, 'react-native': {Text: 'Text', View: 'View'}, '../../../kit/artwork': {ProfileFace: 'ProfileFace'}, '../../../kit/controls': {Button: 'Button', TextField: 'TextField'}, '../../../kit/overlays': {BottomSheet: 'BottomSheet'}, '../../../kit/shell': {SettingsRow: 'SettingsRow'}, '../../../kit/states': {StateView: 'StateView'}, '../../../kit/theme': {useTheme: () => ({...theme, type: {body: {}, caption: {}}})},
    '../ProfileEditorFields': {ProfileColorPicker: 'ProfileColorPicker', ProfileRestrictionsFields: 'ProfileRestrictionsFields'}, './member-profiles-source': {NativeMemberProfilesSource: class {}},
  });
  const runtime = {text: {t}, error: () => ({title: 'Error'}), reportError: assert.fail};
  return {host, list: () => host.render(() => module.Profiles({source, runtime})), editor: (row: any) => host.render(() => module.MemberProfileEditor({source, runtime, profile: row}))};
}
const byID = (tree: any, id: string) => nodes(tree).find((node: any) => node.props.testID === id)!;

test('phone/tablet rows show real colour faces, chips and Manage; PIN confirmation dispatches only on confirm', async () => {
  const f = await fixture(); const row = await f.load(); const list = await screenFixture(f.source);
  const tree = list.list(); assert.match(content(tree), /Alex/); assert.match(content(tree), /profile.main/); assert.match(content(tree), /profile.protected/);
  const face = nodes(tree).find((node: any) => node.type === 'ProfileFace'); assert.equal(face.props.color, 'mint'); assert.equal(face.props.locked, true);
  byID(tree, 'people-profile-manage-alex').props.onPress();
  const screen = await screenFixture(f.source); byID(screen.editor(row), 'people-profile-remove-pin').props.onPress();
  assert.equal(f.requests.length, 2); assert.equal(byID(screen.editor(row), 'people-profile-pin-confirmation').props.open, true);
  byID(screen.editor(row), 'people-profile-confirm-remove-pin').props.onPress(); assert.equal(f.requests.length, 3);
  f.requests.at(-1).resolve({...profile(), revision: 5, pinRequired: false}); await tick();
  screen.host.dispose(); list.host.dispose(); f.source.dispose();
});

test('a stale PIN confirmation cannot approve a later confirmation for the same read', async () => {
  const f = await fixture(); const row = await f.load(); f.source.manage(row); f.source.askRemovePIN(row);
  const old = f.source.getSnapshot().pinConfirmation; f.source.cancelRemovePIN(); f.source.askRemovePIN(row);
  assert.notEqual(f.source.getSnapshot().pinConfirmation, old); assert.equal(await f.source.removePIN(row, old), false);
  assert.equal(f.requests.length, 2); f.source.dispose();
});

test('retained editor save cannot follow cancellation and reopening for the same person/profile/revision', async () => {
  const f = await fixture(); const row = await f.load(); f.source.manage(row); const screen = await screenFixture(f.source);
  byID(screen.editor(row), 'people-profile-rename').props.onPress();
  byID(screen.editor(row), 'people-profile-name').props.onChangeText('Old draft');
  const oldSave = byID(screen.editor(row), 'people-profile-save').props.onPress;
  const oldSheet = byID(screen.editor(row), 'people-profile-editor'); oldSheet.props.onOpenChange(false);
  byID(screen.editor(row), 'people-profile-rename').props.onPress();
  oldSave(); assert.equal(f.requests.length, 2);
  assert.equal(byID(screen.editor(row), 'people-profile-name').props.value, 'Alex');
  screen.host.dispose(); f.source.dispose();
});

test('Manage disappears if the current caller or target tier no longer allows editing', async () => {
  const f = await fixture(); await f.load(); const screen = await screenFixture(f.source);
  assert.ok(byID(screen.list(), 'people-profile-manage-alex'));
  f.context.account.account.role = 'admin'; f.person.role = 'admin';
  assert.equal(byID(screen.list(), 'people-profile-manage-alex'), undefined);
  f.context.account.account.role = 'owner'; f.person.role = 'owner';
  assert.equal(byID(screen.list(), 'people-profile-manage-alex'), undefined);
  screen.host.dispose(); f.source.dispose();
});
