import test from 'node:test';
import assert from 'node:assert/strict';
import {hooks, screenModule} from './helpers/screen-harness.mjs';

const {react} = hooks();
const {renderNativeSettingsPanel} = await screenModule(new URL('../src-next/screens/settings-live/settings-panels.tsx', import.meta.url), {
  react, 'react-native': {},
  '../../../../../packages/client-core/src/installation': {installationIdentity: () => undefined},
  '../../../../../packages/client-core/src/presentation/kit-model/text': {},
  '../../kit/controls': {},
  '../../../../../packages/client-core/src/freshness-actions': {},
  '../../../../../packages/client-core/src/playback-v1/http': {},
  '../../../../../packages/client-core/src/playback-v1/local-http': {},
  '../../../../../packages/client-core/src/playback-v1/sessions': {},
  '../../../../../packages/client-core/src/playback-controls': {},
  '../../../../../packages/client-core/src/server-admin/now-playing': {},
  '../../kit/overlays': {}, '../../kit/shell': {SettingsRow: 'SettingsRow'},
  '../../kit/shell/visual': {}, '../../kit/theme': {},
});

test('custom Settings navigation rows provide stable distinct focus identities before TV activation', () => {
  const opened: unknown[] = [];
  const deps = {context: {serverName: 'Actual server'}, t: (id: string) => id, openRoute: (route: unknown) => opened.push(route)};
  const ids = new Set<string>();
  for (const id of ['profiles', 'servers']) {
    const row = renderNativeSettingsPanel(id, deps, {});
    assert.equal(row.type, 'SettingsRow');
    assert.equal(row.props.testID, `settings-panel-${id}`);
    assert.equal(ids.has(row.props.testID), false);
    ids.add(row.props.testID);
    row.props.onPress();
  }
  assert.deepEqual(opened, [{kind: 'profiles'}, {kind: 'servers'}]);
});
