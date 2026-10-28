import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

function nodes(value: any): any[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  return value?.props ? [value, ...nodes(value.props.children), ...nodes(value.props.footer), ...nodes(value.props.beforeActions)] : [];
}
const byID = (tree: any, id: string) => {const found = nodes(tree).find(node => node.props.testID === id); assert.ok(found, id); return found;};
const dialog = (tree: any, id: string) => {const found = nodes(tree).find(node => node.type === 'Dialog' && node.props.testID === id); assert.ok(found, id); return found;};
const footerAction = (sheet: any, id: string) => {const found = nodes(sheet.props.footer).find(node => node.props.focusId === id); assert.ok(found, id); return found.props.onPress;};
const actionSheet = (tree: any, name: string) => {const found = nodes(tree).find(node => node.type === 'BottomSheet' && node.props.title === name); assert.ok(found, name); return found;};
const text = (value: any): string => Array.isArray(value) ? value.map(text).join('') : typeof value === 'string' ? value : value?.props ? text(value.props.children) : '';
const tick = async () => {for (let count = 0; count < 5; count++) await Promise.resolve();};

async function fixture(main = true, pinRequired = false) {
  const host = hooks(), limitsHost = hooks(), writes: any[] = [];
  let renderingHost = host;
  const react: any = {};
  for (const [name, value] of Object.entries(host.react)) if (typeof value === 'function') react[name] = (...args: unknown[]) => (renderingHost.react as any)[name](...args);
  react.useLayoutEffect = (effect: () => void, deps: readonly unknown[]) => renderingHost.react.useMemo(effect, deps); react.default = react;
  const primary = {id: 'main', name: 'Main', art: 'blue', primary: true, pinRequired: false, position: 0, revision: 2, pinRevision: 1};
  const other = {id: 'other', name: 'Other', art: 'mint', primary: false, pinRequired, position: 1, revision: 7, pinRevision: 2};
  let profiles = [primary, other];
  const preview = {profileId: other.id, name: other.name, revision: 7, primary: false};
  const route = {kind: 'shell', destination: {kind: 'settings'}};
  const authority = {serverId: 'server', accountId: 'account', profileId: main ? primary.id : other.id, epoch: 'one', viewerFence: 'fixture'};
  const session = {sessionFamilyId: 'family', viewer: authority};
  const snapshot = {route, revision: 1};
  const context: any = {current: () => true, authority: () => authority, subscribeAuthority: () => () => {}, session: () => session,
    navigation: {getSnapshot: () => snapshot, subscribe: () => () => {}},
    api: {}, account: {serverId: 'server', canManage: true, capabilities: {manageAccount: true}, account: {id: 'account', primaryProfileId: primary.id, disabled: false}, profiles}};
  const colors = new Proxy({}, {get: () => '#123456'}), type = new Proxy({}, {get: () => ({})});
  const modules: any = {
    react, 'react-native': {BackHandler: {addEventListener: () => ({remove() {}})}, Dimensions: {get: () => ({width: 390, height: 844})}, NativeModules: {}, Platform: {isTV: false}, Text: 'Text', View: 'View'},
    '../../../../../packages/i18n/src': {defaultI18n: {t: (id: string) => id}},
    '../../../../../packages/client-core/src/presentation/errors': {presentError: () => ({body: 'fixture failure'})},
    '../../../../../packages/client-core/src/profile-management': {ManagedProfilesClient: class {
      async list() {return profiles;}
      async create(name: string, art: string) {writes.push({kind: 'create', name, art});}
      async edit(target: any, change: any) {writes.push({kind: 'edit', target, change});}
      async forgetTrust(profileId: string) {writes.push({kind: 'forget', profileId});}
      async order(next: typeof profiles) {writes.push({kind: 'order', profiles: next}); profiles = [...next];}
      async previewDelete(target: any) {writes.push({kind: 'preview', target}); return preview;}
      async delete(target: any) {writes.push({kind: 'delete', target}); profiles = profiles.filter(profile => profile.id !== target.profileId);}
    }},
    '../../../../../packages/client-core/src/identity-client': {IdentityClient: class {
      async restrictions(profileId: string) {return {profileId, revision: 3, ratingSystem: 'us', maximumAgeRating: '', allowUnrated: true, allowDownloads: true, allowLiveTv: true, allowDvr: true, allowWatchTogether: true, blockedLabels: []};}
      async ratingSystems() {return [{id: 'us', values: []}];}
      async saveRestrictions(previous: any, change: any) {writes.push({kind: 'limits', previous, change}); return {...previous, ...change, revision: previous.revision + 1};}
    }},
    '../../../../../packages/client-core/src': {HttpHostedApi: class {constructor() {throw new Error('Unexpected Hosted contact');}}},
    '../../../../../packages/client-core/src/route-identity': {routeOrigin: (value: string) => value},
    '../../platform/accounts': {}, '../../platform/app-session-storage': {}, '../../platform/profile-selection': {}, '../../platform/profile-recovery': {}, '../../platform/account-authority': {},
    '../../platform/profile-avatars': {profileAvatarUpload: () => ({}), profilePictureSource: () => undefined}, '../../platform/server-connections': {},
    '../settings-live/lifetime': {NativeScreenLifetime: class {current = () => true; dispose() {}}},
    '../../shell/model': {sameAuthority: (left: unknown, right: unknown) => left === right},
    '../../shell/route-registry': {nativeShellRoutes: {registerRoute() {}}},
    '../../kit/states': {StateLayout: 'StateLayout', StateView: 'StateView'}, '../../kit/artwork': {ProfileFace: 'ProfileFace', ProfilePicker: 'ProfilePicker'},
    '../../kit/controls': {Button: 'Button', Focusable: 'Focusable', Select: 'Select', Switch: 'Switch', TextField: 'TextField'},
    '../../kit/overlays': {BottomSheet: 'BottomSheet', Dialog: 'Dialog'}, '../../kit/Icon': {Icon: 'Icon'},
    '../../../platform/offline-downloads': {}, '../../kit/theme': {useTheme: () => ({colors, type, isTV: false})},
    './AccountEntry': {}, './downloads-entry': {}, './PhonePINEntry': {}, './PhoneProfileRecovery': {}, './PhoneServerChooser': {}, './TVTrustedCertificates': {}, './TVServerChooser': {}, './sign-out-downloads': {}, '../../tv/auth': {},
  };
  const {ProfileRoute} = await screenModule(new URL('../src-next/screens/accounts/AccountRoutes.tsx', import.meta.url), modules);
  const render = () => {renderingHost = host; return host.render(() => ProfileRoute({context, route, onBack() {}, embedded: true}));};
  const renderLimits = (element: any) => {renderingHost = limitsHost; try {return limitsHost.render(() => element.type(element.props));} finally {renderingHost = host;}};
  render(); // Publish the committed profile lease before interacting.
  return {render, renderLimits, writes, primary, other, preview, context};
}

