import React, {useState} from 'react';
import {useI18n} from '../app/i18n';
import {usePreferences} from '../app/preferences';
import {mpvAvailable} from '../bridge/player-engines';
import {ListRow, Menu, type MenuItem} from '../ui';
import {engineSettings, parseEngineSetting} from './engine-choice';
import {engineText} from './engine-strings';

/**
 * The Player setting: Automatic (the default), this device's own player, or mpv. It is kept by
 * this device, like its other device settings, and takes effect at once, also for a title that is
 * playing. A build without mpv has nothing to choose and shows no row.
 *
 * STAND-IN for a row of the shared Settings structure. The row belongs in
 * `packages/client-core/src/presentation/settings-structure.ts` (page `quality`, section `method`)
 * as `{kind: 'composite', id: 'playerEngine', storage: 'device', label: 'settings.row.player',
 * help: 'settings.help.player', scope: 'device', platforms: ['phone', 'tv'], needs: c =>
 * !!c.playerEngines, control: {type: 'choice', choices: automatic | native | mpv}}`. That package
 * is a copy here and may not be edited; when the row is authored there, `SettingsPage` reads and
 * writes `preferences.playerEngine` for it like the other device rows and this file goes.
 */
export function PlayerEngineRow({hasTVPreferredFocus}: {hasTVPreferredFocus?: boolean}) {
  const {preferences, update} = usePreferences();
  const i18n = useI18n();
  const [open, setOpen] = useState(false);
  if (!mpvAvailable) return null;
  const title = engineText('settings.row.player');
  const options = engineSettings.map(value => ({id: value, label: engineText(`settings.player.${value}`)}));
  const current = options.find(o => o.id === preferences.playerEngine)?.label ?? options[0]!.label;
  return (
    <>
      <ListRow title={title} subtitle={[engineText('settings.help.player'), i18n.t('settings.thisDevice')].join(' · ')} meta={current} accessory="value" hasTVPreferredFocus={hasTVPreferredFocus} onPress={() => setOpen(true)} />
      <Menu open={open} onClose={() => setOpen(false)} title={title} items={options.map<MenuItem>(o => ({id: o.id, label: o.label, selected: o.id === preferences.playerEngine}))} onSelect={id => update({playerEngine: parseEngineSetting(id)})} />
    </>
  );
}
