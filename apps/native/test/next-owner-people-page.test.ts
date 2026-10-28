import test from 'node:test';
import assert from 'node:assert/strict';
import {screenModule} from './helpers/screen-harness.mjs';
import {bindingModule, lifecycleHooks, nodes, content, t, i18n, theme} from './helpers/owner-server-settings.mjs';

test('People keeps a saved non-preset stream limit visible and unchanged when another limit is edited', async () => {
  const bindings = await bindingModule(), host = lifecycleHooks();
  const person = {accountId: 'member-fixture', username: 'member', role: 'member', revision: 2, limitsRevision: 3, disabled: false, notes: '', limits: {allowRemote: true, maxStreamsMode: 'limit', maxStreams: 5, maxBitrateKbps: 8000}};
  const state = {tab: 'people', query: {search: '', role: 'all', status: 'all', sort: 'person', direction: 'asc'}, invitationStatus: '', cursor: '', loading: false, busy: false, opening: false, selected: person, person, people: {items: [person], matchedCount: 1, totalCount: 1, nextCursor: ''}};
  const context = {account: {account: {id: 'owner-fixture'}}, authority: () => ({accountId: 'owner-fixture'}), serverName: 'Test server'}, writes: any[] = [];
  const source = {context, current: () => true, subscribe: () => () => {}, getSnapshot: () => state, load: async () => {}, dispose() {}, limits: async (captured: unknown, limits: unknown) => {writes.push({captured, limits});}};
  const runtime = {text: {t}, reportError: assert.fail, error: () => ({title: 'Error'})};
  const module = await screenModule(new URL('../src-next/screens/settings-live/server/PeoplePage.tsx', import.meta.url), {
    react: host.react, 'react-native': {FlatList: 'FlatList', Text: 'Text', View: 'View'},
    '../../../../../../packages/client-core/src/server-admin/people-words': {roleLabel: (_: unknown, role: string) => role},
    '../../../../../../packages/client-core/src/presentation/settings-bindings': bindings,
    '../../../../../../packages/client-core/src/presentation/settings-spec': {settingsSpec: []},
    '../../../../../../packages/i18n/src': {defaultI18n: i18n},
    '../../../kit/controls': {Button: 'Button', Focusable: 'Focusable', Select: 'Select', Switch: 'Switch', Tabs: 'Tabs', TextField: 'TextField'},
    '../../../kit/overlays': {BottomSheet: 'BottomSheet'}, '../../../kit/shell': {SettingsRow: 'SettingsRow'},
    '../../../kit/shell/ServerIdentity': {ServerHeader: 'ServerHeader'}, '../../../kit/shell/visual': {shellType: () => ({})},
    '../../../kit/states': {StateView: 'StateView'}, '../../../kit/theme': {useTheme: () => theme},
    './AdvancedSection': {NativeAdvancedSection: 'Advanced'}, './SettingControl': {NativeSettingControl: 'Setting'},
    './storage/forms': {}, './people-source': {NativePeopleSource: class {constructor() {return source;}}},
  });
  const ports = {context, requestId: () => 'operation-fixture'};
  // Render the private details component reached through the public page.
  const render = () => host.render(() => {
    const element = module.NativeServerPeople({ports, runtime}), page = element ? element.type(element.props) : null;
    const details = nodes(page).find((node: any) => typeof node.type === 'function' && node.props.person === person);
    return details ? details.type(details.props) : null;
  });
  render();host.flush();assert.ok(render());host.flush();
  const streamSelect = () => nodes(render()).find((node: any) => node.type === 'Select' && node.props.label === 'Streams at once');
  assert.equal(streamSelect().props.value, '5');
  assert.deepEqual(streamSelect().props.options.find((option: any) => option.value === '5'), {value: '5', label: '5', disabled: true});
  nodes(render()).find((node: any) => node.type === 'Switch').props.onCheckedChange(false);
  assert.equal(streamSelect().props.value, '5');
  nodes(render()).find((node: any) => node.type === 'Button' && content(node) === 'action.save' && !node.props.disabled).props.onPress();
  assert.deepEqual(writes, [{captured: person, limits: {...person.limits, allowRemote: false}}]);
  streamSelect().props.onValueChange('6');
  assert.equal(streamSelect().props.value, '6');
  assert.equal(streamSelect().props.options.some((option: any) => option.value === '5'), false);
  host.dispose();
});