test('embedded profile list manages another profile without changing the viewer and orders real revisions', async () => {
  const f = await fixture();
  byID(f.render(), 'settings-profile-other').props.onPress();
  const move = byID(f.render(), 'profile-move-up'); move.props.onPress(); await tick();
  assert.equal(f.context.session().viewer.profileId, f.primary.id);
  assert.deepEqual(f.writes[0], {kind: 'order', profiles: [f.other, f.primary]});
  assert.equal(nodes(f.render()).some(node => node.type === 'ProfilePicker'), false);
});

test('closed profile actions and a cancelled deletion cannot submit through retained callbacks', async () => {
  const f = await fixture(); byID(f.render(), 'settings-profile-other').props.onPress();
  const oldMove = byID(f.render(), 'profile-move-up').props.onPress;
  const actionSheet = nodes(f.render()).find(node => node.type === 'BottomSheet' && node.props.title === f.other.name)!;
  actionSheet.props.onOpenChange(false); oldMove(); await tick(); assert.deepEqual(f.writes, []);
  byID(f.render(), 'settings-profile-other').props.onPress();
  const deletionAction = nodes(f.render()).find(node => node.type === 'Button' && text(node) === 'profile.delete' && !node.props.loading)!;
  deletionAction.props.onPress(); await tick();
  let deletionSheet = nodes(f.render()).find(node => node.type === 'BottomSheet' && node.props.title === 'profile.delete')!;
  assert.equal(deletionSheet.props.open, true);
  nodes(deletionSheet).find(node => node.type === 'TextField')!.props.onChangeText(f.other.name);
  deletionSheet = nodes(f.render()).find(node => node.type === 'BottomSheet' && node.props.title === 'profile.delete')!;
  const retainedDelete = nodes(deletionSheet.props.footer).find(node => node.type === 'Button' && text(node) === 'profile.delete')!.props.onPress;
  deletionSheet.props.onOpenChange(false); retainedDelete(); await tick();
  assert.equal(f.writes.filter(value => value.kind === 'delete').length, 0);
});

