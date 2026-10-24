import assert from 'node:assert/strict';
import test from 'node:test';
import * as structure from '../../../packages/client-core/src/presentation/settings-structure';
import * as languages from '../../../packages/client-core/src/presentation/language-list';
import * as i18n from '../../../packages/i18n/src';
import {parsePreferenceSnapshot} from '../../../packages/client-core/src/preferences';
import {nextIcons} from '../../../packages/design/src/next-icons';
import {createTheme} from '../src-next/kit/theme';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const nodes = (node: any): any[] => Array.isArray(node) ? node.flatMap(nodes) : node?.props ? [node, ...nodes(node.props.children)] : [];

async function fixture() {
  const host = hooks(), bodyHost = hooks();
  let nested = false, language = 'CA';
  const react: any = {...host.react};
  for (const name of Object.keys(host.react).filter(name => name.startsWith('use'))) react[name] = (...args: any[]) => {const active: any = nested ? bodyHost.react : host.react; return active[name](...args);};
  react.default = react;
  const theme = createTheme({width: 800, isTV: false});
  const module = await screenModule(new URL('../src-next/screens/settings-live/SettingsScreen.tsx', import.meta.url), {
    react,
    'react-native': {Dimensions: {get: () => ({width: 800, height: 1024})}, Platform: {OS: 'ios', isTV: false, isPad: true}, ScrollView: 'ScrollView', Text: 'Text', View: 'View'},
    '../../../../../packages/client-core/src/presentation/settings-structure': structure,
    '../../../../../packages/client-core/src/presentation/language-list': languages,
    '../../../../../packages/i18n/src': i18n,
    '../../../../../packages/client-core/src/recommendation-feedback': {resetRecommendations: () => {throw Error('unexpected_mutation');}},
    '../../../../../packages/design/src/next-icons': {nextIcons},
    '../../kit/controls': {Button: 'Button', Focusable: 'Focusable', Select: 'Select', Switch: 'Switch', TextField: 'TextField'},
    '../../kit/focus': {FocusRegion: 'FocusRegion', useFocusRegistry: () => ({capture: () => undefined, focus: () => false})},
    '../../kit/Icon': {Icon: 'Icon'},
    '../../kit/shell': {SettingsRow: 'SettingsRow', SettingsSearchResults: 'SettingsSearchResults', LanguageList: 'LanguageList'},
    '../../kit/shell/visual': {shellType: () => ({})},
    '../../kit/theme': {useTheme: () => theme},
    '../../kit/states': {StateView: 'StateView'},
    '../../kit/overlays': {Dialog: 'Dialog'},
    '../../shell/tv-focus': {tvFocusIds: () => ({surface: (id: string) => id, rail: 'rail'})},
    '../destinations': {NativeTVKeyboard: 'NativeTVKeyboard'},
    '../destinations/useEntryFocus': {useDestinationEntryFocus: () => {}},
    './Screen': {Screen: 'Screen', useScreenEntry: () => undefined, useScreenBack: () => {}},
  });
  const preferences = parsePreferenceSnapshot({deviceClass: 'mobile', registryRevision: 'regional-screen', registry: {revision: 'regional-screen', fields: []},
    documents: ['profile-server', 'profile-device-class'].map(scope => ({scope, revision: 1, activeRevision: 1, digest: 'd'.repeat(64), values: {}})), effective: {}, effectiveSource: {}, clampedFields: []});
  const runtime = {text: {get t() {const prefix = language; return (key: string) => `${prefix}/${key}`;}}, reportError: (error: unknown) => {throw error;}};
  const props = {runtime, ports: {settingsContext: () => ({owner: false, platform: 'phone', capabilities: {localAccount: true}}), serverName: () => 'Example', renderSettingsPanel: () => null},
    controller: {subscribe: () => () => {}, getSnapshot: () => ({preferences, busy: false, saved: 0}), lifetime: {authority: {}, current: () => true}},
    devicePreferences: {subscribe: () => () => {}, read: () => undefined}};
  return {setLanguage: (next: string) => {language = next;},
    render: () => {nested = false; return host.render(() => module.NativeSettingsScreen(props));},
    body: (node: any) => {nested = true; try {return bodyHost.render(() => node.type(node.props));} finally {nested = false;}}};
}

test('Settings headings and search consume the current runtime translator after its confirmed replacement', async () => {
  const f = await fixture();
  let tree = f.render();
  assert.ok(nodes(tree).some(node => node.type === 'Text' && node.props.children.includes('CA/next.shell.settings')));
  const search = nodes(tree).find(node => node.type === 'TextField');
  assert.equal(search.props.placeholder, 'CA/next.shell.searchSettings');
  f.setLanguage('GB'); tree = f.render();
  assert.ok(nodes(tree).some(node => node.type === 'Text' && node.props.children.includes('GB/next.shell.settings')));
  const nextSearch = nodes(tree).find(node => node.type === 'TextField');
  assert.equal(nextSearch.props.placeholder, 'GB/next.shell.searchSettings');
  nextSearch.props.onChangeText('GB/settings.page'); tree = f.render();
  const results = nodes(tree).find(node => node.type === 'SettingsSearchResults');
  assert.ok(results.props.matches.length > 0, 'the canonical search indexes the same translated page words');
});

test('Settings page body uses the same live translator for its own control and confirmation labels', async () => {
  const f = await fixture(), tree = f.render();
  const body = nodes(tree).find(node => typeof node.type === 'function' && node.type.name === 'SettingsPageBody');
  assert.ok(body);
  let rendered = f.body(body);
  assert.ok(nodes(nodes(rendered).find(node => node.type === 'Dialog').props.footer).some(node => node.type === 'Button' && node.props.children.includes('CA/action.cancel')));
  f.setLanguage('GB'); rendered = f.body(body);
  assert.ok(nodes(nodes(rendered).find(node => node.type === 'Dialog').props.footer).some(node => node.type === 'Button' && node.props.children.includes('GB/action.cancel')));
});
