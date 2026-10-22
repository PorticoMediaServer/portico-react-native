/** CON-18 (MU7): Apple StateView and Notice match web — one primary action
 * with an optional glass secondary, one glyph per tone (`error`, not
 * `danger`), and the loading/empty copy keys resolve to the §4.4 wording. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {enUS, formatMessage} from '../../../packages/i18n/src/index.ts';
import {feedback as feedbackSpec} from '../../../packages/design/src/components.ts';
import {screenModule, hooks} from './helpers/screen-harness.mjs';

const theme = {
  alpha: (c: string) => c,
  spec: {feedback: feedbackSpec, button: {gap: {phone: 8, tablet: 8, tv: 8, web: 8}}},
  useSpecPlatform: () => 'phone',
  useTheme: () => ({
    colors: {accent: '#a', danger: '#d', healthy: '#h', amber: '#m', raisedHigh: '#r', textSecondary: '#s', trackRest: '#t', textTertiary: '#tt'},
    space: {xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, page: 16},
    metrics: {radius: {card: 8, small: 4}},
    motion: {reduce: true},
  }),
};

async function load() {
  const h = hooks();
  return screenModule(new URL('../src/ui/Feedback.tsx', import.meta.url), {
    react: h.react,
    'react-native': {Animated: {}, Easing: {}, View: 'View'},
    './Button': {Button: 'Button'},
    './Icon': {Icon: 'Icon'},
    './NavBar': {ScreenSpeechContext: {value: () => {}}},
    './Ring': {Ring: 'Ring'},
    './Text': {Text: 'Text'},
    './i18n': {uiI18n: () => ({t: (id: string) => id})},
    './theme': theme,
  });
}

/** Every element in the stub tree, depth first. */
function all(node: unknown, out: {type?: unknown; props?: any}[] = []): {type?: unknown; props?: any}[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach(n => all(n, out)); return out; }
  out.push(node as {type?: unknown; props?: any});
  all((node as {props?: any}).props?.children, out);
  return out;
}

const buttons = (root: unknown) => all(root).filter(n => n.type === 'Button').map(n => n.props);
const icons = (root: unknown) => all(root).filter(n => n.type === 'Icon').map(n => n.props);

test('CON-18: StateView renders one primary action and an optional glass secondary', async () => {
  const m = await load();
  const view = m.StateView({title: 'This library couldn’t load', action: 'Try again', onAction: () => {}, secondaryAction: 'Go back', onSecondaryAction: () => {}});
  const found = buttons(view);
  assert.equal(found.length, 2);
  assert.equal(found[0].variant, 'primary');
  assert.equal(found[1].variant, 'secondary');
});

test('CON-18: StateView with a single action renders only the primary', async () => {
  const m = await load();
  const view = m.StateView({title: 'Nothing here yet', action: 'Try again', onAction: () => {}});
  const found = buttons(view);
  assert.equal(found.length, 1);
  assert.equal(found[0].variant, 'primary');
});

test('CON-18: Notice draws one glyph per tone; error and danger share the error glyph and role=alert', async () => {
  const m = await load();
  const expected: Record<string, string> = {info: 'info', success: 'success', warning: 'warning', error: 'error', danger: 'error'};
  for (const [tone, glyph] of Object.entries(expected)) {
    const notice = m.Notice({tone: tone as 'info', message: 'x', action: 'Try again', onAction: () => {}});
    assert.equal(icons(notice)[0].name, glyph);
    assert.equal(notice.props.accessibilityRole, tone === 'error' || tone === 'danger' ? 'alert' : undefined);
  }
});

test('CON-18: Notice action buttons are secondary sm, like web', async () => {
  const m = await load();
  const notice = m.Notice({tone: 'warning', message: 'x', action: 'Try again', onAction: () => {}});
  const found = buttons(notice);
  assert.equal(found.length, 1);
  assert.equal(found[0].variant, 'secondary');
  assert.equal(found[0].size, 'sm');
});

test('CON-18: loading and empty copy keys resolve to the §4.4 wording', () => {
  const table: [string, (v: string) => void][] = [
    ['status.loadingThing', v => assert.match(formatMessage(v, {thing: 'profiles'}), /^Loading profiles$/)],
    ['auth.loadingProfiles', v => assert.match(v, /^Loading .+/)],
    ['downloads.emptyBody', v => assert.match(v, /Press and hold/)],
    ['title.playlistEmptyBodyTV', v => assert.match(v, /Press and hold Select/)],
  ];
  for (const [key, check] of table) {
    const value = (enUS as Record<string, string>)[key];
    assert.ok(value, `${key} resolves`);
    assert.doesNotMatch(value, /…|\.\.\./, `${key} has no ellipsis`);
    assert.notEqual(value, 'Loading', `${key} is never a bare "Loading"`);
    check(value);
  }
});
