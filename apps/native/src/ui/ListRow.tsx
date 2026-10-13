import React from 'react';
import {StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle} from 'react-native';
import {Artwork, ProgressLine, type ArtworkShape} from './Artwork';
import {Focusable, type FocusableHandle, type FocusableProps} from './Focusable';
import {Icon, type IconName} from './Icon';
import {Switch, SwitchVisual} from './Switch';
import {Text} from './Text';
import {cardName} from './card-name';
import {uiI18n} from './i18n';
import {alpha, spec, useSpecPlatform, useTheme, type SpecPlatform} from './theme';

/** What the trailing edge promises (rowSpec.trailing, CON-11). */
export type RowAccessory = 'navigation' | 'value' | 'menu';

export type ListRowProps = Omit<FocusableProps, 'children' | 'style' | 'radius'> & {
  title: string;
  subtitle?: string;
  /** Right-aligned small text (duration, date, the current value). */
  meta?: string;
  /** Leading number (track / episode ordinal). */
  ordinal?: string | number;
  source?: ImageSourcePropType;
  shape?: ArtworkShape;
  icon?: IconName;
  /** `navigation` → forward chevron (pushes a page); `value` → up-down chevron (opens a picker); `menu` → more. */
  accessory?: RowAccessory;
  trailingIcon?: IconName;
  trailing?: React.ReactNode;
  progress?: number;
  watched?: boolean;
  selected?: boolean;
  /** Overview text shown under the title on wide layouts. */
  description?: string;
  /** Subtitle lines before truncation. Default: 1 in media rows, 3 elsewhere (settings help wraps, CON-09). */
  subtitleLines?: number;
  /** `destructive`: the title names the risk in red (APL-SYS-05); `action`: the title is the action, in accent. */
  tone?: 'default' | 'destructive' | 'action';
  /**
   * TV only: a static row the remote can still land on (an information page such as About, where
   * nothing else is focusable). It highlights but does nothing when pressed.
   */
  readable?: boolean;
  /** A custom leading element (a profile avatar), in place of `icon`, at its own size: give such a row its own group, since its text doesn't line up with icon rows. */
  leadingView?: React.ReactNode;
  /** Handle to the row's focusable (to move TV focus to it, e.g. a picker's current choice). */
  focusRef?: React.Ref<FocusableHandle>;
  style?: StyleProp<ViewStyle>;
};

const accessoryGlyph: Record<RowAccessory, IconName> = {navigation: 'forward', value: 'chevronUpDown', menu: 'more'};

/** Horizontal padding of a row; sheets and groups align their titles and separators with it. */
export function rowPaddingX(platform: SpecPlatform): number {
  return spec.row.paddingX[platform];
}

/**
 * The one row (rowSpec, COMPONENTS.md § Rows): settings, menus, episodes, tracks, chapters.
 * A row with no press action is static: not focusable, no highlight (APL-SYS-09).
 */
