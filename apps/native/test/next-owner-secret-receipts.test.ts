import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';
import {webhookEventGroups, selectWebhookEventGroup, webhookSecretChange} from '../src-next/screens/settings-live/server/integrations/webhook-form.ts';

type Node = {type: string; props: Record<string, any>};
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !value.props) return [];
  return [value, ...nodes(value.props.children), ...nodes(value.props.footer)];
}
function words(value: any): string {
  if (Array.isArray(value)) return value.map(words).join('');
  return typeof value === 'string' ? value : value?.props ? words(value.props.children) : '';
}
const find = (tree: any, type: string, label: string) => {
  const node = nodes(tree).find(node => node.type === type && (node.props.label === label || node.props.title === label || words(node) === label));
  assert.ok(node, `${type}: ${label}`); return node;
};
const settle = async () => {await Promise.resolve(); await Promise.resolve();};

async function fixture(kind: 'key' | 'webhook') {
  const host = hooks(); host.react.useLayoutEffect = () => {};
  const t = (key: string) => key, colors = new Proxy({}, {get: () => '#123456'});
  const hook = {id: 'hook-fixture', revision: 3, name: 'Receiver', url: 'https://receiver.invalid/events', events: ['playback.started'], enabled: true};
  const calls: unknown[] = [];
  let alive = true, sequence = 0;
  const state: any = {phase: 'ready', busy: false, options: {scopes: ['read']}, page: {items: [], nextCursor: ''}, list: {items: kind === 'webhook' ? [hook] : [], events: ['playback.started', 'playback.stopped', 'library.scanned'], maximum: 20}};
  const issued = () => kind === 'key' ? {credential: {id: 'key', name: 'Fixture key'}, secret: `test-only-key-${++sequence}`} : {webhook: hook, secret: `test-only-webhook-${++sequence}`};
  const source: any = {subscribe: () => () => {}, getSnapshot: () => state, load: async () => {}, create: async (value: unknown) => {calls.push(value); return issued();}, update: async (_: unknown, value: unknown) => {calls.push(value); return issued();}, test: async (target: unknown) => {calls.push({test: target});}, reviewStep: () => 'done', close() {}, select: async () => {state.selected = hook; state.deliveries = {items: [], nextCursor: ''};}};
  const modules: any = {
    react: host.react,
    'react-native': {Text: 'Text', View: 'View', Share: {share: async () => {}}},
    '../../../../../../../packages/i18n/src': {defaultI18n: {t, date: String, has: () => true}},
    '../../../../platform/clipboard': {copyText: async () => {}},
    '../../../../kit/controls': {Button: 'Button', Focusable: 'Focusable', Switch: 'Switch', Select: 'Select', TextField: 'TextField'},
    '../../../../kit/overlays': {BottomSheet: 'BottomSheet', Menu: 'Menu'},
    '../../../../kit/shell/visual': {shellType: () => ({}), alpha: (value: unknown) => value},
    '../../../../kit/theme': {useTheme: () => ({colors})},
    '../../lifetime': {NativeScreenLifetime: class {}, screenScopeEnded: () => new Error('ended')},
    '../storage/space-source': {nativeStorageOwner: () => true},
    '../../../../../../../packages/client-core/src/server-admin/api-words': {
      EXPIRY_DAYS: [0], chosenScopes: (value: Set<string>) => [...value], scopeTicked: (value: Set<string>, scope: string) => value.has(scope),
      credentialWorks: () => true, expiryInstant: () => '', expiryLabel: () => 'Never',
      webhookTrouble: () => undefined, webhookAddressOk: (url: string) => url.startsWith('https://'), webhookEventLabel: (_: unknown, __: unknown, event: string) => event,
      deliveryProgress: () => '', deliveryProblem: () => '',
    },
    '../../../../../../../packages/client-core/src/server-admin/api-keys-source': {SettingsApiKeysSource: class {}},
    '../../../../../../../packages/client-core/src/server-admin/webhooks-source': {SettingsWebhooksSource: class {}},
    '../../../../../../../packages/client-core/src/api-access': {webhookEdits: (_: unknown, next: unknown) => next},
    './webhook-form': {webhookEventGroups, selectWebhookEventGroup, webhookSecretChange},
  };
  const module = await screenModule(new URL(`../src-next/screens/settings-live/server/integrations/${kind === 'key' ? 'ApiKeys' : 'Webhooks'}.tsx`, import.meta.url), modules);
  const component = kind === 'key' ? module.NativeApiKeys : module.Webhooks;
  const render = () => host.render(() => component({group: {source, current: () => alive}, runtime: {text: {t}}, consumeCreateRequest: () => false}));
  return {render, calls, source, state, retire: () => {alive = false;}};
}