test('secondary profiles have no management powers even when a stale account snapshot claims canManage', async () => {
  const f = await fixture(false);
  const row = byID(f.render(), 'settings-profile-main'); assert.equal(row.props.disabled, true);
  row.props.onPress();
  assert.equal(nodes(f.render()).some(node => node.props.testID === 'profile-actions'), false);
  assert.equal(nodes(f.render()).some(node => node.props.testID === 'settings-profile-add'), false);
  assert.deepEqual(f.writes, []);
});

test('every editor opener retires with its original profile action sheet', async () => {
  const f = await fixture(true, true); byID(f.render(), 'settings-profile-other').props.onPress();
  const shown = f.render();
  const retained = ['profile-rename', 'profile-pin', 'profile-remove-pin', 'profile-forget-devices', 'profile-limits'].map(id => byID(shown, id).props.onPress);
  actionSheet(shown, f.other.name).props.onOpenChange(false);
  for (const open of retained) open();
  assert.equal(nodes(f.render()).some(node => node.type === 'Dialog' && node.props.open), false);
  assert.equal(nodes(f.render()).some(node => typeof node.type === 'function' && node.type.name === 'ProfileLimitsSheet'), false);
  byID(f.render(), 'settings-profile-main').props.onPress();
  for (const open of retained) open();
  assert.equal(nodes(f.render()).some(node => node.type === 'Dialog' && node.props.open), false, 'a different selected profile does not renew old action callbacks');
  assert.deepEqual(f.writes, []);
});

test('rename Save, Cancel and input belong to one opening and the current draft', async () => {
  const f = await fixture(); byID(f.render(), 'settings-profile-other').props.onPress();
  byID(f.render(), 'profile-rename').props.onPress();
  byID(f.render(), 'profile-rename-name').props.onChangeText('First draft');
  const old = dialog(f.render(), 'profile-rename'), oldSave = footerAction(old, 'save'), oldCancel = footerAction(old, 'cancel');
  const oldInput = byID(old, 'profile-rename-name').props.onChangeText;
  oldCancel();
  byID(f.render(), 'profile-rename').props.onPress();
  byID(f.render(), 'profile-rename-name').props.onChangeText('New name');
  oldInput('Late edit'); oldCancel(); oldSave(); await tick();
  let current = dialog(f.render(), 'profile-rename');
  assert.equal(current.props.open, true); assert.equal(byID(current, 'profile-rename-name').props.value, 'New name'); assert.deepEqual(f.writes, []);
  const retainedSave = footerAction(current, 'save');
  byID(current, 'profile-rename-name').props.onChangeText(''); retainedSave(); await tick();
  assert.deepEqual(f.writes, [], 'a previously valid Save cannot submit after a synchronous invalid edit');
  byID(f.render(), 'profile-rename-name').props.onChangeText('Saved name');
  current = dialog(f.render(), 'profile-rename'); footerAction(current, 'save')(); await tick();
  assert.deepEqual(f.writes, [{kind: 'edit', target: f.other, change: {name: 'Saved name'}}]);
  assert.equal(dialog(f.render(), 'profile-rename').props.open, false);
});