export const ListRow = React.memo(function ListRow({title, subtitle, meta, ordinal, source, shape = 'landscape', icon, accessory, trailingIcon, trailing, progress = 0, watched, selected, description, subtitleLines, tone = 'default', readable = false, leadingView, focusRef, style, ...rest}: ListRowProps) {
  const {colors, metrics, isTV} = useTheme();
  const platform = useSpecPlatform();
  const r = spec.row;
  const media = !!source || ordinal !== undefined;
  const thumbWidth = shape === 'landscape' ? r.artwork.landscape[platform] : shape === 'square' ? r.artwork.square[platform] : r.artwork.poster[platform];
  const minHeight = media ? r.minHeight.media[platform] : subtitle || description ? r.minHeight.withSubtitle[platform] : r.minHeight.single[platform];
  const interactive = !!(rest.onPress || rest.onLongPress);
  const titleTone = tone === 'destructive' ? 'danger' : tone === 'action' ? 'accent' : watched ? 'secondary' : 'primary';
  const glyph = accessory ? accessoryGlyph[accessory] : trailingIcon;
  const glyphSize = accessory === 'menu' ? r.trailing.menu.size[platform] : r.trailing.navigation.size[platform];
  const body = (active: boolean) => (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: r.leadingGap[platform],
        paddingVertical: r.paddingY[platform],
        paddingHorizontal: r.paddingX[platform],
        borderRadius: metrics.radius.control,
        minHeight,
        backgroundColor: selected ? alpha(colors.accent, r.selected.backgroundAlpha) : active ? colors.raisedHigh : 'transparent',
      }}>
      {ordinal !== undefined ? (
        <View style={{width: r.leadingBox[platform] + (isTV ? 12 : 4), alignItems: 'center'}}>
          <Text variant="captionStrong" tone={watched ? 'tertiary' : 'secondary'}>{String(ordinal)}</Text>
        </View>
      ) : null}
      {leadingView && !icon ? leadingView : null}
      {icon ? (
        <View style={{width: r.leadingBox[platform], alignItems: 'center'}}>
          <Icon name={icon} size={r.leadingIcon[platform]} color={tone === 'destructive' ? colors.danger : selected ? colors.accent : colors.textSecondary} />
        </View>
      ) : null}
      {source ? (
        <View>
          <Artwork source={source} shape={shape} width={thumbWidth} title={title} />
          <ProgressLine value={progress} />
        </View>
      ) : null}
      <View style={{flex: 1, minWidth: 0}}>
        <Text variant={r.title} lines={media ? 1 : 2} tone={titleTone}>{title}</Text>
        {subtitle ? <Text variant={r.subtitle.role} tone="tertiary" lines={subtitleLines ?? (media ? r.subtitle.lines.media : r.subtitle.lines.settings)}>{subtitle}</Text> : null}
        {description ? <Text variant="caption" tone="secondary" lines={2} style={{marginTop: 2}}>{description}</Text> : null}
      </View>
      {meta ? <Text variant="caption" tone={accessory === 'value' ? 'secondary' : 'tertiary'} style={{flexShrink: 0, maxWidth: '45%'}} lines={1}>{meta}</Text> : null}
      {watched ? <Icon name="watched" size={metrics.iconSmall} color={colors.textTertiary} /> : null}
      {trailing}
      {glyph ? <Icon name={glyph} size={glyphSize} color={colors.textTertiary} /> : null}
    </View>
  );
  if (!interactive && isTV && readable) {
    return (
      <Focusable accessibilityRole="text" accessibilityLabel={[title, subtitle, meta].filter(Boolean).join(', ')} radius={metrics.radius.control} scale={spec.focus.scale.row.tv} style={style} {...rest}>
        {({focused}) => body(focused)}
      </Focusable>
    );
  }
  if (!interactive) {
    return (
      <View accessible accessibilityLabel={[title, subtitle, meta].filter(Boolean).join(', ')} style={[style, rest.disabled ? {opacity: spec.button.disabledOpacity} : null]}>
        {body(false)}
      </View>
    );
  }
  return (
    <Focusable ref={focusRef} accessibilityRole="button" accessibilityLabel={media ? cardName(title, {watched, progress}) : title} accessibilityHint={subtitle} accessibilityState={selected ? {selected: true} : undefined} longPressLabel={rest.onLongPress ? uiI18n().t('card.more', {title}) : undefined} radius={metrics.radius.control} scale={isTV ? spec.focus.scale.row.tv : 1} style={style} {...rest}>
      {({focused, hovered, pressed}) => body(focused || hovered || pressed)}
    </Focusable>
  );
});

/**
 * A settings row with a trailing switch (toggleSpec, CON-03). The whole row toggles; its role is
 * switch and its name never changes with the state ("Show Trending now on Home"). A setting that
 * can't be turned off shows a lock and says why instead of a disabled switch.
 */
