import React, {useState} from 'react';
import {View} from 'react-native';
import type {Library} from '../../../../packages/client-core/src/index';
import type {PinnedResource} from '../../../../packages/client-core/src/library-pins';
import {mediaFamilyIcon} from '../../../../packages/design/src/index';
import {Button, Divider, Icon, Notice, Sheet, Surface, Text, useTheme, type IconName} from '../ui';
import {useI18n} from '../app/i18n';
import {say} from '../app/errors';
import {pinnedResourceIcon, type usePinActions} from '../app/pins';

/**
 * What is pinned, and in what order, on phones, tablets and televisions: every library with a pin
 * to turn on or off (pinned ones lead the rail and the library list, in the order set here), then
 * the pinned collections, saved views and playlists, each moved up or down or unpinned. Every
 * change is saved as it is made; every control is a plain focusable button for the remote.
 */
export function PinEditor({open, onClose, libraries, pinned, actions}: {open: boolean; onClose: () => void; libraries: readonly Library[]; pinned: readonly PinnedResource[]; actions: ReturnType<typeof usePinActions>}) {
  const i18n = useI18n();
  const {space} = useTheme();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const run = (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setProblem(undefined);
    void work().catch(e => setProblem(say(e, 'library', 'save'))).finally(() => setBusy(false));
  };
  const pinnedLibraries = libraries.filter(l => l.pinned === true);
  const row = (key: string, icon: IconName, name: string, controls: React.ReactNode, index: number) => (
    <View key={key}>
      {index ? <Divider inset={space.md} /> : null}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs, paddingHorizontal: space.sm}}>
        <Icon name={icon} size={20} />
        <View style={{flex: 1, minWidth: 0}}><Text variant="body" lines={1}>{name}</Text></View>
        {controls}
      </View>
    </View>
  );
  return (
    <Sheet open={open} onClose={onClose} title={i18n.t('pins.editTitle')} subtitle={i18n.t('pins.librariesHint')}>
      <View style={{gap: space.md}}>
        {problem ? <Notice tone="error" message={problem} /> : null}
        <Text variant="caption" tone="secondary">{i18n.t('pins.libraries')}</Text>
        <Surface padded={false}>
          {libraries.map((library, index) => {
            const at = pinnedLibraries.findIndex(l => l.id === library.id);
            const isPinned = at >= 0;
            return row(library.id, (mediaFamilyIcon(library.kind) ?? 'film') as IconName, library.name, <>
              {isPinned ? <Button size="sm" variant="ghost" round icon="chevronUp" accessibilityLabel={i18n.t('pins.moveUp', {name: library.name})} disabled={busy || at === 0} onPress={() => run(() => actions.moveLibrary(library.id, -1))} /> : null}
              {isPinned ? <Button size="sm" variant="ghost" round icon="chevronDown" accessibilityLabel={i18n.t('pins.moveDown', {name: library.name})} disabled={busy || at === pinnedLibraries.length - 1} onPress={() => run(() => actions.moveLibrary(library.id, 1))} /> : null}
              <Button size="sm" variant={isPinned ? 'secondary' : 'ghost'} selected={isPinned} icon={isPinned ? 'bookmarkFilled' : 'bookmark'} label={isPinned ? i18n.t('pins.unpin') : i18n.t('pins.pin')} accessibilityLabel={isPinned ? i18n.t('pins.unpinNamed', {name: library.name}) : i18n.t('pins.pinNamed', {name: library.name})} disabled={busy} onPress={() => run(() => actions.pinLibrary(library.id, !isPinned))} />
            </>, index);
          })}
        </Surface>
        <Text variant="caption" tone="secondary">{i18n.t('pins.saved')}</Text>
        {pinned.length ? (
          <Surface padded={false}>
            {pinned.map((entry, index) => row(entry.kind + ':' + entry.id, pinnedResourceIcon(entry.kind), entry.name, <>
              <Button size="sm" variant="ghost" round icon="chevronUp" accessibilityLabel={i18n.t('pins.moveUp', {name: entry.name})} disabled={busy || index === 0} onPress={() => run(() => actions.moveResource(entry, -1))} />
              <Button size="sm" variant="ghost" round icon="chevronDown" accessibilityLabel={i18n.t('pins.moveDown', {name: entry.name})} disabled={busy || index === pinned.length - 1} onPress={() => run(() => actions.moveResource(entry, 1))} />
              <Button size="sm" variant="ghost" icon="bookmarkFilled" label={i18n.t('pins.unpin')} accessibilityLabel={i18n.t('pins.unpinNamed', {name: entry.name})} disabled={busy} onPress={() => run(() => actions.unpinResource(entry))} />
            </>, index))}
          </Surface>
        ) : <Text variant="caption" tone="tertiary">{i18n.t('pins.noneSaved')}</Text>}
      </View>
    </Sheet>
  );
}