test('API key receipt blocks every incidental dismissal and stale acknowledgement cannot close a later receipt', async () => {
  const f = await fixture('key');
  const issue = async () => {
    find(f.render(), 'Button', 'web.access.createKey').props.onPress();
    find(f.render(), 'TextField', 'builder.name').props.onChangeText('Fixture key');
    const scope = nodes(f.render()).find(node => node.type === 'Button' && words(node).startsWith('api.scope.read'))!;
    scope.props.onPress();
    const form = find(f.render(), 'BottomSheet', 'web.access.createKeyTitle');
    find(form.props.footer, 'Button', 'web.access.createKey').props.onPress(); await settle();
    return find(f.render(), 'BottomSheet', 'web.access.copyKeyTitle');
  };
  const first = await issue();
  assert.equal(first.props.open, true);
  for (const prop of ['dismissOnBack', 'dismissOnGesture', 'dismissOnOutsidePress', 'showClose']) assert.equal(first.props[prop], false, prop);
  const oldAcknowledgement = find(first.props.footer, 'Button', 'web.access.copiedIt').props.onPress;
  oldAcknowledgement(); assert.equal(find(f.render(), 'BottomSheet', 'web.access.copyKeyTitle').props.open, false);
  await issue(); oldAcknowledgement();
  assert.equal(find(f.render(), 'BottomSheet', 'web.access.copyKeyTitle').props.open, true);
  f.retire(); assert.equal(find(f.render(), 'BottomSheet', 'web.access.copyKeyTitle').props.open, false);
});

test('webhook replacement uses the typed secret, then keeps its issued receipt until acknowledgement', async () => {
  const f = await fixture('webhook');
  nodes(f.render()).find(node => node.type === 'Focusable' && node.props.accessibilityLabel === 'Receiver')!.props.onPress();
  nodes(f.render()).find(node => node.type === 'Menu')!.props.items.find((item: any) => item.id === 'rotate').onSelect();
  const sheet = find(f.render(), 'BottomSheet', 'api.webhooks.rotateTitle');
  find(sheet, 'TextField', 'api.webhooks.secret').props.onChangeText('test-only-explicit-secret');
  find(find(f.render(), 'BottomSheet', 'api.webhooks.rotateTitle').props.footer, 'Button', 'api.webhooks.rotate').props.onPress(); await settle();
  assert.deepEqual(f.calls, [{secret: 'test-only-explicit-secret'}]);
  const receipt = find(f.render(), 'BottomSheet', 'api.webhooks.secretTitle');
  assert.equal(receipt.props.open, true);
  for (const prop of ['dismissOnBack', 'dismissOnGesture', 'dismissOnOutsidePress', 'showClose']) assert.equal(receipt.props[prop], false, prop);
  find(receipt.props.footer, 'Button', 'web.access.copiedIt').props.onPress();
  assert.equal(find(f.render(), 'BottomSheet', 'api.webhooks.secretTitle').props.open, false);
});

test('webhook delivery log is an opening-specific full-height sheet, and deletion is visibly destructive', async () => {
  const f = await fixture('webhook');
  const openMenu = () => {nodes(f.render()).find(node => node.type === 'Focusable')!.props.onPress(); return nodes(f.render()).find(node => node.type === 'Menu')!;};
  openMenu().props.items.find((item: any) => item.id === 'log').onSelect(); await settle();
  const log = nodes(f.render()).find(node => node.type === 'BottomSheet' && node.props.description === 'api.webhooks.log')!;
  assert.equal(log.props.open, true); assert.equal(log.props.defaultDetent, 1);
  log.props.onOpenChange(false);
  assert.equal(nodes(f.render()).find(node => node.type === 'BottomSheet' && node.props.description === 'api.webhooks.log')!.props.open, false);
  const remove = openMenu().props.items.find((item: any) => item.id === 'remove'); assert.equal(remove.destructive, true); remove.onSelect();
  assert.equal(find(find(f.render(), 'BottomSheet', 'api.webhooks.removeTitle').props.footer, 'Button', 'action.delete').props.variant, 'danger');
});

test('webhook menus consume their exact opening and reject retained actions or dismissals', async () => {
  const f = await fixture('webhook');
  const open = () => {nodes(f.render()).find(node => node.type === 'Focusable')!.props.onPress(); return nodes(f.render()).find(node => node.type === 'Menu')!;};
  const first = open();
  first.props.onOpenChange(false);
  const second = open();
  for (const item of first.props.items) item.onSelect();
  first.props.onOpenChange(false);
  assert.equal(nodes(f.render()).find(node => node.type === 'Menu')!.props.open, true);
  assert.deepEqual(f.calls, []);
  assert.ok(nodes(f.render()).filter(node => node.type === 'BottomSheet').every(node => !node.props.open));
  const send = second.props.items.find((item: any) => item.id === 'test').onSelect;
  send(); send(); await settle();
  assert.equal(f.calls.length, 1, 'the current menu action is one-use');
  assert.equal(nodes(f.render()).find(node => node.type === 'Menu')!.props.open, false);
  const replaced = open();
  f.state.list = {...f.state.list, items: f.state.list.items.map((value: any) => ({...value, revision: value.revision + 1}))};
  f.render();
  replaced.props.items.find((item: any) => item.id === 'test').onSelect();
  assert.equal(f.calls.length, 1, 'a refreshed list retires the row capability');
  assert.equal(open().props.open, true, 'the refreshed row can open a new menu');
});
