/**
 * STAND-IN: the words for the Player setting.
 *
 * These belong in the string catalogue (`packages/i18n/src/catalog/en-US/settings.ts`), under the
 * ids used as keys here. `packages/i18n` is a copy in this repository and may not be edited here,
 * so until the catalogue has them they live in this one file. When it does: delete this file and
 * replace every `engineText(id)` with `i18n.t(id)`. Nothing else needs to change.
 */
export const engineStrings = {
  'settings.row.player': 'Player',
  'settings.help.player': 'Automatic uses this device’s own player when it can play a title as it is, and mpv when the title would otherwise have to be converted or have its subtitles burned in.',
  'settings.player.automatic': 'Automatic (recommended)',
  'settings.player.native': 'This device’s player',
  'settings.player.mpv': 'mpv',
} as const;

export type EngineStringId = keyof typeof engineStrings;

export function engineText(id: EngineStringId): string {
  return engineStrings[id];
}
