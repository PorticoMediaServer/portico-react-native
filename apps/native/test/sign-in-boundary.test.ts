/**
 * Browsing is never reachable before or during a sign-in (Justin, 18 Oct 2026: "the browsing shell
 * shouldn't be accessible pre sign-in"). The app's Root mounts the shell (its rail, tab bar,
 * screens, their providers and requests) only for a signed-in viewer with a profile, and not while
 * a sign-in begun from Settings › Servers is showing; that sign-in takes the whole screen and Back
 * leaves it for the viewer still signed in. Rendered from the components' own source (the screen
 * harness: React and native modules stubbed, effects run). This is the app's own gate: the server's
 * refusal of requests without a sign-in is its own check and is not exercised here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile, mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {screenModule} from './helpers/screen-harness.mjs';
import {signInMode} from '../src/app/sign-in-mode.ts';
import * as pendingLink from '../src/shell/pending-link.ts';

const loose = (named: Record<string, unknown> = {}): any => new Proxy(named, {get: (target, name) => (name in target ? target[name as string] : name === 'default' ? loose() : typeof name === 'string' && /^(use|[a-z])/.test(name) ? () => undefined : String(name))});
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  all((node as {props?: any}).props?.children, out);
  return out;
}
const named = (node: {type?: unknown}) => (typeof node.type === 'function' ? node.type.name : node.type);
/** Every module the source imports, stubbed unless given. */
const modulesOf = (given: Record<string, unknown>) => new Proxy(given, {get: (target, name) => target[name as string] ?? loose()});

/** React with effects run after each render (cleanups first when they change); state kept between renders. */
function effectReact() {
  const cells: any[] = [];
  let cursor = 0;
  let queued: (() => void)[] = [];
  const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react: any = {
    createElement: (type: unknown, props: object, ...children: unknown[]) => ({type, props: {...props, children}}),
    useRef: (value: unknown) => { const n = cursor++; return (cells[n] ??= {current: value}); },
    useState: (value: unknown) => { const n = cursor++; if (!(n in cells)) cells[n] = typeof value === 'function' ? (value as () => unknown)() : value; return [cells[n], (next: unknown) => { cells[n] = typeof next === 'function' ? (next as (v: unknown) => unknown)(cells[n]) : next; }]; },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useEffect: (fn: () => (() => void) | void, deps?: unknown[]) => { const n = cursor++; if (!cells[n] || !deps || !same(cells[n].deps, deps)) { const old = cells[n]; cells[n] = {deps}; queued.push(() => { old?.cleanup?.(); cells[n].cleanup = fn(); }); } },
    useSyncExternalStore: (_: unknown, get: () => unknown) => get(),
    useContext: (context: {value: unknown}) => context.value,
    createContext: (value: unknown) => ({value}),
  };
  react.default = react;
  return {react, render<T>(fn: () => T): T { cursor = 0; const out = fn(); const run = queued; queued = []; run.forEach(f => f()); return out; }, unmount() { for (const cell of cells) cell?.cleanup?.(); }};
}

const viewer = {authority: 'local', accountId: 'a', profileId: 'p', serverId: 'demo'};
const demo = pendingLink.linkViewerKey(viewer);
const other = pendingLink.linkViewerKey({...viewer, serverId: 'home'});

