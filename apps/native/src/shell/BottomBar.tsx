import React from 'react';
import {View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {Focusable, Icon, Text, alpha, useTheme, type IconName} from '../ui';
import {useI18n, type MessageId} from '../app/i18n';

export type TabKey = 'Home' | 'Library' | 'Channels' | 'Saved' | 'Downloads';

const tabs: {key: TabKey; label: MessageId; icon: IconName}[] = [
  {key: 'Home', label: 'web.shell.home', icon: 'home'},
  {key: 'Library', label: 'web.shell.library', icon: 'film'},
  {key: 'Channels', label: 'channels.title', icon: 'channels'},
  {key: 'Saved', label: 'web.shell.saved', icon: 'saved'},
  // IOS-SHELL-01: Downloads is one tap away (and works with no server); Search is the header
  // magnifier on every root (IOS-SHELL-03), so there is only ever one Search screen.
  {key: 'Downloads', label: 'web.shell.downloads', icon: 'download'},
];

/**
 * Handheld primary navigation: a conventional bottom tab bar over a quiet
 * translucent slate. The Library tab opens the current library and offers a
 * picker for the others; account and settings live behind the header avatar.
 */
export function BottomBar({selected, onSelect, libraryIcon, showChannels = true, showDownloads = true, downloadsActive = false}: {selected: TabKey; onSelect: (key: TabKey) => void; libraryIcon?: IconName; /** Hidden until the server has a channel source (Live TV or Library Channels). */ showChannels?: boolean; /** Hidden when this profile may not download and nothing is on the device (DownloadsGate). */ showDownloads?: boolean; /** A transfer is running: a dot on the Downloads tab. */ downloadsActive?: boolean}) {
  const i18n = useI18n();
  const {colors, space, metrics} = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{flexDirection: 'row', paddingBottom: Math.max(insets.bottom, space.sm), paddingTop: space.xs, paddingHorizontal: space.xs, backgroundColor: alpha(colors.ink, 0.9), borderTopWidth: 1, borderTopColor: alpha(colors.lineSoft, 0.9)}}>
      {tabs.filter(tab => (showChannels || tab.key !== 'Channels') && (showDownloads || tab.key !== 'Downloads')).map(tab => {
        const active = tab.key === selected;
        return (
          <Focusable key={tab.key} accessibilityRole="tab" accessibilityLabel={i18n.t(tab.label)} accessibilityState={{selected: active}} radius={metrics.radius.control} scale={1} ring={false} onPress={() => onSelect(tab.key)} style={{flex: 1}}>
            {({pressed}) => (
              <View style={{alignItems: 'center', justifyContent: 'center', paddingVertical: space.xs, gap: 3, opacity: pressed ? 0.7 : 1}}>
                <View>
                  <Icon name={tab.key === 'Library' && libraryIcon ? libraryIcon : tab.icon} size={24} color={active ? colors.accent : colors.textSecondary} strokeWidth={active ? 2 : 1.75} />
                  {tab.key === 'Downloads' && downloadsActive ? <View style={{position: 'absolute', top: -1, right: -3, width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent}} /> : null}
                </View>
                <Text variant="micro" style={{color: active ? colors.accent : colors.textSecondary}}>{i18n.t(tab.label)}</Text>
              </View>
            )}
          </Focusable>
        );
      })}
    </View>
  );
}
