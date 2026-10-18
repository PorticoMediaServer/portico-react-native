/**
 * Signing in elsewhere from Settings › Servers, with the real session: the SessionProvider, its
 * ViewerSelectionCommit and the app's Root (App.tsx), the real sign-in mode, leaveSignIn,
 * SignInElsewhere and HostedChooser. Only the device, storage, network and server answers are
 * stubbed (session-hook/direct/hosted loaders).
 *
 * The browsing shell is never mounted while a sign-in is under way or nobody is signed in, and the
 * sign-in's lifetime is the session's to say, not what happens to be on screen:
 * - a new viewer being checked sets the old one aside for a moment; that sign-in stays on screen
 *   with what it kept, and a refusal puts the old viewer back into it, not into browsing;
 * - an accepted sign-in ends it, even to the same server, account and profile, rendered or not;
 * - Back abandons everything it began, a Portico server being opened included, whatever the
 *   remembered sign-in is doing, and leaves that sign-in's confirmation alone;
 * - a named server opens once: cancelling its profiles lists the account's servers;
 * - leaving a server's profiles while the one chosen is checked gives the viewer set aside back,
 *   into that sign-in, and its Back still returns them where they were; an ending meanwhile doesn't.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {register, createRequire} from 'node:module';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {act, createHookHost} from './hook-driver.ts';
import {auth, nativeViewerStorage, profileAPI} from './session-hook-stub.mjs';
import {direct} from './session-direct-stub.mjs';
import {portico, selection} from './session-hosted-stub.mjs';
import {screenModule} from './helpers/screen-harness.mjs';
import {signInMode} from '../src/app/sign-in-mode.ts';
import {linkViewerKey} from '../src/shell/pending-link.ts';
import * as core from '../../../packages/client-core/src/index.ts';
import {selectedViewerRecord} from '../../../packages/client-core/src/viewer-selection.ts';
register(new URL('./session-hook-loader.mjs', import.meta.url));
register(new URL('./session-direct-loader.mjs', import.meta.url));
register(new URL('./session-hosted-loader.mjs', import.meta.url));
(globalThis as {__DEV__?: boolean}).__DEV__ = false;
// Nothing here reaches a network.
globalThis.fetch = async () => new Response('{}', {status: 200});
const {SessionProvider, viewer} = await import('../src/app/session.tsx');

const React = createRequire(import.meta.url)('react');
const loose = (named: Record<string, unknown> = {}): any => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
const modulesOf = (given: Record<string, unknown>) => new Proxy(given, {get: (target, name) => target[name as string] ?? loose()});
const react = {react: {...React, default: React}};

let current: any;
let back: (() => boolean) | undefined;
const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
const file = join(await mkdtemp(join(tmpdir(), 'portico-handoff-')), 'App.tsx');
await writeFile(file, source.replace('function Root(', 'export function Root(').replace('export default function App(', 'function App('));
const {Root} = await screenModule(pathToFileURL(file), modulesOf({
  ...react, './src/app/session': {useSession: () => current}, './src/app/sign-in-mode': {signInMode}, './src/shell/pending-link': {linkViewerKey},
  './src/screens/auth/AuthFlow': {AuthFlow: 'AuthFlow'}, './src/screens/auth/DirectProfiles': {DirectProfiles: 'DirectProfiles'},
  './src/screens/auth/SignInElsewhere': {SignInElsewhere: 'SignInElsewhere'}, './src/shell/Shell': {Shell: 'Shell'},
}));
const {HostedChooser} = await screenModule(new URL('../src/screens/auth/HostedChooser.tsx', import.meta.url), modulesOf({
  ...react, '../../../../../packages/client-core/src/index': core, '../../app/session': {useSession: () => current},
  '../../app/i18n': {useI18n: () => ({t: (id: string) => id})}, '../../ui': loose({useTheme: () => ({space: {}, isTV: false})}),
}));
const {SignInElsewhere, leaveSignIn} = await screenModule(new URL('../src/screens/auth/SignInElsewhere.tsx', import.meta.url), modulesOf({
  ...react, '../../app/session': {useSession: () => current}, '../../app/sign-in-mode': {signInMode},
  'react-native': {BackHandler: {addEventListener: (_: string, f: () => boolean) => { back = f; return {remove: () => { if (back === f) back = undefined; }}; }}, TVEventControl: {enableTVMenuKey() {}, disableTVMenuKey() {}}},
  '../../ui': {useTheme: () => ({isTV: false})}, '../../app/i18n': {useI18n: () => ({t: (id: string) => id})},
  './DirectSignIn': {DirectSignIn: 'DirectSignIn'}, './HostedChooser': {HostedChooser},
}));

const person = {authority: 'local', accountId: 'account', profileId: 'profile', serverId: 'server', role: 'owner'};
const session = (accessToken: string, sessionFamilyId: string, who: object = person) => ({accessToken, refreshToken: 'r'.repeat(43), expiresAt: new Date(Date.now() + 600000).toISOString(), sessionFamilyId, tokenGeneration: '1', authorizationHorizon: new Date(Date.now() + 1200000).toISOString(), deviceId: 'device', viewer: who});
const old = session('old-token', 'old-family');
const key = linkViewerKey(old.viewer as any);
const place = {routes: [{name: 'SettingsRoot'}], index: 0};
const named = (node: any) => (typeof node?.type === 'function' ? node.type.name : node?.type);
function all(node: unknown, out: any[] = []): any[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node);
  all((node as any).props?.children, out);
  return out;
}

/**
 * The app as mounted: the provider and Root, and below Root the real SignInElsewhere and
 * HostedChooser while Root shows the sign-in. They unmount when Root shows anything else and mount
 * afresh when it shows the sign-in again, as React would.
 */
