import React from 'react';
import {Switch as SystemSwitch, View} from 'react-native';
import {alpha, spec, useSpecPlatform, useTheme} from './theme';

/**
 * The switch (toggleSpec, CON-03). iPhone and iPad use the system switch tinted with the accent;
 * television draws the spec's switch, which is never focused on its own: its row is.
 */
export function Switch({value, onValueChange, disabled, accessibilityLabel}: {value: boolean; onValueChange?: (value: boolean) => void; disabled?: boolean; accessibilityLabel?: string}) {
  const {colors, isTV} = useTheme();
  if (!isTV) {
    return (
      <SystemSwitch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={accessibilityLabel}
        trackColor={{true: colors.accent, false: alpha(colors.textTertiary, spec.toggle.off.trackAlpha)}}
        thumbColor={colors.white}
        ios_backgroundColor={alpha(colors.textTertiary, spec.toggle.off.trackAlpha)}
      />
    );
  }
  return <SwitchVisual value={value} disabled={disabled} />;
}

/** The drawn switch, for television (and anywhere a row owns the interaction). Not focusable. */
export function SwitchVisual({value, disabled}: {value: boolean; disabled?: boolean}) {
  const {colors} = useTheme();
  const platform = useSpecPlatform();
  const t = spec.toggle;
  const width = t.track.width[platform];
  const height = t.track.height[platform];
  const inset = t.inset[platform];
  const thumb = height - inset * 2;
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{width, height, borderRadius: height / 2, padding: inset, justifyContent: 'center', backgroundColor: value ? colors.accent : alpha(colors.textTertiary, t.off.trackAlpha), opacity: disabled ? t.disabledOpacity : 1}}>
      <View style={{width: thumb, height: thumb, borderRadius: thumb / 2, backgroundColor: colors.white, alignSelf: value ? 'flex-end' : 'flex-start'}} />
    </View>
  );
}
