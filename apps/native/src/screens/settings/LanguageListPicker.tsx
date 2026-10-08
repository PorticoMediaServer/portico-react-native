import React, {useState} from 'react';
import {View} from 'react-native';
import {useI18n, type MessageId} from '../../app/i18n';
import {ListRow, Menu, Sheet, Text, afterOverlaysClose, rowPaddingX, useSpecPlatform, useTheme, type MenuItem} from '../../ui';
import {MAX_LANGUAGES, addLanguage, availableLanguages, languageName, moveLanguage, removeLanguage} from './language-list';
import {closeLanguageMenu} from './language-picker-handoff';

export {MAX_LANGUAGES, addLanguage, availableLanguages, languageName, moveLanguage, removeLanguage};

/**
 * X-03: preferred audio/subtitle languages (`playback.preferredAudioLanguages`,
 * `playback.preferredSubtitleLanguages`) are an ordered list of language
 * names, never codes. Names come from `Intl.DisplayNames`, the same source
 * the web picker uses. TV: focusable rows with Move up / Move down actions
 * (no drag). iPhone: the same choices in a sheet.
 */
export function LanguageListPicker({title, subtitle, value, onChange, hasTVPreferredFocus}: {
  title: string;
  subtitle?: string;
  value: readonly string[];
  onChange: (next: readonly string[]) => void;
  hasTVPreferredFocus?: boolean;
}) {
  const i18n = useI18n();
  const {space, isTV} = useTheme();
  const platform = useSpecPlatform();
  // Catalogue first (Hermes may lack Intl.DisplayNames); DisplayNames, then the code.
  const lookup = (key: string): string | undefined => {
    const v = i18n.t(key as MessageId);
    return v ? v : undefined;
  };
  const name = (code: string): string => languageName(code, lookup);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [acting, setActing] = useState<number>();
  // A menu's onClose runs while its own Sheet is still open, so the list
  // reopens only once the menu has finished dismissing (closeLanguageMenu):
  // presenting at once races the dismissal and iOS drops the list.
  const closeMenu = (clear: () => void) => {
    closeLanguageMenu({clearMenu: clear, defer: fn => { setTimeout(fn, 0); }, gate: {runAfterClose: fn => { afterOverlaysClose(fn); }}, reopenList: () => setOpen(true)});
  };
  const codes = value ?? [];
  const meta = codes.length ? codes.map(name).join(', ') : i18n.t('preferences.language.empty');
  const canAdd = codes.length < MAX_LANGUAGES;
  const addItems: readonly MenuItem[] = availableLanguages(codes).map(c => ({id: c, label: name(c)}));
  const actingName = acting !== undefined && codes[acting] ? name(codes[acting]!) : '';
  const actItems: readonly MenuItem[] =
    acting === undefined
      ? []
      : [
          {id: 'up', label: i18n.t('preferences.language.moveUp'), disabled: acting <= 0},
          {id: 'down', label: i18n.t('preferences.language.moveDown'), disabled: acting >= codes.length - 1},
          {id: 'remove', label: i18n.t('action.remove', {label: actingName})},
        ];
  return (
    <>
      <ListRow title={title} subtitle={subtitle} meta={meta} accessory="value" hasTVPreferredFocus={hasTVPreferredFocus} onPress={() => setOpen(true)} />
      <Sheet open={open} onClose={() => { setOpen(false); setAdding(false); setActing(undefined); }} title={title} subtitle={subtitle}>
        <View style={{gap: space.md}}>
          {codes.map((code, i) => (
            <ListRow key={`${code}-${i}`} title={name(code)} meta={String(i + 1)} accessory="menu" hasTVPreferredFocus={isTV && i === 0} onPress={() => { setOpen(false); setActing(i); }} />
          ))}
          {!codes.length ? <Text variant="body" tone="tertiary" style={{paddingHorizontal: rowPaddingX(platform)}}>{i18n.t('preferences.language.empty')}</Text> : null}
          {canAdd ? <ListRow title={i18n.t('preferences.language.add')} accessory="navigation" onPress={() => { setOpen(false); setAdding(true); }} /> : null}
        </View>
      </Sheet>
      {/* One overlay at a time (the sheet system presents a sheet only once the last has closed):
          the list steps aside for its menu and comes back when the menu closes. */}
      <Menu open={adding} onClose={() => closeMenu(() => setAdding(false))} title={i18n.t('preferences.language.add')} items={addItems} onSelect={id => onChange(addLanguage(codes, id))} />
      <Menu
        open={acting !== undefined}
        onClose={() => closeMenu(() => setActing(undefined))}
        title={actingName}
        items={actItems}
        onSelect={id => {
          if (acting === undefined) return;
          if (id === 'up') onChange(moveLanguage(codes, acting, 'up'));
          else if (id === 'down') onChange(moveLanguage(codes, acting, 'down'));
          else if (id === 'remove') onChange(removeLanguage(codes, acting));
        }}
      />
    </>
  );
}