async function app({saved = 'confirmed'}: {saved?: 'confirmed' | 'offline'} = {}) {
  viewer.clear();
  signInMode.close();
  signInMode.settle(null);
  auth.saved = selectedViewerRecord('http://server.test', old) as any;
  auth.chosen = old as any; auth.revoked = []; auth.writes = []; auth.me = undefined;
  auth.restore = saved === 'offline' ? async () => { throw new Error('offline'); } : async () => ({api: profileAPI('http://server.test', old.accessToken), session: old});
  portico.result = undefined; portico.opened = 0; portico.retired = [];
  selection.session = undefined; selection.signals = [];
  const shown: string[] = [];
  let root: any;
  let chooser: any;
  const host = createHookHost(() => {
    current = (SessionProvider({children: null}) as any).props.value;
    root = Root();
    if (shown.at(-1) !== named(root)) shown.push(named(root));
  });
  let below: ReturnType<typeof createHookHost> | undefined;
  let props: any;
  const sync = () => {
    if (named(root) !== 'SignInElsewhere') { below?.unmount(); below = undefined; chooser = undefined; return; }
    props = root.props;
    if (!below) { below = createHookHost(() => { const el = SignInElsewhere(props) as any; chooser = el.type === HostedChooser ? HostedChooser(el.props) : el; }); below.mount(); } else below.rerender();
  };
  const settle = async (work: () => unknown = () => {}) => {
    await act(async () => { await work(); });
    for (let i = 0; i < 4; i++) await act(sync);
  };
  await settle(() => host.mount());
  assert.equal(named(root), 'Shell', 'signed in, browsing');
  return {
    shown, settle, host, get root() { return root; }, get chooser() { return chooser; },
    async open(request: object, opener = 'opener') {
      // Settings › Servers opens it; the shell keeps where it was for this viewer as it goes.
      await settle(() => { signInMode.open(key, request as any, opener); signInMode.keepShell(key, place); });
      assert.ok(['SignInElsewhere', 'DirectProfiles'].includes(named(root)), 'the sign-in, on the whole screen');
      shown.splice(0, shown.length, named(root));
    },
    async stop() { auth.me = undefined; await act(() => { current.signOut(); below?.unmount(); host.unmount(); }); viewer.clear(); signInMode.close(); signInMode.settle(null); },
  };
}