test('PIN editor cannot submit or overwrite a reopened draft through retained handlers', async () => {
  const f = await fixture(); byID(f.render(), 'settings-profile-other').props.onPress();
  byID(f.render(), 'profile-pin').props.onPress();
  byID(f.render(), 'profile-pin-new').props.onChangeText('2468'); byID(f.render(), 'profile-pin-again').props.onChangeText('2468');
  const old = dialog(f.render(), 'profile-pin-edit'), oldSave = footerAction(old, 'save'), oldCancel = footerAction(old, 'cancel');
  const oldInput = byID(old, 'profile-pin-new').props.onChangeText;
  oldCancel(); byID(f.render(), 'profile-pin').props.onPress();
  byID(f.render(), 'profile-pin-new').props.onChangeText('1357'); byID(f.render(), 'profile-pin-again').props.onChangeText('1357');
  oldInput('0000'); oldCancel(); oldSave(); await tick();
  const current = dialog(f.render(), 'profile-pin-edit');
  assert.equal(current.props.open, true); assert.equal(byID(current, 'profile-pin-new').props.value, '1357'); assert.deepEqual(f.writes, []);
  footerAction(current, 'save')(); await tick();
  assert.deepEqual(f.writes, [{kind: 'edit', target: f.other, change: {pin: '1357'}}]);
});

test('remove PIN and forget-devices confirmations cannot follow another editor opening', async () => {
  const f = await fixture(true, true); byID(f.render(), 'settings-profile-other').props.onPress();
  byID(f.render(), 'profile-remove-pin').props.onPress();
  const oldRemove = dialog(f.render(), 'profile-remove-pin'), remove = footerAction(oldRemove, 'remove-pin');
  footerAction(oldRemove, 'cancel')(); byID(f.render(), 'profile-forget-devices').props.onPress();
  const oldForget = dialog(f.render(), 'profile-forget-devices'), forget = footerAction(oldForget, 'forget-devices');
  footerAction(oldForget, 'cancel')(); byID(f.render(), 'profile-remove-pin').props.onPress();
  remove(); forget(); oldForget.props.onOpenChange(false); await tick();
  assert.deepEqual(f.writes, []); assert.equal(dialog(f.render(), 'profile-remove-pin').props.open, true);
  footerAction(dialog(f.render(), 'profile-remove-pin'), 'remove-pin')(); await tick();
  assert.deepEqual(f.writes, [{kind: 'edit', target: f.other, change: {pin: ''}}]);
  byID(f.render(), 'profile-forget-devices').props.onPress(); footerAction(dialog(f.render(), 'profile-forget-devices'), 'forget-devices')(); await tick();
  assert.deepEqual(f.writes[1], {kind: 'forget', profileId: f.other.id});
});

test('limits use an opening-specific lease and a retired Close cannot close reopened limits', async () => {
  const f = await fixture(); byID(f.render(), 'settings-profile-other').props.onPress();
  byID(f.render(), 'profile-limits').props.onPress();
  const limits = (tree: any) => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'ProfileLimitsSheet');
  const old = limits(f.render()); assert.ok(old); assert.equal(old.props.lease.current(), true);
  old.props.onClose(); assert.equal(old.props.lease.current(), false);
  byID(f.render(), 'profile-limits').props.onPress(); const current = limits(f.render()); assert.ok(current);
  old.props.onClose(); old.props.onSaved(); assert.equal(current.props.lease.current(), true); assert.ok(limits(f.render()));
  actionSheet(f.render(), f.other.name).props.onOpenChange(false); assert.equal(current.props.lease.current(), false);
  assert.deepEqual(f.writes, []);
});

