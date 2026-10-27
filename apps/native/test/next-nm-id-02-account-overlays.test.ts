import test from 'node:test';
import assert from 'node:assert/strict';
import {React, fabricHost} from './helpers/fabric-host.mjs';
import {standardHomeApp} from './helpers/standard-home-app-harness.mjs';
import type {NativeShellBootstrapContext, RestoredNativeShellRuntime} from '../src-next/shell/bootstrap';
import type {NativeShellRoute} from '../src-next/shell/routes';

/**
 * NM-ID-02 / BLK-TV-005 / FX-155 account-overlay source. The standard-home app
 * supplies the actual bootstrapped runtime, real module resolution and native
 * host boundary; fabric-host mounts the actual AccountRoute on the installed
 * Fabric reconciler with the product focus registry and a TV theme. A healthy
 * in-memory server answers the real ManagedProfilesClient, IdentityClient and
 * restrictions reads, so every dialog below renders through the real account
 * screen and its own callbacks. Element state is UNRUN here.
 */

const profile = () => ({id: 'profile', name: 'Fixture profile', primary: true, position: 0, art: 'mint', revision: 1, pinRevision: 1, pinRequired: true});
const accountSnapshot = () => ({
  authority: 'local', serverId: '', canManage: true,
  capabilities: {manageAccount: true, managePeople: true, manageServer: true, manageSignIn: true},
  account: {id: 'account', username: 'fixture_owner', primaryProfileId: 'profile', role: 'owner', revision: 1, disabled: false, allowedLibraries: ['movies']},
  profiles: [profile()],
  session: {sessionFamilyId: 'fixture_family'},
});
const restrictions = (revision = 1) => ({profileId: 'profile', ratingSystem: 'mpaa', maximumAgeRating: 'PG', maximumAge: 10, blockedLabels: [],
  allowUnrated: true, allowDownloads: true, allowLiveTv: true, allowDvr: true, allowWatchTogether: true, revision});
const ratingSystems = () => ({items: [{id: 'mpaa', name: 'MPAA', region: 'US', screens: [], values: [{code: 'PG', label: 'PG', minimumAge: 10}]}]});

const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};};