/** A direct sign-in to `token`, its `/v1/me` held until `answer`. */
async function heldDirect(a: Awaited<ReturnType<typeof app>>, token: string) {
  await a.open({kind: 'direct'});
  await a.settle(() => current.direct.setOrigin('server.test'));
  direct.result = {kind: 'signed-in', session: session(token, token + '-family'), accountScoped: false, passwordChangeRequired: false};
  let answer!: (value: unknown) => void, refuse!: (e: unknown) => void;
  auth.me = () => new Promise((resolve, reject) => { answer = resolve; refuse = reject; });
  const work = current.direct.signIn('person', 'password') as Promise<void>;
  await a.settle();
  assert.equal(viewer.getSnapshot().session, undefined, 'the old viewer is set aside while the new one is checked');
  return {work, answer: (v: unknown) => answer(v), refuse: (e: unknown) => refuse(e)};
}

test('a new viewer\'s check refused: the sign-in stays, with its error, and Back still returns to the viewer where they were', async () => {
  const a = await app();
  try {
    const held = await heldDirect(a, 'new-token');
    assert.equal(named(a.root), 'SignInElsewhere', 'the sign-in, not the sign-in screens and not browsing');
    assert.deepEqual(signInMode.current(null), {kind: 'direct'});
    await a.settle(() => held.refuse(new Error('verification refused')));
    await held.work;
    assert.deepEqual(a.shown, ['SignInElsewhere'], 'never AuthFlow, never the shell');
    assert.equal(current.session?.accessToken, 'old-token', 'the old viewer is back');
    assert.deepEqual(signInMode.current(key), {kind: 'direct'}, 'still signing in');
    assert.notEqual(current.error, '', 'the sign-in says why');
    assert.deepEqual(auth.revoked, ['new-token'], 'only the unused new sign-in is retired');
    // Back: the viewer, where they were.
    await a.settle(() => leaveSignIn(current));
    assert.equal(named(a.root), 'Shell');
    assert.equal(signInMode.takeShell(key), place, 'the shell\'s place, kept through the handoff');
    assert.equal(signInMode.takeOpener(key), 'opener');
  } finally { await a.stop(); }
});

test('a new viewer\'s check accepted, the same server, account and profile again: the sign-in ends in the new viewer\'s shell', async () => {
  const a = await app();
  try {
    const held = await heldDirect(a, 'again-token');
    await a.settle(() => held.answer({viewer: person}));
    await held.work;
    assert.deepEqual(a.shown, ['SignInElsewhere', 'Shell']);
    assert.equal(current.session?.accessToken, 'again-token');
    assert.equal(signInMode.current(key), undefined, 'over');
    assert.equal(signInMode.takeShell(key), undefined, 'a new sign-in starts afresh; nothing kept for the old one is offered');
    assert.equal(signInMode.takeOpener(key), undefined);
    assert.deepEqual(auth.revoked, ['old-token'], 'the replaced sign-in is retired');
  } finally { await a.stop(); }
});

test('accepted with no render in between (the same viewer key throughout): the sign-in still ends', async () => {
  const a = await app();
  try {
    await a.open({kind: 'direct'});
    await a.settle(() => current.direct.setOrigin('server.test'));
    direct.result = {kind: 'signed-in', session: session('fast-token', 'fast-family'), accountScoped: false, passwordChangeRequired: false};
    auth.me = async () => ({viewer: person});
    // The whole sign-in, the handoff included, settles before Root renders again.
    await a.settle(() => current.direct.signIn('person', 'password'));
    assert.deepEqual(a.shown, ['SignInElsewhere', 'Shell'], 'over, though Root never saw the viewer set aside');
    assert.equal(current.session?.accessToken, 'fast-token');
    assert.equal(signInMode.current(key), undefined);
  } finally { await a.stop(); }
});

test('Back while the new viewer is checked: the check stops, the old viewer comes back where they were, never the sign-in screens', async () => {
  const a = await app();
  try {
    const held = await heldDirect(a, 'abandoned-token');
    assert.equal(back?.(), true, 'the remote\'s Back is the sign-in\'s');
    await a.settle();
    await held.work;
    assert.deepEqual(a.shown, ['SignInElsewhere', 'Shell'], 'the sign-in until the old viewer is back, then their shell');
    assert.equal(current.session?.accessToken, 'old-token');
    assert.equal(current.error, '', 'abandoned silently');
    assert.equal(signInMode.current(key), undefined);
    assert.equal(signInMode.takeShell(key), place);
    assert.deepEqual(auth.revoked, ['abandoned-token']);
  } finally { await a.stop(); }
});