test('Root: the shell is mounted only for a signed-in viewer with a profile, and never while a sign-in shows', async () => {
  const source = await readFile(new URL('../App.tsx', import.meta.url), 'utf8');
  const file = join(await mkdtemp(join(tmpdir(), 'portico-root-')), 'App.tsx');
  await writeFile(file, source.replace('function Root(', 'export function Root(').replace('export default function App(', 'function App('));
  const r = effectReact();
  let session: any;
  const m = await screenModule(pathToFileURL(file), modulesOf({
    react: r.react, 'react-native': loose(),
    './src/app/session': {useSession: () => session, SessionProvider: 'SessionProvider'},
    './src/screens/auth/AuthFlow': {AuthFlow: 'AuthFlow'}, './src/screens/auth/DirectProfiles': {DirectProfiles: 'DirectProfiles'},
    './src/shell/Shell': {Shell: 'Shell'}, './src/screens/auth/SignInElsewhere': {SignInElsewhere: 'SignInElsewhere'},
    './src/shell/link-intents': {useLinkIntake: () => {}}, './src/shell/pending-link': pendingLink, './src/app/sign-in-mode': {signInMode},
    './src/app/top-shelf': {clearTopShelf: () => {}}, './src/ui': loose({useMenuKey: () => {}, useTheme: () => ({space: {}, isTV: true})}),
  }));
  const shown = (state: object) => { session = {phase: 'ready', session: {viewer}, direct: {}, ...state}; return named(r.render(() => m.Root()) as {type?: unknown}); };
  try {
    assert.equal(shown({phase: 'restoring', session: undefined}), 'Connecting', 'the saved sign-in being read from the device');
    assert.equal(shown({phase: 'signedOut', session: undefined}), 'AuthFlow', 'nobody signed in');
    assert.equal(shown({direct: {pending: {}}}), 'DirectProfiles', 'a profile to choose');
    assert.equal(shown({}), 'Shell', 'a viewer with a profile');
    signInMode.open(demo, {kind: 'direct'});
    assert.equal(shown({}), 'SignInElsewhere', 'signing in elsewhere: the whole screen, no shell');
    assert.equal(shown({direct: {pending: {}}}), 'DirectProfiles', 'that sign-in\'s profiles, still no shell');
    assert.equal(shown({}), 'SignInElsewhere', 'cancelling the profiles goes back to the sign-in, not to browsing');
    signInMode.close();
    assert.equal(shown({}), 'Shell', 'left: the viewer signed in');
    // Their sign-in ended while signing in elsewhere: the sign-in screens, and the mode is over.
    signInMode.open(demo, {kind: 'switch'});
    assert.equal(shown({phase: 'signedOut', session: undefined}), 'AuthFlow');
    assert.equal(signInMode.current(demo), undefined, 'forgotten (Root settles it)');
    // Signed in elsewhere: the new viewer's shell, never the old viewer's sign-in.
    signInMode.open(demo, {kind: 'switch'});
    assert.equal(shown({session: {viewer: {...viewer, serverId: 'home'}}}), 'Shell');
    assert.equal(signInMode.current(other), undefined);
    assert.equal(signInMode.current(demo), undefined);
  } finally { signInMode.close(); r.unmount(); }
});

async function signInElsewhere() {
  const r = effectReact();
  let back: (() => boolean) | undefined;
  let menu = 0;
  const calls: string[] = [];
  const session: any = {
    clearError: () => calls.push('clearError'),
    direct: {cancel: () => calls.push('cancel'), cancelStep: () => calls.push('cancelStep'), cancelSetup: () => calls.push('cancelSetup'), resetPin: () => calls.push('resetPin')},
  };
  const m = await screenModule(new URL('../src/screens/auth/SignInElsewhere.tsx', import.meta.url), modulesOf({
    react: r.react,
    'react-native': {BackHandler: {addEventListener: (_: string, f: () => boolean) => { back = f; return {remove: () => { if (back === f) back = undefined; }}; }}, TVEventControl: {enableTVMenuKey: () => menu++, disableTVMenuKey: () => menu--}},
    '../../ui': {useTheme: () => ({isTV: true})}, '../../app/i18n': {useI18n: () => ({t: (id: string) => id})},
    '../../app/session': {useSession: () => session}, '../../app/sign-in-mode': {signInMode},
    './DirectSignIn': {DirectSignIn: 'DirectSignIn'}, './HostedChooser': {HostedChooser: 'HostedChooser'},
  }));
  return {r, m, session, calls, back: () => back?.(), menu: () => menu};
}

test('signing in elsewhere: the remote\'s Back walks the sign-in\'s own steps, then leaves it, abandoning what it had under way', async () => {
  const s = await signInElsewhere();
  try {
    signInMode.open(demo, {kind: 'direct'});
    const form = s.r.render(() => s.m.SignInElsewhere({request: {kind: 'direct'}})) as any;
    assert.equal(form.type, 'DirectSignIn');
    assert.equal(s.menu(), 1, 'Apple TV: Menu goes back, it does not leave the app');
    let stepped = 0;
    form.props.backRef.current = () => { stepped++; };
    assert.equal(s.back(), true);
    assert.equal(stepped, 1, 'a step of its own first (the code back to the address)');
    assert.ok(signInMode.current(demo), 'still signing in');
    form.props.backRef.current = null;
    s.session.direct.step = 'challenge';
    assert.equal(s.back(), true, 'never out of the app');
    assert.deepEqual(s.calls, ['cancel', 'cancelStep', 'resetPin', 'clearError'], 'the attempt and its further step abandoned');
    assert.equal(signInMode.current(demo), undefined, 'back to the viewer signed in');
    s.r.unmount();
    assert.equal(s.menu(), 0);
  } finally { signInMode.close(); }
  const t = await signInElsewhere();
  try {
    signInMode.open(demo, {kind: 'switch', serverId: 'home'});
    const chooser = t.r.render(() => t.m.SignInElsewhere({request: {kind: 'switch', serverId: 'home'}})) as any;
    assert.deepEqual([chooser.type, chooser.props.initialServerId, chooser.props.title], ['HostedChooser', 'home', 'servers.switch']);
    t.session.direct.setup = {};
    chooser.props.onBack();
    assert.deepEqual(t.calls, ['cancel', 'cancelStep', 'cancelSetup', 'resetPin', 'clearError'], 'a server still being opened is abandoned too (its late answer is ignored)');
    assert.equal(signInMode.current(demo), undefined);
    // While a remembered sign-in is still being confirmed, that check is not abandoned with it.
    t.calls.length = 0;
    t.session.direct.setup = undefined;
    t.session.saved = {state: 'checking'};
    signInMode.open(demo, {kind: 'switch'});
    chooser.props.onBack();
    assert.deepEqual(t.calls, ['cancel', 'resetPin', 'clearError']);
  } finally { signInMode.close(); t.r.unmount(); }
});