export function ToggleRow({title, subtitle, value, onChange, icon, locked, disabled, style, hasTVPreferredFocus}: {title: string; subtitle?: string; value: boolean; onChange: (value: boolean) => void; icon?: IconName; /** e.g. "Always on Home": shown with a lock instead of a switch. */ locked?: string; disabled?: boolean; style?: StyleProp<ViewStyle>; hasTVPreferredFocus?: boolean}) {
  const {colors, metrics, isTV} = useTheme();
  const platform = useSpecPlatform();
  const r = spec.row;
  if (locked) {
    return <ListRow title={title} subtitle={subtitle} icon={icon} meta={locked} trailing={<Icon name="lock" size={metrics.iconSmall} color={colors.textTertiary} />} style={style} />;
  }
  return (
    <Focusable
      accessibilityRole="switch"
      accessibilityState={{checked: value, disabled: !!disabled}}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      radius={metrics.radius.control}
      scale={isTV ? spec.focus.scale.row.tv : 1}
      onPress={() => onChange(!value)}
      style={[{alignSelf: 'stretch'}, style]}>
      {({focused, hovered}) => (
        <View style={{flexDirection: 'row', alignItems: 'center', gap: r.leadingGap[platform], paddingVertical: r.paddingY[platform], paddingHorizontal: r.paddingX[platform], minHeight: subtitle ? r.minHeight.withSubtitle[platform] : r.minHeight.single[platform], borderRadius: metrics.radius.control, backgroundColor: focused || hovered ? colors.raisedHigh : 'transparent'}}>
          {icon ? <View style={{width: r.leadingBox[platform], alignItems: 'center'}}><Icon name={icon} size={r.leadingIcon[platform]} color={colors.textSecondary} /></View> : null}
          <View style={{flex: 1, minWidth: 0}}>
            <Text variant={r.title}>{title}</Text>
            {subtitle ? <Text variant={r.subtitle.role} tone="tertiary" lines={r.subtitle.lines.settings}>{subtitle}</Text> : null}
          </View>
          {isTV ? <SwitchVisual value={value} disabled={disabled} /> : <Switch value={value} onValueChange={onChange} disabled={disabled} accessibilityLabel={title} />}
        </View>
      )}
    </Focusable>
  );
}

function flatten(children: React.ReactNode): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) return;
    if (child.type === React.Fragment) out.push(...flatten((child.props as {children?: React.ReactNode}).children));
    else out.push(child);
  });
  return out;
}

/**
 * A grouped list (rowSpec.group, CON-09): one raised surface per group, never a border per row.
 * The group draws the separators, starting where the row text starts, and an optional header
 * label and a footer caption that wraps. A child that isn't a ListRow can pass `leading` to say
 * whether its row has a leading glyph, so the separator below it starts at its text.
 */
export function RowGroup({title, footer, children, style}: {title?: string; footer?: string; children: React.ReactNode; style?: StyleProp<ViewStyle>}) {
  const {colors, isTV, metrics, space} = useTheme();
  const platform = useSpecPlatform();
  const r = spec.row;
  const g = r.group;
  const rows = flatten(children);
  if (!rows.length) return null;
  const leading = (row: React.ReactElement) => {
    const p = row.props as {icon?: unknown; source?: unknown; ordinal?: unknown; leading?: boolean; leadingView?: unknown};
    return p.leading ?? (p.icon !== undefined || p.source !== undefined || p.ordinal !== undefined || p.leadingView !== undefined);
  };
  return (
    <View style={style}>
      {title ? <Text variant={g.header.role} tone="tertiary" style={{paddingHorizontal: r.paddingX[platform], marginBottom: g.header.gapBelow[platform]}}>{title}</Text> : null}
      {/* TV: rows scale and draw their focus ring outside their bounds, so the group keeps room for it inside its surface and never clips it. */}
      <View style={{backgroundColor: colors[g.background], borderRadius: g.radius[platform], borderWidth: 1, borderColor: colors[g.border], ...(isTV ? {overflow: 'visible' as const, padding: Math.max(space.sm, metrics.focusRing + 8)} : {overflow: 'hidden' as const})}}>
        {rows.map((row, i) => (
          <React.Fragment key={row.key ?? i}>
            {i > 0 ? <View style={{height: StyleSheet.hairlineWidth, backgroundColor: colors[g.separator], marginLeft: r.paddingX[platform] + (leading(rows[i - 1]!) ? r.leadingBox[platform] + r.leadingGap[platform] : 0)}} /> : null}
            {row}
          </React.Fragment>
        ))}
      </View>
      {footer ? <Text variant={g.footer.role} tone="tertiary" style={{paddingHorizontal: r.paddingX[platform], marginTop: g.footer.gapAbove[platform]}}>{footer}</Text> : null}
    </View>
  );
}