test('signed out while the new viewer is checked: nobody comes back, and the shell never shows', async () => {
  const a = await app();
  try {
    const held = await heldDirect(a, 'late-token');
    await a.settle(() => current.signOut());
    assert.equal(named(a.root), 'AuthFlow', 'the sign-in screens at once');
    await a.settle(() => held.answer({viewer: person}));
    await held.work.catch(() => {});
    assert.equal(viewer.getSnapshot().session, undefined, 'neither viewer is selected');
    assert.ok(!a.shown.includes('Shell'), 'browsing never came back');
    assert.equal(signInMode.current(key), undefined);
    assert.equal(signInMode.takeShell(key), undefined, 'nothing kept for anyone');
  } finally { await a.stop(); }
});

for (const saved of ['offline', 'confirmed'] as const) {
  test(`Back while a Portico server is being opened (the remembered sign-in ${saved}): its late answer cannot switch servers`, async () => {
    const a = await app({saved});
    try {
      assert.equal(current.saved?.state, saved === 'offline' ? 'offline' : undefined);
      let answer!: (value: unknown) => void;
      portico.result = new Promise(resolve => { answer = resolve; });
      const next = session('second-token', 'second-family', {...person, serverId: 'second'});
      auth.chosen = next as any;
      await a.open({kind: 'switch'});
      const opening = current.portico.connect({id: 'second', name: 'Second', baseUrl: 'http://second.test'}) as Promise<string>;
      await a.settle();
      assert.equal(current.busy, true);
      await a.settle(() => leaveSignIn(current));
      assert.equal(named(a.root), 'Shell', 'back to the viewer signed in');
      const spinning = current.busy;
      await a.settle(() => answer({kind: 'signed-in', session: next, accountScoped: false, passwordChangeRequired: false}));
      assert.equal(await opening, 'failed');
      assert.equal(current.error, '');
      assert.equal(current.session?.accessToken, 'old-token', 'still the old viewer');
      assert.equal(current.session?.viewer.serverId, 'server');
      assert.deepEqual(auth.revoked, [], 'the old sign-in is not retired');
      assert.deepEqual(portico.retired, ['second-token'], 'what the late answer issued is ended');
      assert.ok(!auth.writes.some(w => w?.session.accessToken === 'second-token'), 'never stored');
      if (saved === 'offline') assert.equal(current.saved?.state, 'offline', 'the remembered sign-in is still being retried, as before');
      assert.equal(spinning, false, 'nothing was left spinning after Back');
    } finally { await a.stop(); }
  });
}

test('a named Portico server\'s profiles cancelled: back to the account\'s servers, not opened again', async () => {
  const a = await app();
  try {
    portico.result = {kind: 'signed-in', session: session('account-grant', 'account-family', {...person, serverId: 'second'}), accountScoped: true, passwordChangeRequired: false, snapshot: {serverId: 'second', account: {id: 'account'}, profiles: [{id: 'profile', name: 'Profile', pinRequired: false}]}};
    await a.open({kind: 'switch', serverId: 'second'});
    assert.equal(named(a.root), 'DirectProfiles', 'opened at once, its profiles on the whole screen');
    assert.equal(portico.opened, 1);
    // DirectProfiles' Back (the button, the remote), as Root wires it.
    await a.settle(() => a.root.props.onCancel());
    assert.equal(named(a.root), 'SignInElsewhere');
    assert.equal(current.direct.pending, undefined);
    assert.equal(portico.opened, 1, 'the chooser mounted again and did not open the server again');
    assert.deepEqual(signInMode.current(key), {kind: 'switch'}, 'the sign-in names no server any more');
    const rows = all(a.chooser).filter(n => n.type === 'ListRow').map(n => n.props.title);
    assert.deepEqual(rows.sort(), ['Second', 'Server'], 'the account\'s servers');
    assert.ok(!a.shown.includes('Shell'), 'browsing stayed unmounted throughout');
    await a.settle(() => back?.());
    assert.equal(named(a.root), 'Shell');
    assert.equal(current.session?.accessToken, 'old-token');
  } finally { await a.stop(); }
});