test('Settings › Servers: every sign-in opens on the whole screen (no sign-in drawn inside the shell); back, focus returns to the row it came from', async () => {
  const origins: string[] = [];
  const session: any = {session: {viewer}, servers: [{id: 'demo', name: 'Demo'}, {id: 'home', name: 'Home'}], hosted: {}, system: {name: 'Demo'}, portico: {}, clearError: () => {}, direct: {setOrigin: (o: string) => origins.push(o)}};
  const render = async () => {
    const r = effectReact();
    const m = await screenModule(new URL('../src/screens/SettingsPages.tsx', import.meta.url), modulesOf({
      react: r.react, 'react-native': loose(),
      '../ui': loose({isTV: true, useInitialFocus: () => true, useTheme: () => ({space: {}, colors: {}}), ToggleRow: 'ToggleRow'}),
      '../app/i18n': {useI18n: () => ({t: (id: string) => id})}, '../app/session': {useSession: () => session},
      '../app/sign-in-mode': {signInMode}, '../shell/pending-link': pendingLink,
      '../bridge/known-servers': {knownDirectServers: {list: async () => []}}, '../bridge/server-connections': {savedCertificates: async () => []},
      '@react-navigation/native': {useNavigation: () => ({goBack: () => {}})},
    }));
    const tree = all(r.render(() => m.ServersScreen()));
    return {tree, row: (title: string) => tree.find(n => n.type === 'ListRow' && n.props.title === title)!};
  };
  try {
    let page = await render();
    assert.ok(!page.tree.some(n => ['HostedChooser', 'DirectSignIn', 'DirectProfiles'].includes(named(n) as string)), 'no sign-in inside the shell');
    page.row('Home').props.onPress();
    assert.deepEqual(signInMode.current(demo), {kind: 'switch', serverId: 'home'});
    signInMode.close();
    page = await render();
    assert.equal(page.row('Home').props.hasTVPreferredFocus, true, 'focus back on the server it was opened from');
    assert.equal(page.row('servers.connectDirect').props.hasTVPreferredFocus, false);
    page.row('servers.connectDirect').props.onPress();
    assert.deepEqual(signInMode.current(demo), {kind: 'direct'});
    signInMode.close();
    page = await render();
    assert.deepEqual([page.row('Home').props.hasTVPreferredFocus, page.row('servers.connectDirect').props.hasTVPreferredFocus], [false, true]);
    page.row('servers.switch').props.onPress();
    assert.deepEqual(signInMode.current(demo), {kind: 'switch'});
    assert.deepEqual(origins, []);
  } finally { signInMode.close(); }
});

test('the shell keeps its place for its own viewer when a sign-in replaces it, and comes back there (source)', async () => {
  // The shell is too large to render here; its wiring to the sign-in mode is checked in its source.
  const shell = await readFile(new URL('../src/shell/Shell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /useState\(\(\) => signInMode\.takeShell\(shellViewer\)/, 'restored only for the same viewer, once');
  assert.match(shell, /useEffect\(\(\) => \(\) => signInMode\.keepShell\(placeViewer\.current, place\.current\), \[\]\)/, 'kept as it goes');
  assert.match(shell, /initialState=\{returning\}/);
  assert.match(shell, /onReady=\{returning \? \(\) => onStateChange\(returning\) : undefined\}/, 'the rail follows the restored place');
});