test('Add has an independent opening outside the profile sheet and ignores a cancelled draft', async () => {
  const f = await fixture(); byID(f.render(), 'settings-profile-add').props.onPress();
  byID(f.render(), 'profile-add-name').props.onChangeText('First');
  const old = dialog(f.render(), 'profile-add'), save = footerAction(old, 'save'), cancel = footerAction(old, 'cancel');
  const input = byID(old, 'profile-add-name').props.onChangeText;
  cancel(); byID(f.render(), 'settings-profile-add').props.onPress(); byID(f.render(), 'profile-add-name').props.onChangeText('Created');
  input('Late'); cancel(); save(); await tick();
  const current = dialog(f.render(), 'profile-add'); assert.equal(current.props.open, true); assert.equal(byID(current, 'profile-add-name').props.value, 'Created'); assert.deepEqual(f.writes, []);
  footerAction(current, 'save')(); await tick(); assert.deepEqual(f.writes, [{kind: 'create', name: 'Created', art: 'blue'}]);
});

test('limits inputs, Save and Cancel cannot cross an opening or submit a replaced draft', async () => {
  const f = await fixture(); byID(f.render(), 'settings-profile-other').props.onPress(); byID(f.render(), 'profile-limits').props.onPress();
  const limits = (tree: any) => nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'ProfileLimitsSheet');
  const first = limits(f.render()); f.renderLimits(first); await tick();
  const old = f.renderLimits(first), oldSave = footerAction(old, 'save'), oldCancel = footerAction(old, 'cancel');
  const oldInput = nodes(old).find(node => node.props.focusId === 'allow-unrated')!.props.onCheckedChange;
  first.props.onClose(); byID(f.render(), 'profile-limits').props.onPress();
  const next = limits(f.render()); f.renderLimits(next); await tick();
  oldInput(false); oldSave(); oldCancel(); await tick();
  let current = f.renderLimits(next);
  assert.equal(next.props.lease.current(), true); assert.equal(nodes(current).find(node => node.props.focusId === 'allow-unrated')!.props.checked, true); assert.deepEqual(f.writes, []);
  const staleDraftSave = footerAction(current, 'save');
  nodes(current).find(node => node.props.focusId === 'allow-unrated')!.props.onCheckedChange(false);
  staleDraftSave(); await tick(); assert.deepEqual(f.writes, []);
  current = f.renderLimits(next); footerAction(current, 'save')(); await tick();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].kind, 'limits'); assert.equal(f.writes[0].previous.profileId, f.other.id); assert.equal(f.writes[0].previous.revision, 3); assert.equal(f.writes[0].change.allowUnrated, false);
  assert.equal(next.props.lease.current(), false);
});

test('named deletion checks the current confirmation input and keeps the exact preview receipt', async () => {
  const f = await fixture(); byID(f.render(), 'settings-profile-other').props.onPress();
  const action = nodes(f.render()).find(node => node.type === 'Button' && text(node) === 'profile.delete' && !node.props.loading)!;
  action.props.onPress(); await tick();
  let sheet = actionSheet(f.render(), 'profile.delete');
  nodes(sheet).find(node => node.type === 'TextField')!.props.onChangeText(f.other.name);
  sheet = actionSheet(f.render(), 'profile.delete');
  const stale = nodes(sheet.props.footer).find(node => node.type === 'Button' && text(node) === 'profile.delete')!.props.onPress;
  nodes(sheet).find(node => node.type === 'TextField')!.props.onChangeText(''); stale(); await tick();
  assert.equal(f.writes.filter(value => value.kind === 'delete').length, 0);
  nodes(actionSheet(f.render(), 'profile.delete')).find(node => node.type === 'TextField')!.props.onChangeText(f.other.name);
  sheet = actionSheet(f.render(), 'profile.delete');
  nodes(sheet.props.footer).find(node => node.type === 'Button' && text(node) === 'profile.delete')!.props.onPress(); await tick();
  assert.deepEqual(f.writes.filter(value => value.kind === 'delete'), [{kind: 'delete', target: f.preview}]);
  assert.equal(actionSheet(f.render(), 'profile.delete').props.open, false);
});