test('NM-ID-02: the real account overlays attach their own root and action identities with a TV region', async () => {
  let holdAdd: ReturnType<typeof deferred> | undefined, holdLimits: ReturnType<typeof deferred> | undefined;
  const writes: {path: string; method: string; body?: unknown}[] = [];
  const app = await standardHomeApp({accountRole: 'owner', mountUI: false, nativeResponse: async (request: any, fixture: any) => {
    // The real direct-account read is the contract's `get_direct_account` = /v1/direct.
    if (request.path === '/v1/direct' && request.method === 'GET') return {status: 200, body: {...accountSnapshot(), serverId: fixture.pin.serverId}};
    if (request.path === '/v1/direct/profiles' && request.method === 'POST') {writes.push(request); if (holdAdd) await holdAdd.promise; return {status: 200, body: {}};}
    if (request.path === '/v1/direct/profiles/profile' && request.method === 'PATCH') {writes.push(request); return {status: 200, body: {}};}
    if (request.path === '/v1/direct/trust' && request.method === 'DELETE') {writes.push(request); return {status: 200, body: {}};}
    if (request.path === '/v1/direct/profiles/profile/restrictions' && request.method === 'GET') return {status: 200, body: restrictions()};
    if (request.path === '/v1/direct/profiles/profile/restrictions' && request.method === 'PUT') {
      writes.push(request); if (holdLimits) await holdLimits.promise;
      return {status: 200, body: restrictions(2)};
    }
    if (request.path === '/v1/rating-systems' && request.method === 'GET') return {status: 200, body: ratingSystems()};
    if (request.path === '/v1/direct/profiles/avatars' && request.method === 'GET') return {status: 200, body: {items: []}};
    return undefined;
  }});
  const host = await fabricHost();
  let runtime: RestoredNativeShellRuntime | undefined;
  let context: NativeShellBootstrapContext | undefined;
  try {
    const {restoreNativeShellRuntime} = await import('../src-next/shell/bootstrap');
    const {createNativeShellBindings} = await import('../src-next/shell/assembly');
    const {createFocusRegistry, focusTestID} = await import('../src-next/kit/focus/registry.ts');
    const {FocusProvider} = await import('../src-next/kit/focus/FocusRegion.tsx');
    const {ThemeProvider} = await import('../src-next/kit/theme.ts');
    const {AccountRoute} = await import('../src-next/screens/accounts/AccountRoutes.tsx');
    const {defaultI18n} = await import('../../../packages/i18n/src/index.ts');
    const {Platform} = await import('react-native');

    runtime = await restoreNativeShellRuntime(next => {context = next; return createNativeShellBindings(next);}, {onAuthorityEnded() {}});
    assert.ok(runtime);
    assert.ok(context);
    const booted = context;
    const route: NativeShellRoute = {kind: 'profiles'};
    assert.equal(booted.navigation.open(route, booted.authority()), true, 'the real navigation opened the profiles route the lease captures');
    const priorTV = Platform.isTV;
    (Platform as {isTV: boolean}).isTV = true;
    const registry = createFocusRegistry();
    const nodes = () => {
      const visit = (items: readonly any[]): any[] => items.flatMap(node => [node, ...visit(node.children ?? [])]);
      // standardHomeApp materialises the product's View/Text/Pressable boundaries in its own
      // host registry; host.root only carries the rendered raw text.
      return [...visit(host.root), ...app.hosts()];
    };
    const nodeWithTestID = (testID: string) => nodes().find(node => node.props?.testID === testID);
    const press = (node: any) => node.props.onPress({nativeEvent: {}, stopPropagation() {}});
    const label = (node: any) => app.nativeLabel(node);
    const settle = async () => {await host.settle(); await app.settle();};
    // A closed dialog keeps its surface for its own exit delay, so a retirement or
    // restored-focus assertion waits for that actual timer instead of racing it.
    const settleOverlay = async () => {await settle(); await new Promise<void>(done => setTimeout(done, 420)); await settle();};
    const leaf = (id: string, childId: string) => registry.child({regionId: id, childId});
    const leafNode = (id: string, childId: string) => nodeWithTestID(focusTestID(id, childId));

    try {
      await host.render(React.createElement(ThemeProvider, {width: 1920, children: React.createElement(FocusProvider, {registry, children:
        React.createElement(AccountRoute, {route, context: booted})})}));
      await settle();
      assert.equal(registry.order('profile-add').length, 0, 'no overlay is mounted before it is opened');

      // Add: its own modal root region with the field and the footer Cancel. The dialogs draw
      // the phone close X only when !isTV, and Save is ineligible until the name is non-empty,
      // so neither is attached yet; the root still holds focus inside itself on TV.
      const add = nodes().find(node => node.name === 'Pressable' && label(node) === defaultI18n.t('profile.add'));
      assert.ok(add, 'the real profile page offers Add');
      press(add);
      await settle();
      assert.ok(leaf('profile-add', 'cancel'), 'the dialog root region carries its footer Cancel');
      assert.ok(leaf('profile-add', 'profile-add-name'), 'the dialog field is attached in that same root region');
      assert.equal(registry.config('profile-add')?.hold, true, 'the TV dialog root holds focus inside itself');
      assert.equal(registry.order('profile-add').includes('save'), false, 'Save is ineligible until a name is typed');
      const roots = ['profile-add', 'profile-rename', 'profile-pin-edit', 'profile-remove-pin', 'profile-forget-devices', 'profile-limits'];
      const derived = roots.flatMap(root => ['cancel', 'save'].map(child => focusTestID(root, child)));
      assert.equal(new Set(derived).size, derived.length, 'each overlay keeps distinct live leaf identities');

      // A busy Add keeps the exact same binding and becomes disabled, then enabling still uses it.
      const addName = nodeWithTestID('profile-add-name');
      assert.ok(addName);
      addName.props.onChangeText('Second profile');
      await settle();
      holdAdd = deferred();
      const addSave = leafNode('profile-add', 'save');
      assert.ok(addSave);
      press(addSave);
      await settle();
      assert.equal(leafNode('profile-add', 'save')?.props.disabled, true, 'busy Save keeps its identity and is ineligible');
      assert.equal(leafNode('profile-add', 'cancel')?.props.disabled, true, 'busy also disables Cancel');
      holdAdd.resolve(); holdAdd = undefined;
      await settleOverlay();
      assert.equal(leaf('profile-add', 'save'), undefined, 'the accepted add closes its own dialog');
      assert.equal(writes.filter(write => write.method === 'POST').length, 1);

      // Rename: Cancel is a safe close with no write.
      press(nodeWithTestID('profile-rename')!);
      await settle();
      assert.ok(leaf('profile-rename', 'cancel') && leaf('profile-rename', 'save'));
      const patches = writes.filter(write => write.method === 'PATCH').length;
      press(leafNode('profile-rename', 'cancel')!);
      await settleOverlay();
      assert.equal(leaf('profile-rename', 'cancel'), undefined, 'Cancel closes the rename overlay');
      assert.equal(writes.filter(write => write.method === 'PATCH').length, patches, 'Cancel dispatches no edit');

      // PIN, Remove PIN and Forget devices each keep their own root and leaves.
      press(nodeWithTestID('profile-pin')!);
      await settle();
      // Save stays ineligible until both real PIN fields hold four digits.
      assert.ok(leaf('profile-pin-edit', 'cancel'), 'the PIN dialog root carries its Cancel');
      assert.equal(leaf('profile-pin-edit', 'save'), undefined, 'PIN Save is ineligible before a complete PIN');
      nodeWithTestID('profile-pin-new')!.props.onChangeText('1234');
      nodeWithTestID('profile-pin-again')!.props.onChangeText('1234');
      await settle();
      assert.ok(leaf('profile-pin-edit', 'save'), 'the completed PIN enables its Save leaf in the same root');
      press(leafNode('profile-pin-edit', 'cancel')!);
      await settleOverlay();
      press(nodeWithTestID('profile-remove-pin')!);
      await settle();
      assert.ok(leaf('profile-remove-pin', 'cancel') && leaf('profile-remove-pin', 'remove-pin'));
      press(leafNode('profile-remove-pin', 'cancel')!);
      await settleOverlay();
      press(nodeWithTestID('profile-forget-devices')!);
      await settle();
      assert.ok(leaf('profile-forget-devices', 'cancel') && leaf('profile-forget-devices', 'forget-devices'));
      press(leafNode('profile-forget-devices', 'cancel')!);
      await settleOverlay();

      // Back closes from inside the overlay's own back handler; it is still the same binding.
      press(nodeWithTestID('profile-remove-pin')!);
      await settle();
      await app.back();
      await settleOverlay();
      assert.equal(leaf('profile-remove-pin', 'cancel'), undefined, 'Back closes the overlay without acting');

      // Limits: the existing root stays, with the rating Select and mapped switches attached.
      press(nodeWithTestID('profile-limits')!);
      await settle();
      assert.ok(leaf('profile-limits', 'cancel') && leaf('profile-limits', 'save'));
      assert.ok(leaf('profile-limits', 'maximum-age-rating'), 'the rating Select keeps its caller identity');
      assert.ok(nodeWithTestID('profile-limits-maximum-age-rating'), 'the Select trigger keeps the fix testID');
      assert.ok(leaf('profile-limits', 'allow-unrated'));
      for (const key of ['allowDownloads', 'allowLiveTv', 'allowDvr', 'allowWatchTogether']) assert.ok(leaf('profile-limits', `feature:${key}`));
      // The Select trigger keeps its caller testID on the drawn host (its focus child is the
      // same identifier), so press that actual host rather than a second derived name.
      press(nodeWithTestID('profile-limits-maximum-age-rating')!);
      await settleOverlay();
      // The picker's Dialog derives its own root from that same caller testID. The TV sheet
      // without an explicit initialFocusRef takes focus through the native guide, which this
      // mounted host does not run, so the claim is the picker's own region, not a captured focus.
      assert.equal(registry.config('profile-limits-maximum-age-rating-picker')?.id, 'profile-limits-maximum-age-rating-picker', 'the nested picker is its own region from the caller testID');
      assert.ok(nodeWithTestID('profile-limits-maximum-age-rating-picker'), 'the picker mounts its own drawn surface');
      assert.ok(leaf('profile-limits', 'maximum-age-rating'), 'the limits root still holds the trigger while the picker is open');
      await app.back();
      await settleOverlay();
      assert.equal(nodeWithTestID('profile-limits-maximum-age-rating-picker'), undefined, 'Back dismisses the picker');
      assert.ok(leaf('profile-limits', 'maximum-age-rating') && leaf('profile-limits', 'cancel'), 'Back leaves the limits sheet with its own leaves');
      holdLimits = deferred();
      const limitSave = leafNode('profile-limits', 'save');
      assert.ok(limitSave);
      press(limitSave);
      await settle();
      assert.equal(leafNode('profile-limits', 'save')?.props.disabled, true, 'busy limits Save keeps its identity');
      holdLimits.resolve(); holdLimits = undefined;
      await settleOverlay();
      assert.equal(leaf('profile-limits', 'cancel'), undefined, 'the accepted limits save closes the sheet');
      const put = writes.filter(write => write.method === 'PUT');
      assert.equal(put.length, 1);
      assert.equal((put[0]!.body as {expectedRevision?: number}).expectedRevision, 1);
      assert.notEqual(registry.capture()?.regionId, 'profile-limits', 'the sheet leaves no focus inside its removed region');
    } finally {
      (Platform as {isTV: boolean}).isTV = priorTV;
      await host.unmount();
    }
  } finally {
    try {
      await host.unmount();
    } finally {
      try {
        await app.unmount();
      } finally {
        try {
          app.disposeLoader();
        } finally {
          runtime?.dispose();
        }
      }
    }
  }
});