const second = {id: 'second', name: 'Second', baseUrl: 'http://second.test'};
const chosen = session('profile-token', 'profile-family', {...person, serverId: 'second'});
/** Settles promptly, not at a deadline (the step's 15 seconds, the commit's 20). */
const promptly = <T,>(work: Promise<T>) => Promise.race([work, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still waiting')), 1000))]);

/** Settings › Servers › another Portico server whose account chooses a profile: its faces. */
async function profiles(a: Awaited<ReturnType<typeof app>>) {
  portico.result = {kind: 'signed-in', session: session('account-grant', 'account-family', {...person, serverId: 'second'}), accountScoped: true, passwordChangeRequired: false, snapshot: {serverId: 'second', account: {id: 'account'}, profiles: [{id: 'profile', name: 'Profile', pinRequired: false}, {id: 'other', name: 'Other', pinRequired: false}]}};
  auth.chosen = chosen as any;
  await a.open({kind: 'switch'});
  await a.settle(() => current.portico.connect(second));
  assert.equal(named(a.root), 'DirectProfiles');
  assert.equal(portico.opened, 1);
}

/** A profile chosen, its new viewer's `/v1/me` held until `answer`. */
async function heldProfile(a: Awaited<ReturnType<typeof app>>) {
  selection.session = chosen;
  let answer!: (value: unknown) => void, refuse!: (e: unknown) => void;
  auth.me = () => new Promise((resolve, reject) => { answer = resolve; refuse = reject; });
  const work = current.direct.chooseProfile('profile') as Promise<void>;
  await a.settle();
  assert.equal(viewer.getSnapshot().session, undefined, 'the old viewer is set aside while the new one is checked');
  assert.equal(named(a.root), 'DirectProfiles', 'the faces, not the sign-in screens and not browsing');
  return {work, answer: (v: unknown) => answer(v), refuse: (e: unknown) => refuse(e)};
}

test('Back from a server\'s profiles while the one chosen is checked: the old viewer comes back into the sign-in, and its Back returns them where they were', async () => {
  const a = await app();
  try {
    await profiles(a);
    const held = await heldProfile(a);
    // DirectProfiles' Back (the button, the remote), as Root wires it.
    await a.settle(() => a.root.props.onCancel());
    await promptly(held.work);
    assert.equal(current.session?.accessToken, 'old-token', 'the viewer set aside is back, in memory');
    assert.equal(auth.saved?.session.accessToken, 'old-token', 'and stored');
    assert.equal(named(a.root), 'SignInElsewhere', 'the sign-in it was chosen from');
    assert.deepEqual(a.shown, ['SignInElsewhere', 'DirectProfiles', 'SignInElsewhere'], 'never AuthFlow, never the shell');
    assert.equal(current.direct.pending, undefined);
    assert.equal(current.busy, false, 'nothing left spinning');
    assert.equal(current.error, '', 'left silently');
    assert.deepEqual(signInMode.current(key), {kind: 'switch'}, 'still signing in');
    assert.equal(signInMode.handingOver(), false);
    const rows = all(a.chooser).filter(n => n.type === 'ListRow').map(n => n.props.title);
    assert.deepEqual(rows.sort(), ['Second', 'Server'], 'the account\'s servers, settled');
    assert.equal(portico.opened, 1, 'nothing opened again');
    assert.ok(auth.revoked.includes('profile-token'), 'the chosen profile\'s unused sign-in is retired');
    assert.ok(!auth.revoked.includes('old-token'), 'the old sign-in is not');
    // Its check answers after all: it cannot sign in now.
    await a.settle(() => held.answer({viewer: chosen.viewer}));
    assert.equal(current.session?.accessToken, 'old-token');
    assert.equal(named(a.root), 'SignInElsewhere');
    // Back again: the viewer, where they were.
    await a.settle(() => back?.());
    assert.equal(named(a.root), 'Shell');
    assert.equal(current.session?.accessToken, 'old-token');
    assert.equal(signInMode.takeShell(key), place, 'the shell\'s place, kept through the handoff');
    assert.equal(signInMode.takeOpener(key), 'opener');
  } finally { await a.stop(); }
});

for (const late of ['stops', 'answers anyway'] as const) {
  test(`Back from a server's profiles before the one chosen is answered (its request ${late}): nothing set aside, nothing left spinning, nothing it issued kept`, async () => {
    const a = await app();
    try {
      await profiles(a);
      let answer!: (value: unknown) => void;
      selection.session = (signal: AbortSignal) => new Promise((resolve, reject) => {
        answer = resolve;
        if (late === 'stops') signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'})), {once: true});
      });
      const work = current.direct.chooseProfile('profile') as Promise<void>;
      await a.settle();
      assert.equal(current.busy, true);
      await a.settle(() => a.root.props.onCancel());
      assert.equal(selection.signals.at(-1)?.aborted, true, 'its request is stopped');
      assert.equal(current.busy, false, 'not spinning');
      assert.equal(named(a.root), 'SignInElsewhere');
      if (late === 'answers anyway') await a.settle(() => answer(chosen));
      await promptly(work);
      assert.equal(current.session?.accessToken, 'old-token', 'the viewer was never set aside');
      assert.equal(current.error, '');
      assert.ok(!auth.writes.some(w => w?.session.accessToken === 'profile-token'), 'never stored');
      if (late === 'answers anyway') assert.deepEqual(auth.revoked, ['profile-token'], 'what it issued anyway is ended');
      else assert.deepEqual(auth.revoked, []);
      await a.settle(() => back?.());
      assert.equal(named(a.root), 'Shell');
      assert.equal(signInMode.takeShell(key), place);
    } finally { await a.stop(); }
  });
}

test('signed out while leaving a server\'s profiles puts the old viewer back: nobody comes back, and the shell never shows', async () => {
  const a = await app();
  const write = nativeViewerStorage.write;
  try {
    await profiles(a);
    const held = await heldProfile(a);
    // The commit puts the old viewer's record back first; that write is held.
    let written!: () => void;
    let rolling = false;
    nativeViewerStorage.write = async (record: any) => {
      if (record?.session.accessToken === 'old-token' && !rolling) { rolling = true; await new Promise<void>(resolve => { written = resolve; }); }
      return write(record);
    };
    await a.settle(() => a.root.props.onCancel());
    assert.equal(rolling, true, 'the rollback is under way');
    await a.settle(() => current.signOut());
    assert.equal(named(a.root), 'AuthFlow', 'the sign-in screens at once');
    await a.settle(() => written());
    await held.work.catch(() => {});
    await a.settle(() => held.answer({viewer: chosen.viewer}));
    assert.equal(viewer.getSnapshot().session, undefined, 'neither viewer is selected');
    assert.equal(named(a.root), 'AuthFlow');
    assert.ok(!a.shown.includes('Shell'), 'browsing never came back');
    assert.equal(auth.saved, null, 'nothing is left stored');
    assert.equal(signInMode.current(key), undefined);
    assert.equal(signInMode.takeShell(key), undefined, 'nothing kept for anyone');
  } finally { nativeViewerStorage.write = write; await a.stop(); }
});

test('a profile\'s check refused, then another profile chosen: the refusal is said on the faces, and the next choice signs in', async () => {
  const a = await app();
  try {
    await profiles(a);
    const held = await heldProfile(a);
    await a.settle(() => held.refuse(new Error('verification refused')));
    await promptly(held.work);
    assert.equal(named(a.root), 'DirectProfiles', 'still choosing');
    assert.equal(current.session?.accessToken, 'old-token', 'the old viewer is back meanwhile');
    assert.notEqual(current.error, '', 'the faces say why');
    assert.equal(current.busy, false);
    const next = session('other-token', 'other-family', {...person, serverId: 'second', profileId: 'other'});
    selection.session = next; auth.chosen = next as any; auth.me = undefined;
    await a.settle(() => current.direct.chooseProfile('other'));
    assert.equal(named(a.root), 'Shell');
    assert.equal(current.session?.accessToken, 'other-token');
    assert.equal(signInMode.current(key), undefined, 'over');
    assert.ok(auth.revoked.includes('old-token'), 'the replaced sign-in is retired');
    assert.ok(!a.shown.includes('AuthFlow'));
  } finally { await a.stop(); }
});
